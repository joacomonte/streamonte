//! Proveedores de subtítulos (FR-22, FR-24, Q-01..Q-04). Orden de preferencia del usuario:
//! 1. **torrent**: los `.srt/.ass` que vienen dentro del torrent (se leen por el stream del motor).
//! 2. **Wyzie Subs**: agregador; desde 2026 exige una API key gratuita (sub.wyzie.io/redeem).
//! 3. **Subdivx**: experimental, sin API oficial (se lee la web). Si falla o hay un bloqueo de
//!    Cloudflare, se omite sin romper nada (no se evaden bloqueos, R-09).
//! 4. **OpenSubtitles**: API REST v1 con la key gratuita del usuario; cuota de 20 descargas/día,
//!    por eso va último y solo si faltan para llegar a 5.
//!
//! Los parsers de respuestas son funciones puras (`parse_*`) probadas con fixtures guardados.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;

use super::{
    merge, MatchKind, Quota, SpanishVariant, SubtitleCandidate, SubtitleProvider, VideoIdentity,
    TORRENT_PROVIDER,
};
use crate::config::SubtitleLanguage;
use crate::{CoreError, Result};

const USER_AGENT: &str = concat!("tstream v", env!("CARGO_PKG_VERSION"));
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

pub const WYZIE: &str = "wyzie";
pub const SUBDIVX: &str = "subdivx";
pub const OPENSUBTITLES: &str = "opensubtitles";

/// Nombre corto para la etiqueta en pantalla ("2 · Wyzie/…").
pub fn display_name(provider: &str) -> &'static str {
    match provider {
        TORRENT_PROVIDER => "torrent",
        WYZIE => "Wyzie",
        SUBDIVX => "Subdivx",
        OPENSUBTITLES => "OpenSubs",
        _ => "?",
    }
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("cliente HTTP")
    })
}

/// Para el motor local (127.0.0.1): sin proxy y con más paciencia (puede faltar una pieza).
fn local_http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(90))
            .build()
            .expect("cliente HTTP local")
    })
}

fn err(provider: &'static str, message: impl Into<String>) -> CoreError {
    CoreError::Subtitles {
        provider,
        message: message.into(),
    }
}

async fn get_bytes(provider: &'static str, req: reqwest::RequestBuilder) -> Result<Vec<u8>> {
    let resp = req.send().await.map_err(|e| err(provider, e.to_string()))?;
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| err(provider, e.to_string()))?;
    if !status.is_success() {
        return Err(err(
            provider,
            http_error_message(provider, status.as_u16(), &bytes),
        ));
    }
    Ok(bytes.to_vec())
}

fn http_error_message(provider: &str, status: u16, body: &[u8]) -> String {
    let body = String::from_utf8_lossy(body);
    if looks_like_cloudflare(status, &body) {
        return "bloqueado por Cloudflare: se omite (no se evaden bloqueos, R-09)".into();
    }
    let detail: String = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v.get("message")
                .or_else(|| v.get("error"))
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or_default();
    match status {
        401 | 403 => format!("API key rechazada o sin permiso ({status}) {detail}"),
        429 => format!("límite de pedidos alcanzado (429) {detail}"),
        406 if provider.eq_ignore_ascii_case(OPENSUBTITLES) => {
            format!("cuota diaria agotada (406) {detail}")
        }
        _ => format!("HTTP {status} {detail}"),
    }
}

fn looks_like_cloudflare(status: u16, body: &str) -> bool {
    matches!(status, 403 | 503) && (body.contains("Just a moment") || body.contains("cf_chl"))
}

// ---------- texto, caché, archivos ----------

/// Bytes de un subtítulo → texto UTF-8: UTF-8 (con o sin BOM), UTF-16 con BOM, o
/// Windows-1252/Latin-1 (subtítulos en español viejos).
pub(crate) fn to_utf8(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE.decode(bytes).0.into_owned();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE.decode(bytes).0.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned(),
    }
}

fn sanitize(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    s.chars().take(120).collect()
}

/// Ruta en caché de un candidato ya bajado (srt o ass), si existe. Evita volver a gastar cuota.
pub fn cached(cache_dir: &Path, cand: &SubtitleCandidate) -> Option<PathBuf> {
    cached_by_key(cache_dir, &cand.key())
}

/// Igual que [`cached`] pero por la clave `proveedor:id` (la que guarda la memoria, FR-28).
pub fn cached_by_key(cache_dir: &Path, key: &str) -> Option<PathBuf> {
    ["srt", "ass"]
        .iter()
        .map(|ext| cache_dir.join(format!("{}.{ext}", sanitize(key))))
        .find(|p| p.is_file())
}

