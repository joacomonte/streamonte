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

/// Id propio del `observe_property` de `video-params` (los ejemplos usan ids chicos).
const OBSERVE_VIDEO_PARAMS: u64 = 0x5354;

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
                Ok((reader, writer)) => {
                    let ipc = Self::start(reader, writer);
                    // Para la primera imagen: `video-params` existe solo con video decodificado
                    // (con `--force-window` la ventana está igual, así que `vo-configured` no sirve).
                    // Si falla, solo se pierde la métrica.
                    let _ = ipc
                        .command(&[
                            json!("observe_property"),
                            json!(OBSERVE_VIDEO_PARAMS),
                            json!("video-params"),
                        ])
                        .await;
                    return Ok(ipc);
                }
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
            // Primera imagen = la reproducción arrancó (`playback-restart`) Y hay video
            // (`video-params` no vacío), en el orden que lleguen. Con solo audio no hay.
            let (mut restarted, mut has_video, mut first_frame_sent) = (false, false, false);
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
                match name {
                    "playback-restart" => restarted = true,
                    "property-change" if msg.get("name") == Some(&json!("video-params")) => {
                        has_video = msg
                            .get("data")
                            .and_then(Value::as_object)
                            .is_some_and(|o| !o.is_empty());
                    }
                    _ => {}
                }
                if restarted && has_video && !first_frame_sent {
                    first_frame_sent = true;
                    let _ = events.send(MpvEvent::FirstFrame);
                }
                let event =
                    match name {
                        "file-loaded" => Some(MpvEvent::FileLoaded),
                        // Cada salto termina con otro `playback-restart` (tiempo de salto, 06-D).
                        "playback-restart" => Some(MpvEvent::PlaybackRestart),
                        "property-change" => msg.get("name").and_then(Value::as_str).map(|n| {
                            MpvEvent::PropertyChanged {
                                name: n.to_string(),
                                value: msg.get("data").cloned().unwrap_or(Value::Null),
                            }
                        }),
                        // `script-message streamonte <acción>` desde input.conf (FR-25–27).
                        "client-message" => {
                            let args: Vec<&str> = msg
                                .get("args")
                                .and_then(Value::as_array)
                                .map(|a| a.iter().filter_map(Value::as_str).collect())
                                .unwrap_or_default();
                            match args.as_slice() {
                                ["streamonte", action, ..] => {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{DuplexStream, Lines, ReadHalf, WriteHalf};

    /// El otro lado del canal: hace de mpv (lee pedidos, contesta y emite eventos).
    struct FakeMpv {
        lines: Lines<BufReader<ReadHalf<DuplexStream>>>,
        out: WriteHalf<DuplexStream>,
    }

    impl FakeMpv {
        async fn request(&mut self) -> Value {
            let line = self.lines.next_line().await.unwrap().expect("pedido");
            serde_json::from_str(&line).unwrap()
        }

        async fn send(&mut self, msg: Value) {
            self.out
                .write_all(format!("{msg}\n").as_bytes())
                .await
                .unwrap();
        }
    }

    fn pair() -> (Arc<MpvIpc>, FakeMpv) {
        let (client, mpv) = tokio::io::duplex(8192);
        let (cr, cw) = tokio::io::split(client);
        let (mr, mw) = tokio::io::split(mpv);
        let ipc = MpvIpc::start(Box::new(cr), Box::new(cw));
        (
            ipc,
            FakeMpv {
                lines: BufReader::new(mr).lines(),
                out: mw,
            },
        )
    }

    /// Eventos hasta `Shutdown` (el que emite `start` al cerrarse el canal): sirve para probar
    /// también lo que NO se emitió, sin dormir.
    async fn until_shutdown(rx: &mut broadcast::Receiver<MpvEvent>) -> Vec<MpvEvent> {
        let mut out = Vec::new();
        loop {
            let e = rx.recv().await.unwrap();
            if matches!(e, MpvEvent::Shutdown) {
                return out;
            }
            out.push(e);
        }
    }

    #[tokio::test]
    async fn respuestas_se_correlacionan_por_request_id() {
        let (ipc, mut mpv) = pair();
        let (a, b) = (ipc.clone(), ipc.clone());
        let first = tokio::spawn(async move { a.get_property("pause").await });
        let second = tokio::spawn(async move { b.get_property("volume").await });
        let (r1, r2) = (mpv.request().await, mpv.request().await);
        let id_of = |r: &Value, prop: &str| {
            assert_eq!(r["command"][1], prop);
            r["request_id"].as_u64().unwrap()
        };
        let (pause_id, volume_id) = if r1["command"][1] == "pause" {
            (id_of(&r1, "pause"), id_of(&r2, "volume"))
        } else {
            (id_of(&r2, "pause"), id_of(&r1, "volume"))
        };
        assert_ne!(pause_id, volume_id);
        // Contesta al revés de como llegaron: cada uno recibe lo suyo.
        mpv.send(json!({"request_id": volume_id, "error": "success", "data": 80}))
            .await;
        mpv.send(json!({"request_id": pause_id, "error": "success", "data": true}))
            .await;
        assert_eq!(first.await.unwrap().unwrap(), json!(true));
        assert_eq!(second.await.unwrap().unwrap(), json!(80));
    }

    #[tokio::test]
    async fn error_de_mpv_no_es_exito() {
        let (ipc, mut mpv) = pair();
        let ipc2 = ipc.clone();
        let task = tokio::spawn(async move { ipc2.get_property("nada").await });
        let id = mpv.request().await["request_id"].clone();
        mpv.send(json!({"request_id": id, "error": "property unavailable"}))
            .await;
        let err = task.await.unwrap().unwrap_err().to_string();
        assert!(err.contains("property unavailable"), "{err}");

        // `success` sin `data` (p. ej. set_property) → Null, no error.
        let ipc2 = ipc.clone();
        let task = tokio::spawn(async move { ipc2.set_property("pause", json!(true)).await });
        let req = mpv.request().await;
        assert_eq!(req["command"], json!(["set_property", "pause", true]));
        mpv.send(json!({"request_id": req["request_id"], "error": "success"}))
            .await;
        task.await.unwrap().unwrap();

        // Línea que no es JSON y respuesta con id desconocido: se ignoran sin romper el canal.
        mpv.out.write_all(b"basura\n").await.unwrap();
        mpv.send(json!({"request_id": 9999, "error": "success"}))
            .await;
        let ipc2 = ipc.clone();
        let task = tokio::spawn(async move { ipc2.get_property("x").await });
        let id = mpv.request().await["request_id"].clone();
        mpv.send(json!({"request_id": id, "error": "success", "data": 1}))
            .await;
        assert_eq!(task.await.unwrap().unwrap(), json!(1));
    }

    #[tokio::test]
    async fn cierre_con_pedidos_pendientes_los_falla() {
        let (ipc, mut mpv) = pair();
        let mut events = ipc.events();
        let ipc2 = ipc.clone();
        let task = tokio::spawn(async move { ipc2.get_property("pause").await });
        mpv.request().await;
        drop(mpv); // mpv se cierra sin contestar
        let err = task.await.unwrap().unwrap_err().to_string();
        assert!(err.contains("mpv se cerró"), "{err}");
        assert!(until_shutdown(&mut events).await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn sin_respuesta_vence_por_timeout() {
        let (ipc, mut mpv) = pair();
        let ipc2 = ipc.clone();
        let task = tokio::spawn(async move { ipc2.get_property("pause").await });
        mpv.request().await; // llega el pedido y mpv no contesta (queda vivo)
        let err = task.await.unwrap().unwrap_err();
        assert!(matches!(err, CoreError::Timeout { secs: 5, .. }), "{err:?}");
        assert!(ipc.pending.lock().unwrap().is_empty(), "no deja pendientes");
    }

    #[tokio::test]
    async fn primera_imagen_necesita_restart_y_video_en_cualquier_orden() {
        let params =
            |data: Value| json!({"event": "property-change", "name": "video-params", "data": data});
        let restart = json!({"event": "playback-restart"});
        let kinds = |evs: Vec<MpvEvent>| -> Vec<&'static str> {
            evs.iter()
                .map(|e| match e {
                    MpvEvent::FirstFrame => "first",
                    MpvEvent::PlaybackRestart => "restart",
                    MpvEvent::PropertyChanged { .. } => "prop",
                    other => panic!("{other:?}"),
                })
                .collect()
        };

        // restart → video-params con datos: FirstFrame sale al completarse la pareja, una sola vez.
        let (ipc, mut mpv) = pair();
        let mut rx = ipc.events();
        mpv.send(restart.clone()).await;
        mpv.send(params(json!({"w": 1920}))).await;
        mpv.send(restart.clone()).await; // un salto: no repite FirstFrame
        drop(mpv);
        assert_eq!(
            kinds(until_shutdown(&mut rx).await),
            ["restart", "first", "prop", "restart"]
        );

        // video-params → restart.
        let (ipc, mut mpv) = pair();
        let mut rx = ipc.events();
        mpv.send(params(json!({"w": 1920}))).await;
        mpv.send(restart.clone()).await;
        drop(mpv);
        assert_eq!(
            kinds(until_shutdown(&mut rx).await),
            ["prop", "first", "restart"]
        );

        // Solo audio (video-params vacío o ausente): nunca hay FirstFrame.
        let (ipc, mut mpv) = pair();
        let mut rx = ipc.events();
        mpv.send(params(json!({}))).await;
        mpv.send(restart).await;
        drop(mpv);
        assert_eq!(kinds(until_shutdown(&mut rx).await), ["prop", "restart"]);
    }

    #[tokio::test]
    async fn client_message_de_la_app_es_una_tecla() {
        let (ipc, mut mpv) = pair();
        let mut rx = ipc.events();
        let msg = |args: Value| json!({"event": "client-message", "args": args});
        mpv.send(msg(json!(["streamonte", "sync+", "extra"]))).await;
        mpv.send(msg(json!(["otro-script", "x"]))).await; // de otro script: se ignora
        mpv.send(msg(json!(["streamonte"]))).await; // sin acción: se ignora
        mpv.send(json!({"event": "file-loaded"})).await;
        drop(mpv);
        let got = until_shutdown(&mut rx).await;
        assert_eq!(got.len(), 2, "{got:?}");
        assert!(matches!(&got[0], MpvEvent::KeyAction(a) if a == "sync+"));
        assert!(matches!(got[1], MpvEvent::FileLoaded));
    }
}
