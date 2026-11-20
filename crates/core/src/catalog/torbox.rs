//! TorBox (2026-11-17): qué opciones ya tiene en su caché (se pueden ver al instante desde sus
//! servidores, sin depender de los seeds). Con la key del usuario (Ajustes); sin key, nada.
//! API: `GET https://api.torbox.app/v1/api/torrents/checkcached?hash=a,b&format=object` con
//! `Authorization: Bearer <key>`; `data` trae una entrada por cada hash que está en caché.

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

/// Lo que dice la caché de TorBox de una lista de opciones (2026-11-18).
#[derive(Debug, Default, serde::Serialize, Deserialize)]
pub struct Cached {
    /// Las que están en caché.
    pub hashes: Vec<InfoHash>,
    /// De esas, las que traen un subtítulo en español como archivo suelto (`x.spa.srt`). Sale
    /// de la lista de archivos del mismo pedido: no cuesta nada. Las pistas dentro del video no
    /// aparecen ahí (se saben recién al leerlas).
    pub spanish_subs: Vec<InfoHash>,
}

/// Cuáles de `hashes` están en la caché de TorBox. `None` = sin key o TorBox no respondió (no se
/// muestra nada); un hash que falta = no está.
pub async fn cached(http: &Http, hashes: &[InfoHash], timeout: Duration) -> Option<Cached> {
    let key = crate::secrets::secret(ACCOUNT)?;
    let mut out = Cached::default();
    for chunk in hashes.chunks(CHUNK) {
        let list = chunk
            .iter()
            .map(|h| h.to_hex())
            .collect::<Vec<_>>()
            .join(",");
        let url = format!(
            "https://api.torbox.app/v1/api/torrents/checkcached?hash={list}&format=object&list_files=true"
        );
        let resp: CheckCached = http
            .get_json_bearer(&url, &key, timeout)
            .await
            .map_err(|e| tracing::warn!("TorBox: {}", e.user_text()))
            .ok()?;
        let data = resp.data.as_ref();
        out.hashes.extend(in_cache(chunk, data));
        out.spanish_subs.extend(
            in_cache(chunk, data)
                .into_iter()
                .filter(|h| entry(data, h).is_some_and(has_spanish_sub)),
        );
    }
    Some(out)
}

/// La entrada de `hash` en `data` (objeto por hash, o lista con `hash`).
fn entry<'a>(
    data: Option<&'a serde_json::Value>,
    hash: &InfoHash,
) -> Option<&'a serde_json::Value> {
    let hex = hash.to_hex();
    match data? {
        serde_json::Value::Object(m) => m
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(&hex))
            .map(|(_, v)| v),
        serde_json::Value::Array(a) => a.iter().find(|v| {
            v.get("hash")
                .and_then(|h| h.as_str())
                .is_some_and(|h| h.eq_ignore_ascii_case(&hex))
        }),
        _ => None,
    }
}