/// Lee `[start, start+len)` del video por el servidor local del motor (para el hash).
pub(crate) async fn fetch_range(url: &str, start: u64, len: u64) -> Result<Vec<u8>> {
    if len == 0 {
        return Ok(Vec::new());
    }
    let req = local_http().get(url).header(
        reqwest::header::RANGE,
        format!("bytes={start}-{}", start + len - 1),
    );
    get_bytes("motor", req).await
}

/// Guarda el subtítulo normalizado a UTF-8 en la caché. Rechaza lo que no tiene ningún evento
/// (páginas de error, archivos vacíos).
fn save(cache_dir: &Path, cand: &SubtitleCandidate, bytes: &[u8]) -> Result<PathBuf> {
    let text = to_utf8(bytes);
    let cues = merge::parse_any(&text);
    if cues.is_empty() {
        return Err(err(cand.provider, "lo bajado no es un subtítulo"));
    }
    let ext = if text.contains("[Events]") {
        "ass"
    } else {
        "srt"
    };
    let path = cache_dir.join(format!("{}.{ext}", sanitize(&cand.key())));
    std::fs::create_dir_all(cache_dir).map_err(|source| CoreError::Io {
        path: cache_dir.to_path_buf(),
        source,
    })?;
    std::fs::write(&path, text.as_bytes()).map_err(|source| CoreError::Io {
        path: path.clone(),
        source,
    })?;
    Ok(path)
}

/// Subdivx entrega `.zip`/`.rar`. Se descomprimen con el `tar` del sistema (bsdtar/libarchive:
/// viene con Windows 10+ y macOS y lee zip, rar y 7z) para no sumar dependencias (NFR-14).
/// Devuelve el subtítulo más grande del archivo (o los bytes tal cual si no es un archivo).
async fn extract_if_archive(
    provider: &'static str,
    bytes: Vec<u8>,
    work: &Path,
) -> Result<Vec<u8>> {
    let is_archive = bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"Rar!")
        || bytes.starts_with(&[0x37, 0x7A, 0xBC, 0xAF]);
    if !is_archive {
        return Ok(bytes);
    }
    let _ = std::fs::remove_dir_all(work);
    std::fs::create_dir_all(work).map_err(|source| CoreError::Io {
        path: work.to_path_buf(),
        source,
    })?;
    let archive = work.join("archivo.bin");
    let out = work.join("x");
    std::fs::create_dir_all(&out).map_err(|source| CoreError::Io {
        path: out.clone(),
        source,
    })?;
    std::fs::write(&archive, &bytes).map_err(|source| CoreError::Io {
        path: archive.clone(),
        source,
    })?;
    let mut cmd = tokio::process::Command::new("tar");
    cmd.arg("-xf")
        .arg(&archive)
        .arg("-C")
        .arg(&out)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let status = tokio::time::timeout(Duration::from_secs(20), cmd.status())
        .await
        .map_err(|_| err(provider, "descomprimir tardó demasiado"))?
        .map_err(|e| err(provider, format!("no se pudo ejecutar tar: {e}")))?;
    let result = if status.success() {
        largest_subtitle(&out)
            .and_then(|p| std::fs::read(p).ok())
            .ok_or_else(|| err(provider, "el archivo comprimido no trae .srt/.ass"))
    } else {
        Err(err(
            provider,
            format!("tar no pudo descomprimir ({status})"),
        ))
    };
    let _ = std::fs::remove_dir_all(work);
    result
}

fn largest_subtitle(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in std::fs::read_dir(&d).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let is_sub = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "srt" | "ass" | "ssa"));
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let bigger = match &best {
                Some((s, _)) => size > *s,
                None => true,
            };
            if is_sub && bigger {
                best = Some((size, path));
            }
        }
    }
    best.map(|(_, p)| p)
}

// ---------- idioma, variante, coincidencia ----------

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// Variante del español por texto libre (descripción, release, nombre del idioma).
pub(crate) fn variant_from_text(text: &str) -> SpanishVariant {
    let w = words(text);
    let has = |x: &str| w.iter().any(|t| t == x);
    let lower = text.to_lowercase();
    if has("latino")
        || has("latam")
        || has("lat")
        || has("419")
        || has("latinoamerica")
        || has("latinoamericano")
        || lower.contains("latin america")
        || lower.contains("latinoamérica")
        || lower.contains("es-mx")
        || lower.contains("mexic")
        || lower.contains("argentin")
    {
        SpanishVariant::Latino
    } else if has("castellano")
        || has("españa")
        || has("spain")
        || has("castilian")
        || has("european")
        || lower.contains("es-es")
        || lower.contains("(eu)")
    {
        SpanishVariant::Spain
    } else {
        SpanishVariant::Unknown
    }
}

