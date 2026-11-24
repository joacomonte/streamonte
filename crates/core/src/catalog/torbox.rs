//! TorBox (2026-11-17): qué opciones ya tiene en su caché (se pueden ver al instante desde sus
//! servidores, sin depender de los seeds). Con la key del usuario (Ajustes); sin key, nada.
//! API: `GET https://api.torbox.app/v1/api/torrents/checkcached?hash=a,b&format=object` con
//! `Authorization: Bearer <key>`; `data` trae una entrada por cada hash que está en caché.
//!
//! Siempre directo contra TorBox con la key de cada usuario (2026-11-23): el modo "TorBox de Streamonte" (por la
//! web, con la key del servidor) se sacó porque el link de reproducción trae la key y el proxy no podía darlo.

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
const BASE: &str = "https://api.torbox.app/v1/api";
/// Hashes por pedido. Con `list_files=true` cada entrada trae la lista de archivos: 80 hashes de packs pasan
/// el tope de 5 MB de [`super::http::MAX_BODY`] (y los 4,5 MB de respuesta de una función de Vercel, que
/// devuelve 413): el pedido fallaba entero y no aparecía ninguna opción en TorBox (2026-11-22).
const CHUNK: usize = 30;
/// Plazo mínimo de cada pedido de `checkcached`: con la lista de archivos TorBox tarda más que los 10 s
/// de `catalog.timeout_ms` (la web le da 20 s).
const MIN_CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// Menos que esto es una muestra, un tráiler o un extra: no cuenta como el video del torrent.
const MIN_VIDEO: u64 = 100 * 1024 * 1024;

/// Guarda la key (o la borra si viene vacía).
pub fn set_key(key: &str) -> Result<()> {
    crate::secrets::set_secret(ACCOUNT, key)
}

/// ¿Hay key propia guardada? (la fila "TorBox" de Ajustes).
pub fn has_key() -> bool {
    crate::secrets::secret(ACCOUNT).is_some()
}

/// La key de TorBox guardada. `None` = sin key.
struct Api {
    key: String,
}

fn api() -> Option<Api> {
    crate::secrets::secret(ACCOUNT).map(|key| Api { key })
}

type Call<T> = std::result::Result<T, super::http::FetchError>;

impl Api {
    fn bearer(&self) -> (&'static str, String) {
        ("Authorization", format!("Bearer {}", self.key))
    }
    /// GET de `path` (desde `/v1/api/`, p. ej. `torrents/mylist?id=1`).
    async fn get<T: serde::de::DeserializeOwned>(
        &self,
        http: &Http,
        path: &str,
        timeout: Duration,
    ) -> Call<T> {
        let (h, v) = self.bearer();
        http.get_json_auth(&format!("{BASE}/{path}"), (h, &v), timeout)
            .await
    }
    async fn post_multipart<T: serde::de::DeserializeOwned>(
        &self,
        http: &Http,
        path: &str,
        fields: &[(&'static str, String)],
        timeout: Duration,
    ) -> Call<T> {
        let (h, v) = self.bearer();
        http.post_multipart_auth(&format!("{BASE}/{path}"), (h, &v), fields, timeout)
            .await
    }
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
    /// Nombre del video principal (el más grande) de cada una: da la calidad cuando el nombre del
    /// torrent no la dice. Sale de la misma lista de archivos.
    #[serde(default)]
    pub videos: Vec<CachedVideo>,
}

#[derive(Debug, serde::Serialize, Deserialize)]
pub struct CachedVideo {
    pub hash: InfoHash,
    pub name: String,
    /// Resolución y fuente sacadas del nombre del archivo (mismo parser que las opciones).
    pub resolution: Option<String>,
    pub source: Option<String>,
}

/// Cuáles de `hashes` están en la caché de TorBox. `None` = sin key o TorBox no respondió (no se muestra nada);
/// un hash que falta = no está.
pub async fn cached(http: &Http, hashes: &[InfoHash], timeout: Duration) -> Result<Option<Cached>> {
    let Some(api) = api() else { return Ok(None) };
    let timeout = timeout.max(MIN_CHECK_TIMEOUT);
    let mut out = Cached::default();
    for (n, chunk) in hashes.chunks(CHUNK).enumerate() {
        let list = chunk
            .iter()
            .map(|h| h.to_hex())
            .collect::<Vec<_>>()
            .join(",");
        let path = format!("torrents/checkcached?hash={list}&format=object&list_files=true");
        let resp: CheckCached = match api.get(http, &path, timeout).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    chunk = n,
                    hashes = chunk.len(),
                    "TorBox checkcached: {}",
                    e.user_text()
                );
                return Ok(None);
            }
        };
        let data = resp.data.as_ref();
        // Solo las que traen un video de verdad (2026-11-20: aparecían "listas" packs de audio y
        // muestras de 200 MB que después no se podían ver). Sin lista de archivos, se dejan.
        let usable: Vec<InfoHash> = in_cache(chunk, data)
            .into_iter()
            .filter(|h| {
                entry(data, h).map_or(true, |e| main_video(e).is_some() || files(e).is_none())
            })
            .collect();
        for h in &usable {
            if let Some(name) = entry(data, h).and_then(main_video) {
                let tags = super::normalize::release_tags(
                    &name,
                    &crate::release::parse_release_name(&name),
                );
                out.videos.push(CachedVideo {
                    hash: *h,
                    name,
                    resolution: tags.resolution,
                    source: tags.source,
                });
            }
        }
        out.spanish_subs.extend(
            usable
                .iter()
                .copied()
                .filter(|h| entry(data, h).is_some_and(has_spanish_sub)),
        );
        out.hashes.extend(usable);
    }
    Ok(Some(out))
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