/// ¿Trae un archivo de subtítulo en español (`files[].name`)?
fn has_spanish_sub(entry: &serde_json::Value) -> bool {
    let Some(files) = entry.get("files").and_then(|f| f.as_array()) else {
        return false;
    };
    files
        .iter()
        .filter_map(|f| f.get("name")?.as_str())
        .any(|name| {
            let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            crate::subtitles::SUBTITLE_EXTENSIONS.contains(&ext.as_str())
                && matches!(
                    crate::subtitles::providers::lang_from_name(name),
                    Some((crate::config::SubtitleLanguage::Es, _))
                )
        })
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
#[derive(Deserialize, Default)]
struct TbFile {
    #[serde(default)]
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

fn fail(detail: impl Into<String>) -> crate::CoreError {
    crate::CoreError::Catalog {
        user: "TorBox no pudo darme el video. Probá con ▶ normal (P2P).".into(),
        detail: detail.into(),
    }
}

/// El torrent en la cuenta de TorBox y su archivo de video más grande (2026-11-17): lo agrega solo si ya está en
/// caché (si no, TorBox empezaría a bajarlo y no estaría al instante). Devuelve la key, el id y el archivo.
async fn video_file(http: &Http, magnet: &str, timeout: Duration) -> Result<(String, u64, TbFile)> {
    let key = crate::secrets::secret(ACCOUNT).ok_or_else(|| fail("sin key de TorBox"))?;
    let created: Created = http
        .post_multipart_bearer(
            &format!("{API}/createtorrent"),
            &key,
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
    let files = list.data.map(|d| d.files).unwrap_or_default();
    if files.is_empty() {
        return Err(fail("sin archivos (¿todavía no está listo?)"));
    }
    let file = files
        .into_iter()
        .filter(|f| crate::engine::is_video(&f.name))
        .max_by_key(|f| f.size)
        .ok_or(crate::CoreError::NoVideo)?;
    Ok((key, id, file))
}
/// Link de descarga del archivo. `requestdl` pide la key en la URL (así lo documenta TorBox); no se loguea.
async fn download_url(
    http: &Http,
    key: &str,
    id: u64,
    file: &TbFile,
    timeout: Duration,
) -> Result<String> {
    let dl: Download = http
        .get_json_bearer(
            &format!(
                "{API}/requestdl?token={key}&torrent_id={id}&file_id={}&zip_link=false",
                file.id
            ),
            key,
            timeout,
        )
        .await
        .map_err(|e| fail(format!("requestdl: {}", e.user_text())))?;
    dl.data
        .filter(|u| u.starts_with("https://"))
        .ok_or_else(|| fail("requestdl sin link"))
}

/// Link directo del video de ese torrent en TorBox (2026-11-17), que mpv reproduce como cualquier video en línea.
pub async fn stream_url(http: &Http, magnet: &str, timeout: Duration) -> Result<String> {
    let (key, id, file) = video_file(http, magnet, timeout).await?;
    download_url(http, &key, id, &file, timeout).await
}

#[derive(Deserialize)]
struct Stream {
    data: Option<StreamData>,
}
#[derive(Deserialize)]
struct StreamData {
    hls_url: Option<String>,
    #[serde(default)]
    metadata: Option<StreamMeta>,
}
#[derive(Deserialize, Default)]
struct StreamMeta {
    #[serde(default)]
    audios: Vec<StreamAudio>,
}
#[derive(Deserialize)]
struct StreamAudio {
    #[serde(default)]
    language: String,
    #[serde(default)]
    title: Option<String>,
}

/// Link para castear (2026-11-18, "Copiar link de TorBox"): el stream HLS (`.m3u8`) de TorBox, que Web Video Caster
/// detecta como video y la tele reproduce en segmentos; el de descarga llega como archivo genérico y se abría como
/// texto. Audio: el latino si `latino`, si no el idioma original (`orig`, ISO 639-2 como "eng"), si no inglés, si no
/// el que venga primero. Si TorBox no da stream (plan sin streaming), el link de descarga terminado en la extensión.
pub async fn cast_url(
    http: &Http,
    magnet: &str,
    orig: Option<&str>,
    latino: bool,
    timeout: Duration,
) -> Result<String> {
    let (key, id, file) = video_file(http, magnet, timeout).await?;
    match hls_url(http, &key, id, file.id, orig, latino, timeout).await {
        Ok(url) => Ok(url),
        Err(e) => {
            tracing::info!("TorBox sin stream HLS, va el link de descarga: {e}");
            let url = download_url(http, &key, id, &file, timeout).await?;
            // `video_file` ya garantizó que es un video: la extensión existe.
            let ext = file
                .name
                .rsplit('.')
                .next()
                .unwrap_or("mkv")
                .to_ascii_lowercase();
            let sep = if url.contains('?') { '&' } else { '?' };
            Ok(format!("{url}{sep}f=video.{ext}"))
        }
    }
}
async fn hls_url(
    http: &Http,
    key: &str,
    id: u64,
    file_id: u64,
    orig: Option<&str>,
    latino: bool,
    timeout: Duration,
) -> Result<String> {
    let base = format!("{STREAM_API}/createstream?id={id}&file_id={file_id}&type=torrent");
    let ask = |url: String| async move {
        let s: Stream = http
            .get_json_bearer(&url, key, timeout)
            .await
            .map_err(|e| fail(format!("createstream: {}", e.user_text())))?;
        s.data.ok_or_else(|| fail("createstream sin datos"))
    };
    let first = ask(base.clone()).await?;
    let audios = first
        .metadata
        .as_ref()
        .map(|m| m.audios.as_slice())
        .unwrap_or_default();
    let audio = pick_audio(audios, orig, latino);
    let data = if audio > 0 {
        ask(format!("{base}&chosen_audio_index={audio}")).await?
    } else {
        first
    };
    data.hls_url
        .filter(|u| u.starts_with("https://"))
        .ok_or_else(|| fail("createstream sin hls_url"))
}
/// ISO 639-1 (TMDB, "ja") → el código de 3 letras de las pistas de TorBox ("jpn"; bibliográfico como mpv).
pub fn iso3(iso1: &str) -> Option<&'static str> {
    Some(match iso1 {
        "en" => "eng",
        "es" => "spa",
        "fr" => "fre",
        "de" => "ger",
        "it" => "ita",
        "ja" => "jpn",
        "ko" => "kor",
        "pt" => "por",
        "ru" => "rus",
        "zh" | "cn" => "chi",
        "hi" => "hin",
        "tr" => "tur",
        "pl" => "pol",
        "nl" => "dut",
        "sv" => "swe",
        "da" => "dan",
        "no" => "nor",
        "fi" => "fin",
        "ar" => "ara",
        "he" => "heb",
        "th" => "tha",
        "cs" => "cze",
        "hu" => "hun",
        "el" => "gre",
        "id" => "ind",
        "uk" => "ukr",
        "fa" => "per",
        "is" => "ice",
        "ro" => "rum",
        _ => return None,
    })
}
const STREAM_API: &str = "https://api.torbox.app/v1/api/stream";
/// Posición del audio a poner: latino (español con "lat"/"419"/"mex" en el título) si se pidió y está; si no, el
/// idioma original; si no, inglés; si no, el primero.
fn pick_audio(audios: &[StreamAudio], orig: Option<&str>, latino: bool) -> usize {
    let find = |f: &dyn Fn(&StreamAudio) -> bool| audios.iter().position(f);
    let lat = || {
        find(&|a| {
            a.language == "spa"
                && a.title.as_deref().is_some_and(|t| {
                    let t = t.to_ascii_lowercase();
                    t.contains("lat") || t.contains("419") || t.contains("mex")
                })
        })
    };
    (if latino { lat() } else { None })
        .or_else(|| orig.and_then(|o| find(&|a| a.language == o)))
        .or_else(|| find(&|a| a.language == "eng"))
        .unwrap_or(0)
}

/// Un torrent pegado en TorBox (2026-11-20, "Pegar magnet" de la web): `cached` (en su caché: se agrega al instante),
/// `downloading` (lo está bajando en sus servidores, con avance), `ready` (ya bajado en la cuenta) o `missing` (no lo
/// tiene). `files`: sus videos, del más grande al más chico.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MagnetStatus {
    pub state: MagnetState,
    pub name: Option<String>,
    pub progress: f64,
    /// Bytes por segundo.
    pub speed: u64,
    pub seeds: u64,
    /// Segundos que faltan (0 = no se sabe).
    pub eta: u64,
    pub files: Vec<MagnetFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MagnetState {
    Cached,
    Downloading,
    Ready,
    Missing,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MagnetFile {
    pub name: String,
    pub size: u64,
}

#[derive(Deserialize)]
struct AllMine {
    #[serde(default)]
    data: Vec<Mine>,
}

#[derive(Deserialize)]
struct Mine {
    #[serde(default)]
    hash: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    download_finished: bool,
    #[serde(default)]
    download_state: String,
    #[serde(default)]
    progress: f64,
    #[serde(default)]
    download_speed: u64,
    #[serde(default)]
    seeds: u64,
    #[serde(default)]
    eta: u64,
    #[serde(default)]
    files: Vec<TbFile>,
}

/// Solo los videos (sin subtítulos ni muestras chicas fuera de orden): del más grande al más chico.
fn video_files(files: Vec<TbFile>) -> Vec<MagnetFile> {
    let mut out: Vec<MagnetFile> = files
        .into_iter()
        .filter(|f| crate::engine::is_video(&f.name))
        .map(|f| MagnetFile {
            name: f.name.rsplit('/').next().unwrap_or(&f.name).to_string(),
            size: f.size,
        })
        .collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.size));
    out
}

fn status_of_mine(m: Mine) -> MagnetStatus {
    let ready = m.download_finished
        || m.progress >= 1.0
        || matches!(
            m.download_state.as_str(),
            "cached" | "completed" | "uploading"
        );
    MagnetStatus {
        state: if ready {
            MagnetState::Ready
        } else {
            MagnetState::Downloading
        },
        name: Some(m.name).filter(|n| !n.is_empty()),
        progress: m.progress.clamp(0.0, 1.0),
        speed: m.download_speed,
        seeds: m.seeds,
        eta: m.eta,
        files: if ready {
            video_files(m.files)
        } else {
            Vec::new()
        },
    }
}

fn need_key() -> crate::CoreError {
    crate::CoreError::Catalog {
        user: "Falta la key de TorBox: cargala en Ajustes.".into(),
        detail: "torbox: sin key".into(),
    }
}

fn unreachable_torbox(what: &str, e: &super::http::FetchError) -> crate::CoreError {
    crate::CoreError::Catalog {
        user: "TorBox no respondió. Probá de nuevo en un rato.".into(),
        detail: format!("torbox {what}: {}", e.user_text()),
    }
}

/// Estado de un torrent pegado: primero en la cuenta (bajándose o bajado), si no en la caché de TorBox.
pub async fn magnet_status(http: &Http, hash: InfoHash, timeout: Duration) -> Result<MagnetStatus> {
    let key = crate::secrets::secret(ACCOUNT).ok_or_else(need_key)?;
    let hex = hash.to_hex();
    let mine: AllMine = http
        .get_json_bearer(&format!("{API}/mylist?bypass_cache=true"), &key, timeout)
        .await
        .map_err(|e| unreachable_torbox("mylist", &e))?;
    if let Some(m) = mine
        .data
        .into_iter()
        .find(|m| m.hash.eq_ignore_ascii_case(&hex))
    {
        return Ok(status_of_mine(m));
    }
    let resp: CheckCached = http
        .get_json_bearer(
            &format!("{API}/checkcached?hash={hex}&format=object&list_files=true"),
            &key,
            timeout,
        )
        .await
        .map_err(|e| unreachable_torbox("checkcached", &e))?;
    let Some(hit) = entry(resp.data.as_ref(), &hash) else {
        return Ok(MagnetStatus {
            state: MagnetState::Missing,
            name: None,
            progress: 0.0,
            speed: 0,
            seeds: 0,
            eta: 0,
            files: Vec::new(),
        });
    };
    let files: Vec<TbFile> = hit
        .get("files")
        .and_then(|f| serde_json::from_value(f.clone()).ok())
        .unwrap_or_default();
    Ok(MagnetStatus {
        state: MagnetState::Cached,
        name: hit.get("name").and_then(|n| n.as_str()).map(str::to_string),
        progress: 1.0,
        speed: 0,
        seeds: 0,
        eta: 0,
        files: video_files(files),
    })
}

/// "Bajarlo en TorBox": lo agrega a la cuenta aunque no esté en caché (TorBox lo baja en sus servidores).
pub async fn magnet_download(http: &Http, magnet: &str, timeout: Duration) -> Result<()> {
    let key = crate::secrets::secret(ACCOUNT).ok_or_else(need_key)?;
    let created: Created = http
        .post_multipart_bearer(
            &format!("{API}/createtorrent"),
            &key,
            &[("magnet", magnet.to_string())],
            timeout,
        )
        .await
        .map_err(|e| unreachable_torbox("createtorrent", &e))?;
    if created.data.and_then(|d| d.torrent_id).is_none() {
        return Err(crate::CoreError::Catalog {
            user: "TorBox no lo agregó.".into(),
            detail: format!("createtorrent: {}", created.detail.unwrap_or_default()),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn torrent_pegado_bajandose_o_listo() {
        let m: Mine = serde_json::from_str(
            r#"{"hash":"AA","name":"X","download_state":"downloading","progress":0.4,"download_speed":5,"files":[{"id":1,"name":"a/b.mkv","size":9}]}"#,
        )
        .unwrap();
        let st = status_of_mine(m);
        assert_eq!(st.state, MagnetState::Downloading);
        assert!(st.files.is_empty());
        let m: Mine = serde_json::from_str(
            r#"{"hash":"AA","download_state":"cached","files":[{"id":1,"name":"a/sample.mkv","size":1},{"id":2,"name":"a/b.srt","size":1},{"id":3,"name":"a/b.mkv","size":9}]}"#,
        )
        .unwrap();
        let st = status_of_mine(m);
        assert_eq!(st.state, MagnetState::Ready);
        let names: Vec<&str> = st.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["b.mkv", "sample.mkv"]);
    }

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

    #[test]
    fn elige_audio_para_castear() {
        let a = |language: &str, title: Option<&str>| StreamAudio {
            language: language.into(),
            title: title.map(Into::into),
        };
        let audios = [
            a("rus", None),
            a("eng", None),
            a("spa", Some("Español Latino")),
            a("jpn", None),
        ];
        assert_eq!(pick_audio(&audios, Some("jpn"), false), 3);
        assert_eq!(pick_audio(&audios, Some("jpn"), true), 2);
        assert_eq!(pick_audio(&audios, Some("kor"), false), 1);
        assert_eq!(pick_audio(&[a("rus", None)], None, true), 0);
    }
}