/// Idioma (y variante) por el nombre de un archivo de subtítulo del torrent:
/// `Sintel.es.srt`, `2_Spanish.srt`, `peli.spa.lat.srt`, `x.es-419.srt`, `x.eng.srt`.
pub(crate) fn lang_from_name(name: &str) -> Option<(SubtitleLanguage, SpanishVariant)> {
    let file = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let w = words(file);
    let spanish = w.iter().any(|t| {
        matches!(
            t.as_str(),
            "es" | "spa" | "spanish" | "español" | "espanol" | "esp" | "castellano" | "latino"
        )
    });
    if spanish {
        let es_count = w.iter().filter(|t| *t == "es").count();
        let variant = match variant_from_text(file) {
            SpanishVariant::Unknown if es_count >= 2 => SpanishVariant::Spain, // "es-ES"
            v => v,
        };
        return Some((SubtitleLanguage::Es, variant));
    }
    let english = w
        .iter()
        .any(|t| matches!(t.as_str(), "en" | "eng" | "english"));
    english.then_some((SubtitleLanguage::En, SpanishVariant::Unknown))
}

/// Coincidencia por nombre de release (FR-24): mismo grupo, o el mismo nombre de archivo.
pub(crate) fn release_match(video: &VideoIdentity, release: &str) -> MatchKind {
    let r = release.to_lowercase();
    let stem = video
        .file_name
        .rsplit_once('.')
        .map_or(video.file_name.as_str(), |(s, _)| s)
        .to_lowercase();
    let group = video
        .release_group
        .as_deref()
        .map(str::to_lowercase)
        .filter(|g| g.len() >= 2);
    if (!stem.is_empty() && r.contains(&stem)) || group.is_some_and(|g| words(&r).contains(&g)) {
        MatchKind::Release
    } else {
        MatchKind::None
    }
}

fn normalized_title(s: &str) -> String {
    words(s).join(" ")
}

/// Percent-encoding para un segmento de URL.
fn pct(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// ---------- IMDb id (Wyzie lo exige) ----------

/// Resuelve el IMDb id por título (+año): Cinemeta (spec ADR-16) y, si no aparece (cortos como
/// Sintel no están en su búsqueda), el buscador público de sugerencias de IMDb. Sin keys.
pub async fn resolve_imdb(video: &VideoIdentity) -> Option<String> {
    let title = video.title.as_deref()?;
    let wanted = normalized_title(title);
    let kind = if video.season.is_some() {
        "series"
    } else {
        "movie"
    };
    let year_ok = |y: Option<u16>| match (video.year, y) {
        (Some(a), Some(b)) => a.abs_diff(b) <= 1,
        _ => true,
    };

    let url = format!(
        "https://v3-cinemeta.strem.io/catalog/{kind}/top/search={}.json",
        pct(title)
    );
    if let Ok(bytes) = get_bytes("Cinemeta", http().get(&url)).await {
        if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
            let found = v["metas"].as_array().into_iter().flatten().find(|m| {
                let year = m["releaseInfo"]
                    .as_str()
                    .and_then(|r| r.get(..4))
                    .and_then(|r| r.parse().ok());
                m["name"].as_str().map(normalized_title).as_deref() == Some(wanted.as_str())
                    && year_ok(year)
            });
            if let Some(id) = found.and_then(|m| m["imdb_id"].as_str().or(m["id"].as_str())) {
                return Some(id.to_string());
            }
        }
    }

    let url = format!(
        "https://v3.sg.media-imdb.com/suggestion/x/{}.json",
        pct(&title.to_lowercase())
    );
    let bytes = get_bytes("IMDb", http().get(&url)).await.ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v["d"]
        .as_array()?
        .iter()
        .find(|m| {
            m["id"].as_str().is_some_and(|id| id.starts_with("tt"))
                && m["l"].as_str().map(normalized_title).as_deref() == Some(wanted.as_str())
                && year_ok(m["y"].as_u64().map(|y| y as u16))
        })
        .and_then(|m| m["id"].as_str())
        .map(String::from)
}

// ---------- 1. Subtítulos del torrent (FR-22) ----------