/// `files[]` de la entrada, si TorBox la mandó.
fn files(entry: &serde_json::Value) -> Option<&Vec<serde_json::Value>> {
    entry.get("files").and_then(|f| f.as_array())
}

/// El video más grande que no es una muestra, si pesa al menos `MIN_VIDEO`.
fn main_video(entry: &serde_json::Value) -> Option<String> {
    files(entry)?
        .iter()
        .filter_map(|f| {
            Some((
                f.get("name")?.as_str()?,
                f.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
            ))
        })
        .filter(|(name, size)| {
            crate::engine::is_video(name)
                && *size >= MIN_VIDEO
                && !name.to_ascii_lowercase().contains("sample")
        })
        .max_by_key(|(_, size)| *size)
        .map(|(name, _)| name.rsplit('/').next().unwrap_or(name).to_string())
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

fn fail(detail: impl Into<String>) -> crate::CoreError {
    crate::CoreError::Catalog {
        user: "TorBox no pudo darme el video. Probá con ▶ normal (P2P).".into(),
        detail: detail.into(),
    }
}

/// El torrent en la cuenta de TorBox y su archivo de video más grande (2026-11-17): lo agrega solo si ya está en
/// caché (si no, TorBox empezaría a bajarlo y no estaría al instante). Devuelve a quién pedir, el id y el archivo.
async fn video_file(http: &Http, magnet: &str, timeout: Duration) -> Result<(Api, u64, TbFile)> {
    let api = api().ok_or_else(|| fail("sin key de TorBox"))?;
    let created: Created = api
        .post_multipart(
            http,
            "torrents/createtorrent",
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
    let list: MyList = api
        .get(
            http,
            &format!("torrents/mylist?id={id}&bypass_cache=true"),
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
        .filter(|f| {
            crate::engine::is_video(&f.name) && !f.name.to_ascii_lowercase().contains("sample")
        })
        .max_by_key(|f| f.size)
        .ok_or(crate::CoreError::NoVideo)?;
    Ok((api, id, file))
}
/// Link de descarga del archivo. `requestdl` pide la key en la URL (así lo documenta TorBox); no se loguea.
async fn download_url(
    http: &Http,
    api: &Api,
    id: u64,
    file: &TbFile,
    timeout: Duration,
) -> Result<String> {
    let token = &api.key;
    let dl: Download = api
        .get(
            http,
            &format!(
                "torrents/requestdl?token={token}&torrent_id={id}&file_id={}&zip_link=false",
                file.id
            ),
            timeout,
        )
        .await
        .map_err(|e| fail(format!("requestdl: {}", e.user_text())))?;
    dl.data
        .filter(|u| u.starts_with("https://"))
        .ok_or_else(|| fail("requestdl sin link"))
}

/// Pistas del video sin bajarlo (encabezado del MKV, 2026-11-23). Devuelve también el link, para probar con mpv si
/// no es MKV. `(pistas, link)`: `None` en pistas = no es MKV o no se pudo leer.
pub async fn header_tracks(
    http: &Http,
    magnet: &str,
    timeout: Duration,
) -> Result<(Option<Vec<super::mkv::Track>>, Option<String>)> {
    const HEADER_TIMEOUT: Duration = Duration::from_secs(25);
    let (api, id, file) = video_file(http, magnet, timeout).await?;
    tracing::info!(
        torrent_id = id,
        file_id = file.id,
        "pistas por TorBox: leyendo encabezado"
    );
    let url = download_url(http, &api, id, &file, timeout).await?;
    let tracks = http
        .head_bytes(&url, super::mkv::HEAD, HEADER_TIMEOUT)
        .await
        .inspect_err(|e| tracing::info!("encabezado por TorBox: {}", e.user_text()))
        .ok()
        .and_then(|b| super::mkv::parse_tracks(&b));
    Ok((tracks, Some(url)))
}

/// Link directo del video de ese torrent en TorBox (2026-11-17), que mpv reproduce como cualquier video en línea.
pub async fn stream_url(http: &Http, magnet: &str, timeout: Duration) -> Result<String> {
    let (api, id, file) = video_file(http, magnet, timeout).await?;
    download_url(http, &api, id, &file, timeout).await
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
    let (api, id, file) = video_file(http, magnet, timeout).await?;
    let release = crate::magnet::Magnet::parse(magnet)
        .ok()
        .and_then(|m| m.display_name)
        .unwrap_or_default();
    match hls_url(http, &api, id, file.id, orig, latino, &release, timeout).await {
        Ok(url) => Ok(url),
        Err(e) => {
            tracing::info!("TorBox sin stream HLS, va el link de descarga: {e}");
            let url = download_url(http, &api, id, &file, timeout).await?;
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
#[allow(clippy::too_many_arguments)]
async fn hls_url(
    http: &Http,
    api: &Api,
    id: u64,
    file_id: u64,
    orig: Option<&str>,
    latino: bool,
    release: &str,
    timeout: Duration,
) -> Result<String> {
    let base = format!("stream/createstream?id={id}&file_id={file_id}&type=torrent");
    let ask = |path: String| async move {
        let s: Stream = api
            .get(http, &path, timeout)
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
    let audio = pick_audio(audios, orig, latino, release);
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
/// Posición del audio a poner: latino si se pidió y está (español cuyo título dice latino según
/// `audio::spanish_variant`, o, si ningún título lo dice, el que el nombre del release deja deducir:
/// [`latino_by_name`]); si no, el idioma original; si no, inglés; si no, el primero.
fn pick_audio(audios: &[StreamAudio], orig: Option<&str>, latino: bool, release: &str) -> usize {
    let find = |f: &dyn Fn(&StreamAudio) -> bool| audios.iter().position(f);
    let lat = || {
        find(&|a| {
            a.language == "spa"
                && a.title.as_deref().is_some_and(|t| {
                    crate::audio::spanish_variant(t) == crate::audio::SpanishVariant::Latino
                })
        })
        .or_else(|| {
            let spa: Vec<usize> = (0..audios.len())
                .filter(|&i| audios[i].language == "spa")
                .collect();
            latino_by_name(&spa, release)
        })
    };
    (if latino { lat() } else { None })
        .or_else(|| orig.and_then(|o| find(&|a| a.language == o)))
        .or_else(|| find(&|a| a.language == "eng"))
        .unwrap_or(0)
}

/// Posición de `word` como palabra entera (letras, dígitos y `_` pegados no cuentan), en minúsculas.
fn word_at(text: &str, word: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    text.match_indices(word).map(|(i, _)| i).find(|&i| {
        (i == 0 || !is_word(bytes[i - 1]))
            && bytes.get(i + word.len()).map_or(true, |&b| !is_word(b))
    })
}

/// Audio latino cuando los títulos no lo dicen: con un solo audio en español en un release latino, ese; si trae latino
/// y castellano, el orden en que el nombre los nombra (`ENG.LATINO.CASTELLANO` → el primero). Igual que `latinoByName`
/// de la web (`web/src/lib/server/torbox/link.ts`); golden `torbox_pick.json`. `spa`: posiciones de los audios en español.
/// Supone que los audios siguen el orden del nombre; si falla, mirar la pista en el reproductor.
fn latino_by_name(spa: &[usize], release: &str) -> Option<usize> {
    let r = release.to_lowercase();
    let first = |parts: [Option<usize>; 3]| parts.into_iter().flatten().min();
    let lat = first([r.find("latino"), word_at(&r, "lat"), r.find("latam")])?;
    let first_spa = *spa.first()?;
    if spa.len() == 1 {
        return Some(first_spa);
    }
    let cas = [
        r.find("castellano"),
        word_at(&r, "cast"),
        r.find("españa").or_else(|| r.find("spain")),
    ]
    .into_iter()
    .flatten()
    .min();
    Some(if cas.is_some_and(|c| c < lat) {
        spa[1]
    } else {
        first_spa
    })
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
    let api = api().ok_or_else(need_key)?;
    let hex = hash.to_hex();
    let mine: AllMine = api
        .get(http, "torrents/mylist?bypass_cache=true", timeout)
        .await
        .map_err(|e| unreachable_torbox("mylist", &e))?;
    if let Some(m) = mine
        .data
        .into_iter()
        .find(|m| m.hash.eq_ignore_ascii_case(&hex))
    {
        return Ok(status_of_mine(m));
    }
    let resp: CheckCached = api
        .get(
            http,
            &format!("torrents/checkcached?hash={hex}&format=object&list_files=true"),
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
    let api = api().ok_or_else(need_key)?;
    let created: Created = api
        .post_multipart(
            http,
            "torrents/createtorrent",
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
    fn video_principal_sin_muestras_ni_audio() {
        let mb = 1024 * 1024;
        let e = serde_json::json!({ "files": [
            { "name": "Peli/Sample/peli.sample.mkv", "size": 300 * mb },
            { "name": "Peli/Peli.2026.1080p.WEB-DL.mkv", "size": 2000 * mb },
            { "name": "Peli/trailer.mp4", "size": 20 * mb }
        ]});
        assert_eq!(
            main_video(&e).as_deref(),
            Some("Peli.2026.1080p.WEB-DL.mkv")
        );
        let musica = serde_json::json!({ "files": [{ "name": "Album/01.mp3", "size": 40 * mb }] });
        assert_eq!(main_video(&musica), None);
        let muestra = serde_json::json!({ "files": [{ "name": "clip.mp4", "size": 60 * mb }] });
        assert_eq!(main_video(&muestra), None);
    }

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
        assert_eq!(pick_audio(&audios, Some("jpn"), false, ""), 3);
        assert_eq!(pick_audio(&audios, Some("jpn"), true, ""), 2);
        assert_eq!(pick_audio(&audios, Some("kor"), false, ""), 1);
        assert_eq!(pick_audio(&[a("rus", None)], None, true, ""), 0);
    }

    /// Vectores compartidos con la web: `packages/golden/torbox_pick.json` (archivo y audio).
    #[test]
    fn torbox_pick_golden() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../../../packages/golden/torbox_pick.json"))
                .unwrap();
        for case in cases {
            let input = &case["in"];
            if let Some(files) = input.get("files") {
                let entry = serde_json::json!({ "files": files });
                assert_eq!(
                    serde_json::json!(main_video(&entry)),
                    case["out"],
                    "{}",
                    case["nota"]
                );
                continue;
            }
            let audios: Vec<StreamAudio> = input["audios"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| StreamAudio {
                    language: a["language"].as_str().unwrap().into(),
                    title: a["title"].as_str().map(Into::into),
                })
                .collect();
            let orig = input["orig"].as_str().and_then(iso3);
            let release = input["release"].as_str().unwrap();
            let main = pick_audio(&audios, orig, false, release);
            let lat = pick_audio(&audios, orig, true, release);
            let out = serde_json::json!({ "main": main, "lat": (lat != main).then_some(lat) });
            assert_eq!(out, case["out"], "{}", case["nota"]);
        }
    }
}
