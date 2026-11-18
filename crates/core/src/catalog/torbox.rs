//! TorBox (2026-11-17): qué opciones ya tiene en su caché (se pueden ver al instante desde sus
//! servidores, sin depender de los seeds). Con la key del usuario (Ajustes); sin key, nada.
//! API: `GET https://api.torbox.app/v1/api/torrents/checkcached?hash=a,b&format=object` con
//! `Authorization: Bearer <key>`; `data` trae una entrada por cada hash que está en caché.

use std::collections::HashSet;
use std::time::Duration;

use serde::Deserialize;

use super::http::Http;
use crate::magnet::InfoHash;
use crate::Result;

/// Id del servicio en Ajustes (keys de servicios).
pub const TORBOX: &str = "torbox";
const ACCOUNT: &str = "torbox-api-key";
/// Página de la cuenta donde está la API key.
pub const KEY_PAGE: &str = "https://torbox.app/settings";
/// Hashes por pedido (la URL tiene que quedar corta).
const CHUNK: usize = 80;

/// Guarda la key (o la borra si viene vacía).
pub fn set_key(key: &str) -> Result<()> {
    crate::secrets::set_secret(ACCOUNT, key)
}

pub fn has_key() -> bool {
    crate::secrets::secret(ACCOUNT).is_some()
}

#[derive(Deserialize)]
struct CheckCached {
    #[serde(default)]
    data: Option<serde_json::Value>,
}

/// Cuáles de `hashes` están en la caché de TorBox. `None` = sin key o TorBox no respondió (no se
/// muestra nada); un hash que falta = no está.
pub async fn cached(
    http: &Http,
    hashes: &[InfoHash],
    timeout: Duration,
) -> Option<HashSet<InfoHash>> {
    let key = crate::secrets::secret(ACCOUNT)?;
    let mut out = HashSet::new();
    for chunk in hashes.chunks(CHUNK) {
        let list = chunk
            .iter()
            .map(|h| h.to_hex())
            .collect::<Vec<_>>()
            .join(",");
        let url = format!(
            "https://api.torbox.app/v1/api/torrents/checkcached?hash={list}&format=object&list_files=false"
        );
        let resp: CheckCached = http
            .get_json_bearer(&url, &key, timeout)
            .await
            .map_err(|e| tracing::warn!("TorBox: {}", e.user_text()))
            .ok()?;
        out.extend(in_cache(chunk, resp.data.as_ref()));
    }
    Some(out)
}

/// Los de `chunk` que aparecen en `data` (objeto por hash; también acepta una lista con `hash`).
fn in_cache(chunk: &[InfoHash], data: Option<&serde_json::Value>) -> Vec<InfoHash> {
    let keys: Vec<String> = match data {
        Some(serde_json::Value::Object(m)) => m.keys().map(|k| k.to_ascii_lowercase()).collect(),
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.get("hash")?.as_str().map(str::to_ascii_lowercase))
            .collect(),
        _ => Vec::new(),
    };
    chunk
        .iter()
        .filter(|h| keys.contains(&h.to_hex()))
        .copied()
        .collect()
}

#[derive(Deserialize)]
struct Created {
    #[serde(default)]
    data: Option<CreatedData>,
    #[serde(default)]
    detail: Option<String>,
}
#[derive(Deserialize)]
struct CreatedData {
    torrent_id: Option<u64>,
}
#[derive(Deserialize)]
struct MyList {
    data: Option<TorrentInfo>,
}
#[derive(Deserialize)]
struct TorrentInfo {
    #[serde(default)]
    files: Vec<TbFile>,
}
#[derive(Deserialize)]
struct TbFile {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    size: u64,
}
#[derive(Deserialize)]
struct Download {
    data: Option<String>,
}

const API: &str = "https://api.torbox.app/v1/api/torrents";
const VIDEO_EXT: [&str; 6] = [".mkv", ".mp4", ".avi", ".m4v", ".mov", ".webm"];

fn fail(detail: impl Into<String>) -> crate::CoreError {
    crate::CoreError::Catalog {
        user: "TorBox no pudo darme el video. Probá con ▶ normal (P2P).".into(),
        detail: detail.into(),
    }
}

/// Link directo del video de ese torrent en TorBox (2026-11-17): lo agrega a la cuenta (en caché
/// queda listo al instante), elige el archivo de video más grande y pide su link de descarga, que
/// mpv reproduce como cualquier video en línea.
pub async fn stream_url(http: &Http, magnet: &str, timeout: Duration) -> Result<String> {
    let key = crate::secrets::secret(ACCOUNT).ok_or_else(|| fail("sin key de TorBox"))?;
    let created: Created = http
        .post_multipart_bearer(
            &format!("{API}/createtorrent"),
            &key,
            // Solo si ya está en caché: si no, TorBox empezaría a bajarlo y no estaría al instante.
            &[
                ("magnet", magnet.to_string()),
                ("add_only_if_cached", "true".into()),
            ],
            timeout,
        )
        .await
        .map_err(|e| fail(format!("createtorrent: {}", e.user_text())))?;
    let id = created.data.and_then(|d| d.torrent_id).ok_or_else(|| {
        fail(format!(
            "createtorrent sin id: {}",
            created.detail.unwrap_or_default()
        ))
    })?;
    let list: MyList = http
        .get_json_bearer(
            &format!("{API}/mylist?id={id}&bypass_cache=true"),
            &key,
            timeout,
        )
        .await
        .map_err(|e| fail(format!("mylist: {}", e.user_text())))?;
    let file = list
        .data
        .map(|d| d.files)
        .unwrap_or_default()
        .into_iter()
        .filter(|f| {
            VIDEO_EXT
                .iter()
                .any(|ext| f.name.to_ascii_lowercase().ends_with(ext))
        })
        .max_by_key(|f| f.size)
        .ok_or_else(|| fail("sin archivo de video (¿todavía no está listo?)"))?;
    // `requestdl` pide la key en la URL (así lo documenta TorBox); no se loguea.
    let dl: Download = http
        .get_json_bearer(
            &format!(
                "{API}/requestdl?token={key}&torrent_id={id}&file_id={}&zip_link=false",
                file.id
            ),
            &key,
            timeout,
        )
        .await
        .map_err(|e| fail(format!("requestdl: {}", e.user_text())))?;
    dl.data
        .filter(|u| u.starts_with("https://"))
        .ok_or_else(|| fail("requestdl sin link"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_objeto_y_lista() {
        let a = InfoHash::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        let b = InfoHash::parse("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap();
        let obj =
            serde_json::json!({ "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA": { "name": "x" } });
        assert_eq!(in_cache(&[a, b], Some(&obj)), vec![a]);
        let list = serde_json::json!([{ "hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }]);
        assert_eq!(in_cache(&[a, b], Some(&list)), vec![b]);
        assert!(in_cache(&[a], None).is_empty());
    }
}