#[derive(Debug, Clone)]
pub struct TorrentSubtitleFile {
    /// Ruta relativa dentro del torrent.
    pub name: String,
    /// URL del motor (127.0.0.1): se lee por el stream, que pide solo esas piezas.
    pub url: String,
}

pub struct TorrentProvider {
    pub files: Vec<TorrentSubtitleFile>,
}

#[async_trait]
impl SubtitleProvider for TorrentProvider {
    fn id(&self) -> &'static str {
        TORRENT_PROVIDER
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(None)
    }
    async fn search(
        &self,
        _video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        Ok(self
            .files
            .iter()
            .filter_map(|f| {
                let (l, variant) = lang_from_name(&f.name)?;
                (l == lang).then(|| SubtitleCandidate {
                    provider: TORRENT_PROVIDER,
                    provider_id: f.name.clone(),
                    release_name: f.name.rsplit(['/', '\\']).next().unwrap_or(&f.name).into(),
                    language: l,
                    // Vienen con el mismo archivo de video: la mejor coincidencia posible.
                    match_kind: MatchKind::Hash,
                    downloads: 0,
                    variant,
                    url: f.url.clone(),
                })
            })
            .collect())
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let bytes = get_bytes(TORRENT_PROVIDER, local_http().get(&cand.url)).await?;
        save(cache_dir, cand, &bytes)
    }
}

// ---------- 2. Wyzie Subs (Q-04) ----------

pub struct WyzieProvider {
    key: Option<String>,
}

impl WyzieProvider {
    /// Con la key del almacén seguro (o sin key → se omite).
    pub fn from_store() -> Self {
        Self {
            key: super::secrets::api_key(WYZIE),
        }
    }
}

/// Parser puro de `GET sub.wyzie.io/search` (lista de objetos).
pub(crate) fn parse_wyzie(
    json: &Value,
    video: &VideoIdentity,
    lang: SubtitleLanguage,
) -> Vec<SubtitleCandidate> {
    let want = match lang {
        SubtitleLanguage::Es => "es",
        SubtitleLanguage::En => "en",
        SubtitleLanguage::None => return Vec::new(),
    };
    json.as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["ai"].as_bool() != Some(true))
        .filter(|s| {
            s["language"]
                .as_str()
                .is_some_and(|l| l.to_lowercase().starts_with(want))
        })
        .filter_map(|s| {
            let url = s["url"].as_str()?.to_string();
            let id = match &s["id"] {
                Value::String(x) => x.clone(),
                Value::Number(n) => n.to_string(),
                _ => return None,
            };
            let release = s["release"]
                .as_str()
                .or(s["fileName"].as_str())
                .or(s["media"].as_str())
                .unwrap_or_default()
                .to_string();
            let reasons: Vec<&str> = s["match"]["reasons"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let match_kind = if reasons.contains(&"hash") {
                MatchKind::Hash
            } else if reasons
                .iter()
                .any(|r| matches!(*r, "group" | "source" | "resolution"))
            {
                MatchKind::Release
            } else {
                release_match(video, &release)
            };
            let variant = if lang == SubtitleLanguage::Es {
                wyzie_variant(s)
            } else {
                SpanishVariant::Unknown
            };
            Some(SubtitleCandidate {
                provider: WYZIE,
                provider_id: id,
                release_name: release,
                language: lang,
                match_kind,
                downloads: s["downloadCount"]
                    .as_u64()
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32,
                variant,
                url,
            })
        })
        .collect()
}

/// País de la bandera (`flagsapi.com/MX/flat/24.png`) → variante; si no, el texto.
fn wyzie_variant(s: &Value) -> SpanishVariant {
    const LATAM: &[&str] = &[
        "MX", "AR", "CO", "CL", "PE", "VE", "UY", "EC", "BO", "PY", "CR", "GT", "HN", "SV", "NI",
        "PA", "DO", "CU", "PR",
    ];
    let country = s["flagUrl"]
        .as_str()
        .and_then(|u| u.split('/').rev().nth(2))
        .unwrap_or_default()
        .to_ascii_uppercase();
    if country == "ES" {
        return SpanishVariant::Spain;
    }
    if LATAM.contains(&country.as_str()) {
        return SpanishVariant::Latino;
    }
    let text = format!(
        "{} {} {}",
        s["language"].as_str().unwrap_or_default(),
        s["display"].as_str().unwrap_or_default(),
        s["release"].as_str().unwrap_or_default()
    );
    variant_from_text(&text)
}

