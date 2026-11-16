//! Motor webtorrent: sidecar Node (`engines/webtorrent-sidecar`) con almacenamiento
//! pieza-por-archivo heredado de v1 (`tstream-piecestore.mjs`).
//!
//! Transporte: JSON-RPC 2.0 por stdin/stdout, una línea JSON por mensaje.
//! Contrato completo: `docs/engine-protocol.md`. stderr del sidecar → log `diag::engine`.
//! El proceso es hijo directo (sin shell, lección 6/8) con `kill_on_drop(true)`; si la app
//! muere, el sidecar ve stdin cerrado, detiene sus torrents SIN borrar datos y sale (NFR-11,
//! FR-06d, igual que rqbit). Borrar es `remove(delete_data)` o `cleanup`.

/// Trackers WebRTC: solo los usa este motor (peers de navegador).
const WEBRTC_TRACKERS: [&str; 2] = [
    "wss://tracker.webtorrent.dev",
    "wss://tracker.openwebtorrent.com",
];

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, oneshot, Mutex};

use super::*;
use crate::config::EngineConfig;
use crate::logger::DIAG_ENGINE;
use crate::CoreError;

const READY_TIMEOUT: Duration = Duration::from_secs(15);
/// Versión de `docs/engine-protocol.md` que habla este núcleo (distinta = solo aviso en el log).
const PROTOCOL_VERSION: &str = "0.3.0";

type Pending = Arc<std::sync::Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>;

pub struct WebtorrentSidecar {
    events: broadcast::Sender<EngineEvent>,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    /// stdout del sidecar terminó: nadie va a responder, `call` falla enseguida.
    closed: Arc<AtomicBool>,
    next_id: AtomicU64,
    child: Mutex<Child>,
    pid: Option<u32>,
}

impl WebtorrentSidecar {
    pub async fn spawn(config: &EngineConfig) -> Result<Self> {
        let node = config
            .node_path
            .clone()
            .or_else(|| which::which("node").ok())
            .ok_or(CoreError::ExecutableNotFound { name: "Node.js" })?;
        let script = crate::paths::webtorrent_sidecar_script(config.webtorrent_sidecar.as_deref())
            .ok_or(CoreError::ExecutableNotFound {
                name: "sidecar webtorrent",
            })?;

        let mut cmd = Command::new(&node);
        cmd.arg(&script)
            .arg("--max-conns")
            .arg(config.max_connections.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| CoreError::Engine(format!("no se pudo lanzar el sidecar: {e}")))?;
        let pid = child.id();
        let stdin = child.stdin.take().expect("stdin piped");
        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");

        let (events, _) = broadcast::channel(256);
        let pending: Pending = Arc::default();
        let closed = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = oneshot::channel::<u16>();

        // stderr → log de diagnóstico del motor.
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(target: DIAG_ENGINE, pid, "{line}");
            }
        });

        // stdout → respuestas (por id) y notificaciones (eventos).
        {
            let events = events.clone();
            let pending = pending.clone();
            let closed = closed.clone();
            let mut ready_tx = Some(ready_tx);
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut buf = Vec::new();
                // Lectura con pérdida: un byte UTF-8 inválido no debe cortar el canal.
                while matches!(reader.read_until(b'\n', &mut buf).await, Ok(n) if n > 0) {
                    let line = String::from_utf8_lossy(&buf);
                    let line = line.trim_end();
                    match serde_json::from_str::<Incoming>(line) {
                        Ok(msg) => dispatch(msg, &pending, &events, &mut ready_tx),
                        Err(e) => {
                            tracing::warn!(target: DIAG_ENGINE, "línea inválida del sidecar ({e}): {line}")
                        }
                    }
                    buf.clear();
                }
                // EOF o error: el proceso terminó. Fallar lo pendiente y avisar.
                closed.store(true, Ordering::SeqCst);
                for (_, tx) in pending.lock().expect("pending").drain() {
                    let _ = tx.send(Err(CoreError::Engine("el motor se cerró".into())));
                }
                let _ = events.send(EngineEvent::Exited { code: None });
            });
        }

        let port = tokio::time::timeout(READY_TIMEOUT, ready_rx)
            .await
            .map_err(|_| CoreError::Timeout {
                what: "arranque del motor",
                secs: READY_TIMEOUT.as_secs(),
            })?
            .map_err(|_| CoreError::Engine("el sidecar terminó antes de estar listo".into()))?;
        tracing::info!(pid, port, "sidecar webtorrent listo");

        Ok(Self {
            events,
            stdin: Mutex::new(stdin),
            pending,
            closed,
            next_id: AtomicU64::new(1),
            child: Mutex::new(child),
            pid,
        })
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut line = serde_json::to_vec(
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        )
        .map_err(|e| CoreError::Engine(format!("{method}: no se pudo serializar: {e}")))?;
        line.push(b'\n');
        let (tx, rx) = oneshot::channel();
        self.pending.lock().expect("pending").insert(id, tx);
        // Si el llamador abandona (timeout) o falla, la entrada no queda colgada.
        let _guard = PendingGuard(&self.pending, id);
        // Después de insertar: si el lector ya cerró, su drain no vio esta entrada.
        if self.closed.load(Ordering::SeqCst) {
            return Err(CoreError::Engine("el motor se cerró".into()));
        }
        {
            let mut stdin = self.stdin.lock().await;
            if let Err(e) = stdin.write_all(&line).await {
                return Err(CoreError::Engine(format!(
                    "no se pudo escribir al motor: {e}"
                )));
            }
            let _ = stdin.flush().await;
        }
        rx.await
            .map_err(|_| CoreError::Engine("el motor se cerró".into()))?
    }

    async fn call_as<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T> {
        let value = self.call(method, params).await?;
        serde_json::from_value(value)
            .map_err(|e| CoreError::Engine(format!("{method}: respuesta inesperada: {e}")))
    }
}

