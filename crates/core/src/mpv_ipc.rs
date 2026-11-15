//! Cliente del JSON IPC de mpv (https://mpv.io/manual/master/#json-ipc). Privado de `player`.
//! Windows: named pipe `\\.\pipe\<nombre>`. macOS/Linux: socket unix en la carpeta temporal.
//! Protocolo: una línea JSON por mensaje; pedidos con `request_id`, eventos con `event`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, oneshot, Mutex};

use crate::logger::DIAG_MPV;
use crate::player::{MpvControl, MpvEvent};
use crate::{CoreError, Result};

type Pending = Arc<std::sync::Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;
type Writer = Box<dyn AsyncWrite + Send + Unpin>;

/// Tope de espera por respuesta: un mpv trabado no debe colgar a quien pregunta.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

/// Ruta del canal IPC para un nombre único.
pub fn ipc_path(name: &str) -> String {
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\{name}")
    }
    #[cfg(not(windows))]
    {
        std::env::temp_dir()
            .join(format!("{name}.sock"))
            .to_string_lossy()
            .into_owned()
    }
}

pub struct MpvIpc {
    writer: Mutex<Writer>,
    pending: Pending,
    next_id: AtomicU64,
    events: broadcast::Sender<MpvEvent>,
}

impl MpvIpc {
    /// Se conecta al canal que crea mpv al arrancar; reintenta hasta `timeout`.
    pub async fn connect(path: &str, timeout: Duration) -> Result<Arc<Self>> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            match open(path).await {
                Ok((reader, writer)) => return Ok(Self::start(reader, writer)),
                Err(e) if tokio::time::Instant::now() < deadline => {
                    tracing::trace!(target: DIAG_MPV, "esperando IPC de mpv: {e}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Err(e) => {
                    return Err(CoreError::Player(format!(
                        "no se pudo conectar al IPC de mpv: {e}"
                    )))
                }
            }
        }
    }

    fn start(reader: Box<dyn AsyncRead + Send + Unpin>, writer: Writer) -> Arc<Self> {
        let (events, _) = broadcast::channel(128);
        let pending: Pending = Arc::default();
        let ipc = Arc::new(Self {
            writer: Mutex::new(writer),
            pending: pending.clone(),
            next_id: AtomicU64::new(1),
            events: events.clone(),
        });

        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            let mut first_frame_sent = false;
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::trace!(target: DIAG_MPV, "← {line}");
                let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(id) = msg.get("request_id").and_then(Value::as_u64) {
                    if let Some(tx) = pending.lock().expect("pending").remove(&id) {
                        let ok = msg.get("error").and_then(Value::as_str) == Some("success");
                        let _ = tx.send(if ok {
                            Ok(msg.get("data").cloned().unwrap_or(Value::Null))
                        } else {
                            Err(CoreError::Player(format!(
                                "mpv: {}",
                                msg.get("error").and_then(Value::as_str).unwrap_or("?")
                            )))
                        });
                    }
                    continue;
                }
                let Some(name) = msg.get("event").and_then(Value::as_str) else {
                    continue;
                };
                tracing::debug!(target: DIAG_MPV, event = name, "evento mpv");
                let event =
                    match name {
                        "file-loaded" => Some(MpvEvent::FileLoaded),
                        // Primer `playback-restart` = empezó a mostrar imagen (métrica O1).
                        "playback-restart" if !first_frame_sent => {
                            first_frame_sent = true;
                            let _ = events.send(MpvEvent::FirstFrame);
                            Some(MpvEvent::PlaybackRestart)
                        }
                        // Cada salto termina con otro `playback-restart` (tiempo de salto, 06-D).
                        "playback-restart" => Some(MpvEvent::PlaybackRestart),
                        "property-change" => msg.get("name").and_then(Value::as_str).map(|n| {
                            MpvEvent::PropertyChanged {
                                name: n.to_string(),
                                value: msg.get("data").cloned().unwrap_or(Value::Null),
                            }
                        }),
                        // `script-message tstream <acción>` desde input.conf (FR-25–27).
                        "client-message" => {
                            let args: Vec<&str> = msg
                                .get("args")
                                .and_then(Value::as_array)
                                .map(|a| a.iter().filter_map(Value::as_str).collect())
                                .unwrap_or_default();
                            match args.as_slice() {
                                ["tstream", action, ..] => {
                                    Some(MpvEvent::KeyAction((*action).to_string()))
                                }
                                _ => None,
                            }
                        }
                        "shutdown" => Some(MpvEvent::Shutdown),
                        _ => None,
                    };
                if let Some(event) = event {
                    let _ = events.send(event);
                }
            }
            for (_, tx) in pending.lock().expect("pending").drain() {
                let _ = tx.send(Err(CoreError::Player("mpv se cerró".into())));
            }
            let _ = events.send(MpvEvent::Shutdown);
        });
        ipc
    }
}

#[cfg(windows)]
async fn open(path: &str) -> std::io::Result<(Box<dyn AsyncRead + Send + Unpin>, Writer)> {
    let pipe = tokio::net::windows::named_pipe::ClientOptions::new().open(path)?;
    let (r, w) = tokio::io::split(pipe);
    Ok((Box::new(r), Box::new(w)))
}

#[cfg(not(windows))]
async fn open(path: &str) -> std::io::Result<(Box<dyn AsyncRead + Send + Unpin>, Writer)> {
    let stream = tokio::net::UnixStream::connect(path).await?;
    let (r, w) = stream.into_split();
    Ok((Box::new(r), Box::new(w)))
}

#[async_trait]
impl MpvControl for MpvIpc {
    async fn command(&self, args: &[Value]) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().expect("pending").insert(id, tx);
        let mut line =
            serde_json::to_vec(&json!({ "command": args, "request_id": id })).expect("json");
        line.push(b'\n');
        tracing::trace!(target: DIAG_MPV, "→ {}", String::from_utf8_lossy(&line).trim_end());
        {
            let mut w = self.writer.lock().await;
            if let Err(e) = w.write_all(&line).await {
                self.pending.lock().expect("pending").remove(&id);
                return Err(CoreError::Player(format!("IPC de mpv: {e}")));
            }
            let _ = w.flush().await;
        }
        match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
            Ok(reply) => reply.map_err(|_| CoreError::Player("mpv se cerró".into()))?,
            Err(_) => {
                self.pending.lock().expect("pending").remove(&id);
                Err(CoreError::Timeout {
                    what: "respuesta de mpv",
                    secs: COMMAND_TIMEOUT.as_secs(),
                })
            }
        }
    }

    async fn get_property(&self, name: &str) -> Result<Value> {
        self.command(&[json!("get_property"), json!(name)]).await
    }

    async fn set_property(&self, name: &str, value: Value) -> Result<()> {
        self.command(&[json!("set_property"), json!(name), value])
            .await
            .map(drop)
    }

    async fn show_text(&self, text: &str, duration: Duration) -> Result<()> {
        self.command(&[
            json!("show-text"),
            json!(text),
            json!(duration.as_millis() as u64),
        ])
        .await
        .map(drop)
    }

    fn events(&self) -> broadcast::Receiver<MpvEvent> {
        self.events.subscribe()
    }
}