#[async_trait]
impl SubtitleProvider for WyzieProvider {
    fn id(&self) -> &'static str {
        WYZIE
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        // Plan gratis: 1000 pedidos/día; no se consulta (sería un pedido más).
        Ok(None)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        let Some(key) = &self.key else {
            return Err(err("Wyzie", "sin API key configurada: se omite"));
        };
        let Some(imdb) = &video.imdb_id else {
            return Err(err("Wyzie", "no se pudo identificar la película (IMDb)"));
        };
        let language = if lang == SubtitleLanguage::En {
            "en"
        } else {
            "es"
        };
        let mut query: Vec<(&str, String)> = vec![
            ("id", imdb.clone()),
            ("language", language.into()),
            ("format", "srt,ass".into()),
            ("video", video.file_name.clone()),
            ("key", key.clone()),
        ];
        if let Some(h) = video.movie_hash {
            query.push(("hash", format!("{h:016x}")));
        }
        if let (Some(s), Some(e)) = (video.season, video.episode) {
            query.push(("season", s.to_string()));
            query.push(("episode", e.to_string()));
        }
        let req = http().get("https://sub.wyzie.io/search").query(&query);
        let bytes = match get_bytes("Wyzie", req).await {
            // 404 = no hay nada para ese título: no es un error.
            Err(CoreError::Subtitles { message, .. }) if message.starts_with("HTTP 404") => {
                return Ok(Vec::new())
            }
            other => other?,
        };
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err("Wyzie", format!("respuesta inválida: {e}")))?;
        Ok(parse_wyzie(&json, video, lang))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let bytes = get_bytes("Wyzie", http().get(&cand.url)).await?;
        save(cache_dir, cand, &bytes)
    }
}

// ---------- 3. Subdivx (Q-02, experimental) ----------

pub struct SubdivxProvider;

const SUBDIVX_BASE: &str = "https://www.subdivx.com";

/// Parser puro del JSON de `inc/ajax.php` (`aaData`: id, titulo, descripcion, descargas).
pub(crate) fn parse_subdivx(json: &Value, video: &VideoIdentity) -> Vec<SubtitleCandidate> {
    let wanted = video
        .title
        .as_deref()
        .map(normalized_title)
        .unwrap_or_default();
    json["aaData"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let id = match &s["id"] {
                Value::Number(n) => n.to_string(),
                Value::String(x) if !x.is_empty() => x.clone(),
                _ => return None,
            };
            let titulo = s["titulo"].as_str().unwrap_or_default();
            // El buscador devuelve también otras películas con palabras parecidas.
            if !wanted.is_empty() && !normalized_title(titulo).contains(&wanted) {
                return None;
            }
            if let (Some(y), Some(found)) = (video.year, year_in(titulo)) {
                if y.abs_diff(found) > 1 {
                    return None;
                }
            }
            let descripcion = s["descripcion"].as_str().unwrap_or_default();
            let downloads = match &s["descargas"] {
                Value::Number(n) => n.as_u64().unwrap_or(0),
                Value::String(x) => x.replace(['.', ','], "").parse().unwrap_or(0),
                _ => 0,
            };
            let short: String = descripcion.chars().take(80).collect();
            Some(SubtitleCandidate {
                provider: SUBDIVX,
                provider_id: id,
                release_name: format!("{titulo} — {short}"),
                language: SubtitleLanguage::Es,
                match_kind: release_match(video, descripcion),
                downloads: downloads.min(u32::MAX as u64) as u32,
                variant: variant_from_text(descripcion),
                url: String::new(),
            })
        })
        .collect()
}

fn year_in(text: &str) -> Option<u16> {
    words(text)
        .iter()
        .filter(|w| w.len() == 4)
        .filter_map(|w| w.parse::<u16>().ok())
        .find(|y| (1900..=2099).contains(y))
}

/// Cookies de una respuesta (`Set-Cookie`) → cabecera `Cookie` (sin sumar la feature de cookies).
fn cookies_of(resp: &reqwest::Response) -> String {
    resp.headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .collect::<Vec<_>>()
        .join("; ")
}

impl SubdivxProvider {
    async fn fetch(&self, req: reqwest::RequestBuilder) -> Result<(String, String)> {
        let resp = req
            .send()
            .await
            .map_err(|e| err("Subdivx", e.to_string()))?;
        let status = resp.status().as_u16();
        let cookies = cookies_of(&resp);
        let body = resp
            .text()
            .await
            .map_err(|e| err("Subdivx", e.to_string()))?;
        if !(200..300).contains(&status) {
            return Err(err(
                "Subdivx",
                http_error_message(SUBDIVX, status, body.as_bytes()),
            ));
        }
        Ok((body, cookies))
    }
}

