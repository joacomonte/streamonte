//! Servidor HTTP mínimo del stream: solo 127.0.0.1, con Range (NFR-16). URL:
//! `http://127.0.0.1:<puerto>/<handle>/<índice de archivo>`.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::Inner;
use crate::engine::TorrentHandle;
use crate::logger::DIAG_ENGINE;

pub(super) async fn serve_http(listener: TcpListener, inner: Arc<Inner>) {
    loop {
        let Ok((socket, _)) = listener.accept().await else {
            // Sin pausa, un error persistente (p. ej. sin descriptores) gira al 100 % de CPU.
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        };
        let inner = inner.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_http(socket, &inner).await {
                tracing::debug!(target: DIAG_ENGINE, "http: {e:#}");
            }
        });
    }
}

async fn handle_http(mut socket: TcpStream, inner: &Inner) -> anyhow::Result<()> {
    // Leer cabeceras (máx. 16 KiB).
    let mut head = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if socket.read(&mut byte).await? == 0 || head.len() > 16 * 1024 {
            return Ok(());
        }
        head.push(byte[0]);
    }
    let head = String::from_utf8_lossy(&head);
    let mut lines = head.split("\r\n");
    let mut parts = lines.next().unwrap_or_default().split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let range_header = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("range"))
        .map(|(_, v)| v.trim().to_string());

    let mut segs = path.trim_start_matches('/').split('/');
    let (Some(Ok(h)), Some(Ok(file_index))) = (
        segs.next().map(str::parse::<u64>),
        segs.next().map(str::parse::<usize>),
    ) else {
        socket
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };
    let Ok(torrent) = inner.torrent(TorrentHandle(h)).await else {
        socket
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };
    let (file_len, name) = torrent
        .with_metadata(|m| {
            m.file_infos
                .get(file_index)
                .map(|f| (f.len, f.relative_filename.to_string_lossy().into_owned()))
        })?
        .ok_or_else(|| anyhow::anyhow!("archivo inexistente"))?;

    let Some((start, len)) = parse_range(range_header.as_deref(), file_len) else {
        let msg = format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{file_len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        socket.write_all(msg.as_bytes()).await?;
        return Ok(());
    };
    let status = if range_header.is_some() {
        "206 Partial Content"
    } else {
        "200 OK"
    };
    let mut resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nContent-Length: {len}\r\nConnection: close\r\n",
        mime_of(&name)
    );
    if range_header.is_some() {
        resp.push_str(&format!(
            "Content-Range: bytes {start}-{}/{file_len}\r\n",
            (start + len).saturating_sub(1)
        ));
    }
    resp.push_str("\r\n");
    socket.write_all(resp.as_bytes()).await?;
    if method.eq_ignore_ascii_case("HEAD") {
        return Ok(());
    }
    let mut stream = torrent.stream(file_index).await?;
    stream.seek(std::io::SeekFrom::Start(start)).await?;
    tokio::io::copy(&mut stream.take(len), &mut socket).await?;
    Ok(())
}

/// `bytes=a-b`, `bytes=a-`, `bytes=-n` → (inicio, cantidad de bytes); sin Range, todo el
/// archivo. `None` = 416 (inicio > fin, fuera del archivo o archivo vacío).
fn parse_range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return Some((0, len));
    };
    let last = len.checked_sub(1)?;
    let spec = spec.split(',').next().unwrap_or_default().trim();
    let (start, end) = match spec.split_once('-') {
        Some(("", n)) => {
            let n: u64 = n.parse().unwrap_or(0);
            (len.saturating_sub(n), last)
        }
        Some((a, "")) => (a.parse().unwrap_or(0), last),
        Some((a, b)) => (
            a.parse().unwrap_or(0),
            b.parse::<u64>().unwrap_or(last).min(last),
        ),
        None => (0, last),
    };
    (start <= end).then(|| (start, end - start + 1))
}

/// Lo que sigue al último punto (o el nombre entero si no tiene) → MIME de la tabla de `preload`.
fn mime_of(name: &str) -> &'static str {
    crate::preload::mime_of_extension(name.rsplit('.').next().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::{mime_of, parse_range};

    #[test]
    fn mime_por_nombre() {
        assert_eq!(mime_of("Peli.2019.MKV"), "video/x-matroska");
        assert_eq!(mime_of("a/b.m4v"), "video/mp4");
        assert_eq!(mime_of("x.avi"), "application/octet-stream");
        // Sin punto se mira el nombre entero (comportamiento de siempre).
        assert_eq!(mime_of("mp4"), "video/mp4");
        assert_eq!(mime_of("README"), "application/octet-stream");
    }

    #[test]
    fn rangos_http() {
        assert_eq!(parse_range(None, 100), Some((0, 100)));
        assert_eq!(parse_range(Some("bytes=10-19"), 100), Some((10, 10)));
        assert_eq!(parse_range(Some("bytes=90-"), 100), Some((90, 10)));
        assert_eq!(parse_range(Some("bytes=-5"), 100), Some((95, 5)));
        assert_eq!(parse_range(Some("bytes=50-500"), 100), Some((50, 50)));
        // 416: inicio > fin, fuera del archivo, archivo vacío.
        assert_eq!(parse_range(Some("bytes=50-10"), 100), None);
        assert_eq!(parse_range(Some("bytes=100-"), 100), None);
        assert_eq!(parse_range(Some("bytes=-0"), 100), None);
        assert_eq!(parse_range(Some("bytes=0-"), 0), None);
        assert_eq!(parse_range(None, 0), Some((0, 0)));
    }
}