struct PendingGuard<'a>(&'a Pending, u64);

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.0.lock() {
            pending.remove(&self.1);
        }
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ---------- mensajes del sidecar ----------

#[derive(Deserialize)]
struct Incoming {
    id: Option<u64>,
    result: Option<Value>,
    error: Option<RpcError>,
    method: Option<String>,
    params: Option<Value>,
}

#[derive(Deserialize)]
struct RpcError {
    message: String,
    data: Option<RpcErrorData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcErrorData {
    user_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireMetadata {
    info_hash: String,
    name: String,
    files: Vec<WireFile>,
    piece_length: u64,
    piece_count: u32,
    torrent_file_base64: Option<String>,
}

#[derive(Deserialize)]
struct WireFile {
    index: usize,
    name: String,
    size: u64,
    offset: u64,
}

impl WireMetadata {
    fn into_metadata(self) -> Result<Metadata> {
        Ok(Metadata {
            info_hash: InfoHash::parse(&self.info_hash)?,
            name: self.name,
            files: self
                .files
                .into_iter()
                .map(|f| FileInfo {
                    index: f.index,
                    name: f.name,
                    size: f.size,
                    offset: f.offset,
                })
                .collect(),
            piece_length: self.piece_length,
            piece_count: self.piece_count,
            torrent_bytes: self
                .torrent_file_base64
                .and_then(|b| data_encoding::BASE64.decode(b.as_bytes()).ok()),
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireStats {
    downloaded_bytes: u64,
    #[serde(default)]
    received_bytes: u64,
    download_speed_bps: f64,
    upload_speed_bps: f64,
    peers: u32,
    #[serde(default)]
    seeds: u32,
    progress: f32,
    paused: bool,
    ranges: Vec<WireRangeProgress>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireRangeProgress {
    range: ByteRange,
    pieces_done: u32,
    pieces_total: u32,
    peers_with_missing: u32,
}

#[derive(Deserialize)]
struct WireHandle {
    handle: u64,
}

#[derive(Deserialize)]
struct WireUrl {
    url: String,
}

fn dispatch(
    msg: Incoming,
    pending: &Pending,
    events: &broadcast::Sender<EngineEvent>,
    ready_tx: &mut Option<oneshot::Sender<u16>>,
) {
    if let Some(id) = msg.id {
        if let Some(tx) = pending.lock().expect("pending").remove(&id) {
            let result = match msg.error {
                Some(e) => Err(CoreError::Engine(
                    e.data.and_then(|d| d.user_message).unwrap_or(e.message),
                )),
                None => Ok(msg.result.unwrap_or(Value::Null)),
            };
            let _ = tx.send(result);
        }
        return;
    }
    let Some(method) = msg.method else { return };
    let p = msg.params.unwrap_or(Value::Null);
    let handle = p.get("handle").and_then(Value::as_u64).map(TorrentHandle);
    let event = match method.as_str() {
        "ready" => {
            let port = p.get("httpPort").and_then(Value::as_u64).unwrap_or(0) as u16;
            let version = p.get("version").and_then(Value::as_str).unwrap_or("?");
            if version != PROTOCOL_VERSION {
                tracing::warn!(target: DIAG_ENGINE, "sidecar con protocolo {version}, el núcleo espera {PROTOCOL_VERSION}");
            }
            if let Some(tx) = ready_tx.take() {
                let _ = tx.send(port);
            }
            return;
        }
        "rangeReady" => {
            let (Some(handle), Some(file_index), Some(range)) = (
                handle,
                p.get("fileIndex").and_then(Value::as_u64),
                p.get("range")
                    .and_then(|r| serde_json::from_value::<ByteRange>(r.clone()).ok()),
            ) else {
                return;
            };
            EngineEvent::RangeReady {
                handle,
                file_index: file_index as usize,
                range,
            }
        }
        "log" => EngineEvent::Log {
            handle,
            line: p
                .get("line")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "error" => EngineEvent::Error {
            handle,
            message: p
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("error desconocido")
                .to_string(),
        },
        other => {
            tracing::debug!(target: DIAG_ENGINE, "notificación desconocida: {other}");
            return;
        }
    };
    let _ = events.send(event);
}

#[async_trait]
impl TorrentEngine for WebtorrentSidecar {
    fn pid(&self) -> Option<u32> {
        self.pid
    }

    async fn add(&self, source: TorrentSource, opts: AddOptions) -> Result<TorrentHandle> {
        let source = match source {
            TorrentSource::Magnet(m) => json!({ "magnet": m.to_uri() }),
            TorrentSource::TorrentFile(path) => json!({ "torrentFile": path }),
        };
        let r: WireHandle = self
            .call_as(
                "add",
                json!({
                    "source": source,
                    // Los WebRTC solo los entiende webtorrent: la lista común no los trae.
                    "trackers": opts.trackers.iter().map(String::as_str).chain(WEBRTC_TRACKERS).collect::<Vec<_>>(),
                    "downloadDir": opts.download_dir,
                }),
            )
            .await?;
        Ok(TorrentHandle(r.handle))
    }

    async fn metadata(&self, handle: TorrentHandle) -> Result<Arc<Metadata>> {
        let wire: WireMetadata = self
            .call_as("metadata", json!({ "handle": handle.0 }))
            .await?;
        Ok(Arc::new(wire.into_metadata()?))
    }

    async fn prioritize_ranges(
        &self,
        handle: TorrentHandle,
        file_index: usize,
        ranges: &[ByteRange],
    ) -> Result<()> {
        self.call(
            "prioritizeRanges",
            json!({ "handle": handle.0, "fileIndex": file_index, "ranges": ranges }),
        )
        .await
        .map(drop)
    }

    async fn select_file(&self, handle: TorrentHandle, file_index: usize) -> Result<()> {
        self.call(
            "selectFile",
            json!({ "handle": handle.0, "fileIndex": file_index }),
        )
        .await
        .map(drop)
    }

    async fn stream_url(&self, handle: TorrentHandle, file_index: usize) -> Result<String> {
        let r: WireUrl = self
            .call_as(
                "streamUrl",
                json!({ "handle": handle.0, "fileIndex": file_index }),
            )
            .await?;
        Ok(r.url)
    }

    async fn stats(&self, handle: TorrentHandle) -> Result<Stats> {
        let w: WireStats = self.call_as("stats", json!({ "handle": handle.0 })).await?;
        Ok(Stats {
            downloaded_bytes: w.downloaded_bytes,
            received_bytes: w.received_bytes,
            download_speed_bps: w.download_speed_bps,
            upload_speed_bps: w.upload_speed_bps,
            peers: w.peers,
            seeds: w.seeds,
            incoming_peers: 0, // el sidecar no lo informa
            known_peers: None,
            progress: w.progress,
            paused: w.paused,
            ranges: w
                .ranges
                .into_iter()
                .map(|r| RangeProgress {
                    range: r.range,
                    pieces_done: r.pieces_done,
                    pieces_total: r.pieces_total,
                    peers_with_missing: r.peers_with_missing,
                })
                .collect(),
        })
    }

    async fn pause(&self, handle: TorrentHandle) -> Result<()> {
        self.call("pause", json!({ "handle": handle.0 }))
            .await
            .map(drop)
    }

    async fn resume(&self, handle: TorrentHandle) -> Result<()> {
        self.call("resume", json!({ "handle": handle.0 }))
            .await
            .map(drop)
    }

    async fn remove(&self, handle: TorrentHandle, opts: RemoveOptions) -> Result<()> {
        self.call(
            "remove",
            json!({ "handle": handle.0, "deleteData": opts.delete_data }),
        )
        .await
        .map(drop)
    }

    fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.events.subscribe()
    }

    async fn shutdown(&self) -> Result<()> {
        // Pedido amable; si no sale en 10 s, se mata (lección 6: la app es dueña de los procesos).
        let _ =
            tokio::time::timeout(Duration::from_secs(5), self.call("shutdown", json!({}))).await;
        let mut child = self.child.lock().await;
        if tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .is_err()
        {
            tracing::warn!(pid = self.pid, "el sidecar no salió a tiempo: se mata");
            let _ = child.kill().await;
        }
        Ok(())
    }
}