#[async_trait]
impl SubtitleProvider for SubdivxProvider {
    fn id(&self) -> &'static str {
        SUBDIVX
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(None)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        if lang != SubtitleLanguage::Es {
            return Ok(Vec::new()); // Subdivx es solo español.
        }
        let Some(title) = &video.title else {
            return Ok(Vec::new());
        };
        let query = match (video.season, video.episode, video.year) {
            (Some(s), Some(e), _) => format!("{title} S{s:02}E{e:02}"),
            (_, _, Some(y)) => format!("{title} {y}"),
            _ => title.clone(),
        };
        // 1. Portada: cookie de sesión y nombre del campo de búsqueda (cambia: "buscar393"…).
        let (home, mut cookies) = self.fetch(http().get(format!("{SUBDIVX_BASE}/"))).await?;
        let field = home
            .find("name=\"buscar")
            .map(|i| {
                let rest = &home[i + 6..];
                rest.chars()
                    .take_while(|c| c.is_ascii_alphanumeric())
                    .collect::<String>()
            })
            .filter(|f| f.starts_with("buscar"))
            .unwrap_or_else(|| "buscar".into());
        // 2. Token anti-CSRF.
        let (token_body, more) = self
            .fetch(
                http()
                    .get(format!("{SUBDIVX_BASE}/inc/gt.php?gt=1"))
                    .header(reqwest::header::COOKIE, &cookies),
            )
            .await?;
        if !more.is_empty() {
            cookies = format!("{cookies}; {more}");
        }
        let token = serde_json::from_str::<Value>(&token_body)
            .ok()
            .and_then(|v| v["token"].as_str().map(String::from))
            .unwrap_or_default();
        // 3. Búsqueda.
        let form = [
            ("tabla", "resultados".to_string()),
            ("filtros", String::new()),
            (field.as_str(), query),
            ("token", token),
        ];
        let (body, _) = self
            .fetch(
                http()
                    .post(format!("{SUBDIVX_BASE}/inc/ajax.php"))
                    .header(reqwest::header::COOKIE, &cookies)
                    .header("X-Requested-With", "XMLHttpRequest")
                    .form(&form),
            )
            .await?;
        let json: Value = serde_json::from_str(&body).map_err(|e| {
            err(
                "Subdivx",
                format!("la web cambió (respuesta no es JSON): {e}"),
            )
        })?;
        Ok(parse_subdivx(&json, video))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let url = format!("{SUBDIVX_BASE}/descargar.php?id={}", pct(&cand.provider_id));
        let bytes = get_bytes("Subdivx", http().get(url)).await?;
        let work = cache_dir.join(format!(".tmp-{}", sanitize(&cand.key())));
        let bytes = extract_if_archive("Subdivx", bytes, &work).await?;
        save(cache_dir, cand, &bytes)
    }
}

// ---------- 4. OpenSubtitles (Q-01) ----------

const OS_API: &str = "https://api.opensubtitles.com/api/v1";
/// Cuota de la cuenta gratuita (Q-01); la real llega en cada descarga (`remaining`).
const OS_PER_DAY: u32 = 20;

pub struct OpenSubtitlesProvider {
    key: Option<String>,
    quota: Mutex<Option<Quota>>,
}

impl OpenSubtitlesProvider {
    pub fn from_store() -> Self {
        Self {
            key: super::secrets::api_key(OPENSUBTITLES),
            quota: Mutex::new(None),
        }
    }
    pub fn has_key(&self) -> bool {
        self.key.is_some()
    }
    fn key(&self) -> Result<&str> {
        self.key
            .as_deref()
            .ok_or_else(|| err("OpenSubtitles", "sin API key configurada: se omite"))
    }
}

/// Parser puro de `GET /subtitles`. Códigos: `ea` = Spanish (LA), `sp` = Spanish (EU), `es` = Spanish.
pub(crate) fn parse_opensubtitles(
    json: &Value,
    video: &VideoIdentity,
    lang: SubtitleLanguage,
) -> Vec<SubtitleCandidate> {
    json["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let a = &item["attributes"];
            let code = a["language"].as_str().unwrap_or_default();
            let (language, variant) = match code {
                "ea" => (SubtitleLanguage::Es, SpanishVariant::Latino),
                "sp" => (SubtitleLanguage::Es, SpanishVariant::Spain),
                "es" => (SubtitleLanguage::Es, SpanishVariant::Unknown),
                "en" => (SubtitleLanguage::En, SpanishVariant::Unknown),
                _ => return None,
            };
            if language != lang {
                return None;
            }
            let file_id = a["files"].as_array()?.first()?["file_id"].as_u64()?;
            let release = a["release"].as_str().unwrap_or_default().to_string();
            let match_kind = if a["moviehash_match"].as_bool() == Some(true) {
                MatchKind::Hash
            } else {
                release_match(video, &release)
            };
            Some(SubtitleCandidate {
                provider: OPENSUBTITLES,
                provider_id: file_id.to_string(),
                release_name: release,
                language,
                match_kind,
                downloads: a["download_count"]
                    .as_u64()
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32,
                variant,
                url: String::new(),
            })
        })
        .collect()
}

#[async_trait]
impl SubtitleProvider for OpenSubtitlesProvider {
    fn id(&self) -> &'static str {
        OPENSUBTITLES
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(*self.quota.lock().expect("quota"))
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        let key = self.key()?;
        let languages = if lang == SubtitleLanguage::En {
            "en"
        } else {
            "ea,es,sp"
        };
        let mut query: Vec<(&str, String)> = vec![("languages", languages.into())];
        if let Some(h) = video.movie_hash {
            query.push(("moviehash", format!("{h:016x}")));
        }
        match (&video.imdb_id, &video.title) {
            (Some(imdb), _) => query.push(("imdb_id", imdb.trim_start_matches("tt").into())),
            (None, Some(t)) => query.push(("query", t.clone())),
            (None, None) => {}
        }
        if let Some(y) = video.year {
            query.push(("year", y.to_string()));
        }
        if let (Some(s), Some(e)) = (video.season, video.episode) {
            query.push(("season_number", s.to_string()));
            query.push(("episode_number", e.to_string()));
        }
        let req = http()
            .get(format!("{OS_API}/subtitles"))
            .header("Api-Key", key)
            .header(reqwest::header::ACCEPT, "application/json")
            .query(&query);
        let bytes = get_bytes("OpenSubtitles", req).await?;
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err("OpenSubtitles", format!("respuesta inválida: {e}")))?;
        Ok(parse_opensubtitles(&json, video, lang))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p); // de la caché: no gasta cuota
        }
        if let Some(q) = *self.quota.lock().expect("quota") {
            if q.remaining == 0 {
                return Err(err(
                    "OpenSubtitles",
                    "cuota diaria agotada (se renueva cada 24 h)",
                ));
            }
        }
        let key = self.key()?;
        let body = serde_json::json!({ "file_id": cand.provider_id.parse::<u64>().unwrap_or(0) });
        let req = http()
            .post(format!("{OS_API}/download"))
            .header("Api-Key", key)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string());
        let bytes = get_bytes("OpenSubtitles", req).await?;
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err("OpenSubtitles", format!("respuesta inválida: {e}")))?;
        if let Some(remaining) = json["remaining"].as_i64() {
            let used = json["requests"].as_u64().unwrap_or(0) as u32;
            let remaining = remaining.max(0) as u32;
            *self.quota.lock().expect("quota") = Some(Quota {
                remaining,
                per_day: (used + remaining).max(OS_PER_DAY),
            });
        }
        let link = json["link"]
            .as_str()
            .ok_or_else(|| err("OpenSubtitles", "la descarga no trajo link"))?;
        let bytes = get_bytes("OpenSubtitles", http().get(link)).await?;
        save(cache_dir, cand, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/subtitles")
            .join(name);
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    fn video() -> VideoIdentity {
        VideoIdentity {
            file_name: "Sintel.2010.720p.BluRay.x264-SURFER.mkv".into(),
            title: Some("Sintel".into()),
            year: Some(2010),
            release_group: Some("SURFER".into()),
            ..Default::default()
        }
    }

    #[test]
    fn wyzie_parser() {
        let c = parse_wyzie(
            &fixture("wyzie-search.json"),
            &video(),
            SubtitleLanguage::Es,
        );
        assert_eq!(c.len(), 3, "sin el inglés ni la fila de IA");
        assert_eq!(c[0].provider_id, "1955024019");
        assert_eq!(c[0].match_kind, MatchKind::Hash);
        assert_eq!(c[0].variant, SpanishVariant::Latino, "bandera MX");
        assert_eq!(c[0].downloads, 4821);
        assert!(c[0].url.starts_with("https://sub.wyzie.io/c/"));
        assert_eq!(c[1].variant, SpanishVariant::Spain, "bandera ES");
        assert_eq!(c[1].match_kind, MatchKind::Release, "por el grupo SURFER");
        assert_eq!(c[2].variant, SpanishVariant::Unknown);
        assert_eq!(c[2].match_kind, MatchKind::None);
    }

    #[test]
    fn subdivx_parser() {
        let c = parse_subdivx(&fixture("subdivx-search.json"), &video());
        assert_eq!(c.len(), 3, "sin la otra película ni el año que no coincide");
        assert_eq!(c[0].provider_id, "725040");
        assert_eq!(c[0].variant, SpanishVariant::Latino);
        assert_eq!(c[0].match_kind, MatchKind::Release);
        assert_eq!(c[0].downloads, 12_345);
        assert_eq!(c[1].variant, SpanishVariant::Spain);
        assert_eq!(c[2].variant, SpanishVariant::Unknown);
        assert_eq!(
            c[2].downloads, 1_502,
            "descargas como texto con punto de miles"
        );
    }

    #[test]
    fn opensubtitles_parser() {
        let c = parse_opensubtitles(
            &fixture("opensubtitles-search.json"),
            &video(),
            SubtitleLanguage::Es,
        );
        assert_eq!(c.len(), 3, "sin el inglés");
        assert_eq!(c[0].provider_id, "7001");
        assert_eq!(
            (c[0].variant, c[0].match_kind),
            (SpanishVariant::Latino, MatchKind::Hash)
        );
        assert_eq!(
            (c[1].variant, c[1].match_kind),
            (SpanishVariant::Spain, MatchKind::Release)
        );
        assert_eq!(c[2].variant, SpanishVariant::Unknown);
    }

    #[test]
    fn idioma_por_nombre_de_archivo() {
        use SpanishVariant::*;
        let es = SubtitleLanguage::Es;
        assert_eq!(lang_from_name("Sintel/Sintel.es.srt"), Some((es, Unknown)));
        assert_eq!(lang_from_name("Subs/2_Spanish.srt"), Some((es, Unknown)));
        assert_eq!(lang_from_name("peli.spa.latino.srt"), Some((es, Latino)));
        assert_eq!(lang_from_name("peli.es-419.srt"), Some((es, Latino)));
        assert_eq!(lang_from_name("peli.es-ES.srt"), Some((es, Spain)));
        assert_eq!(lang_from_name("peli.castellano.srt"), Some((es, Spain)));
        assert_eq!(
            lang_from_name("Sintel/Sintel.en.srt"),
            Some((SubtitleLanguage::En, Unknown))
        );
        assert_eq!(lang_from_name("Sintel/Sintel.de.srt"), None);
    }

    #[test]
    fn texto_a_utf8() {
        assert_eq!(to_utf8(b"\xEF\xBB\xBFhola"), "hola");
        assert_eq!(to_utf8(b"canci\xf3n"), "canción");
        assert_eq!(to_utf8("ñandú".as_bytes()), "ñandú");
        assert_eq!(to_utf8(&[0xFF, 0xFE, b'h', 0, b'i', 0]), "hi");
    }

    #[test]
    fn cloudflare_se_detecta() {
        let m = http_error_message(SUBDIVX, 403, b"<title>Just a moment...</title>");
        assert!(m.contains("Cloudflare"));
    }

    #[tokio::test]
    async fn guarda_en_cache_y_rechaza_basura() {
        let dir =
            std::env::temp_dir().join(format!("tstream-test-subcache-{}", std::process::id()));
        let cand = SubtitleCandidate {
            provider: WYZIE,
            provider_id: "a/b".into(),
            release_name: String::new(),
            language: SubtitleLanguage::Es,
            match_kind: MatchKind::None,
            downloads: 0,
            variant: SpanishVariant::Unknown,
            url: String::new(),
        };
        assert!(save(&dir, &cand, b"<html>error</html>").is_err());
        assert_eq!(cached(&dir, &cand), None);
        let p = save(&dir, &cand, b"1\n00:00:01,000 --> 00:00:02,000\nhola\n").unwrap();
        assert_eq!(cached(&dir, &cand), Some(p));
        // Un archivo que no es comprimido pasa tal cual.
        let raw = extract_if_archive("x", b"texto".to_vec(), &dir.join("w"))
            .await
            .unwrap();
        assert_eq!(raw, b"texto");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
