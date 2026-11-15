//! `catalog` — buscar películas y series (Cinemeta) y juntar torrents de addons de Stremio
//! (spec 09, F4b). No indexa ni scrapea contenido propio (ADR-16/17); solo P2P (ADR-21).
//! No conoce `engine`, `analyzer` ni `playback`: la orquestación vive en `AppCore` (spec 09 §6.1);
//! acá queda lo propio del catálogo (fechas, contexto de una consulta, origen de una fila).
//! Usa `trackers` (scrape de seeders), `audio` y el parser de releases de `subtitles`.

pub mod addons;
pub mod aggregate;
pub mod cinemeta;
pub mod http;
pub mod normalize;
pub mod protocol;
pub mod tmdb;

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::config::{AddonEntry, CatalogConfig, Config};
use crate::library::CatalogOrigin;
use crate::magnet::{InfoHash, Magnet};
use crate::{CoreError, Result};
use addons::Addon;
use cinemeta::{BrowseCursor, BrowsePage, BrowseSort, Meta, MetaPreview, SearchResults};
use http::{FetchError, Http};
use normalize::StreamCandidate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaKind {
    Movie,
    Series,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Movie => "movie",
            Self::Series => "series",
        }
    }
}

/// `tt…` válido (`^tt\d{5,10}$`).
pub fn is_imdb_id(id: &str) -> bool {
    id.strip_prefix("tt")
        .is_some_and(|d| (5..=10).contains(&d.len()) && d.bytes().all(|b| b.is_ascii_digit()))
}

/// Lo que se pide a los addons (spec 10 §A.3): `tt…` o `tt…:T:E`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VideoId {
    Movie(String),
    Episode {
        show: String,
        season: u32,
        episode: u32,
    },
}

impl VideoId {
    pub fn parse(s: &str) -> Result<Self> {
        let bad = || CoreError::NotFound(format!("video \"{}\"", normalize::clean(s)));
        let mut parts = s.trim().split(':');
        let id = parts.next().filter(|id| is_imdb_id(id)).ok_or_else(bad)?;
        match (parts.next(), parts.next(), parts.next()) {
            (None, _, _) => Ok(Self::Movie(id.into())),
            (Some(s), Some(e), None) => Ok(Self::Episode {
                show: id.into(),
                season: s.parse().map_err(|_| bad())?,
                episode: e.parse().map_err(|_| bad())?,
            }),
            _ => Err(bad()),
        }
    }

    pub fn imdb_id(&self) -> &str {
        match self {
            Self::Movie(id) | Self::Episode { show: id, .. } => id,
        }
    }

    pub fn episode(&self) -> Option<(u32, u32)> {
        match self {
            Self::Movie(_) => None,
            Self::Episode {
                season, episode, ..
            } => Some((*season, *episode)),
        }
    }
}

impl fmt::Display for VideoId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Movie(id) => f.write_str(id),
            Self::Episode {
                show,
                season,
                episode,
            } => write!(f, "{show}:{season}:{episode}"),
        }
    }
}

/// Fila de Ajustes → Fuentes (FR-41). La URL completa nunca sale del núcleo si es secreta.
#[derive(Debug, Clone, Serialize)]
pub struct AddonView {
    pub id: String,
    pub name: String,
    pub display_url: String,
    pub enabled: bool,
    pub secret: bool,
}

impl From<&AddonEntry> for AddonView {
    fn from(e: &AddonEntry) -> Self {
        Self {
            id: e.id.clone(),
            name: e.name.clone(),
            display_url: e.display_url.clone(),
            enabled: e.enabled,
            secret: e.secret,
        }
    }
}

fn secret_account(id: &str) -> String {
    format!("addon-url-{id}")
}

pub fn fetch_error(what: &str, e: &FetchError) -> CoreError {
    CoreError::Catalog {
        user: format!("No se pudo {what}: {}.", e.user_text()),
        detail: format!("{what}: {e:?}"),
    }
}

/// Un candidato listo para *Mis magnets* (spec 09 §8.1): magnet con los trackers de la config
/// y de dónde salió.
#[derive(Debug, Clone)]
pub struct CatalogPick {
    pub magnet: Magnet,
    pub origin: CatalogOrigin,
    pub size_bytes: Option<u64>,
}

/// Estado del catálogo que vive mientras la app está abierta (lo usa `AppCore`).
pub struct Catalog {
    pub http: Http,
    /// shortcut: caché en memoria sin límite ni TTL; en disco con TTL en la Entrega 2 (FR-52).
    metas: Mutex<HashMap<String, Meta>>,
    search: Mutex<CancellationToken>,
    streams_task: Mutex<Option<tokio::task::AbortHandle>>,
    /// Última lista de candidatos (para analizar / reproducir uno por hash).
    pub latest: Arc<Mutex<aggregate::Latest>>,
    /// Manifests ya leídos (por id + URL).
    addons: Mutex<HashMap<String, Arc<Addon>>>,
    /// Pósters de TMDB para los títulos sin imagen en Cinemeta.
    posters: tmdb::Posters,
}

impl Catalog {
    pub fn new(cfg: &CatalogConfig) -> Self {
        Self {
            http: Http::new(Duration::from_millis(cfg.connect_timeout_ms)),
            metas: Mutex::default(),
            search: Mutex::default(),
            streams_task: Mutex::default(),
            latest: Arc::default(),
            addons: Mutex::default(),
            posters: tmdb::Posters::default(),
        }
    }

    /// Póster de TMDB para un título sin imagen en Cinemeta; `None` sin key o si TMDB no lo tiene.
    pub async fn poster(&self, imdb_id: &str, timeout: Duration) -> Option<String> {
        if !is_imdb_id(imdb_id) {
            return None;
        }
        self.posters.poster(&self.http, imdb_id, timeout).await
    }

    /// FR-36: películas y series en paralelo. Una búsqueda nueva cancela la anterior
    /// (como mucho 1 pedido en vuelo por tipo). Devuelve también el token de ESTA búsqueda, para
    /// cortar con ella el filtro de fondo ([`Self::find_excluded`]).
    pub async fn search(
        &self,
        query: &str,
        timeout: Duration,
    ) -> Result<(SearchResults, CancellationToken)> {
        let token = {
            let mut cur = self.search.lock().expect("search");
            cur.cancel();
            *cur = CancellationToken::new();
            cur.clone()
        };
        let both = async {
            tokio::join!(
                cinemeta::search(&self.http, MediaKind::Movie, query, timeout),
                cinemeta::search(&self.http, MediaKind::Series, query, timeout),
            )
        };
        let (movies, series) = tokio::select! {
            r = both => r,
            _ = token.cancelled() => return Err(CoreError::Cancelled),
        };
        match (movies, series) {
            (Err(e), Err(_)) => Err(fetch_error("buscar", &e)),
            (m, s) => Ok((
                SearchResults {
                    movies: m.unwrap_or_default(),
                    series: s.unwrap_or_default(),
                },
                token,
            )),
        }
    }

    /// FR-36 + FR-40: [`Self::search`] (menos de 2 letras = sin resultados) y, en segundo plano,
    /// [`Self::find_excluded`] para avisar con `on_excluded` cuáles son anime / japonés.
    pub async fn search_flagging_excluded(
        self: &Arc<Self>,
        query: &str,
        timeout: Duration,
        on_excluded: impl Fn(String) + Send + 'static,
    ) -> Result<SearchResults> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(SearchResults {
                movies: Vec::new(),
                series: Vec::new(),
            });
        }
        let (results, token) = self.search(query, timeout).await?;
        let previews = results
            .movies
            .iter()
            .chain(&results.series)
            .cloned()
            .collect();
        let catalog = self.clone();
        tokio::spawn(async move {
            catalog
                .find_excluded(previews, timeout, token, on_excluded)
                .await;
        });
        Ok(results)
    }

    /// Explorar (FR-37 simple, 2026-11-14): una página de 50 de Cinemeta.
    pub async fn browse(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        year: Option<u16>,
        genre: Option<&str>,
        skip: u32,
        timeout: Duration,
    ) -> Result<BrowsePage> {
        cinemeta::browse(&self.http, kind, sort, year, genre, skip, timeout)
            .await
            .map_err(|e| fetch_error("cargar la lista", &e))
    }

    /// Explorar por fecha de estreno (`AAAA-MM-DD`, bordes incluidos; sin `to` = hasta hoy).
    /// `cursor` es el `next` de la página anterior (None = primera).
    pub async fn browse_released(
        &self,
        kind: MediaKind,
        from: &str,
        to: Option<&str>,
        genre: Option<&str>,
        cursor: Option<BrowseCursor>,
        timeout: Duration,
    ) -> Result<BrowsePage> {
        let date = |s: &str| {
            chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| {
                CoreError::Catalog {
                    user: format!("Fecha inválida: {s}."),
                    detail: format!("fecha inválida: {s:?}"),
                }
            })
        };
        let from = date(from)?;
        let to = match to.filter(|t| !t.trim().is_empty()) {
            Some(t) => date(t)?,
            None => chrono::Local::now().date_naive(),
        };
        if from > to {
            return Err(CoreError::Catalog {
                user: "La fecha «desde» es posterior a «hasta».".into(),
                detail: format!("rango invertido: {from} > {to}"),
            });
        }
        cinemeta::browse_released(&self.http, kind, from, to, genre, cursor, timeout)
            .await
            .map_err(|e| fetch_error("cargar la lista", &e))
    }

    /// FR-38/39 (cacheada en memoria: la usan la ficha, el filtro y los streams).
    pub async fn meta(&self, kind: MediaKind, id: &str, timeout: Duration) -> Result<Meta> {
        if !is_imdb_id(id) {
            return Err(CoreError::NotFound(format!(
                "ficha {}",
                normalize::clean(id)
            )));
        }
        let key = format!("{}:{id}", kind.as_str());
        if let Some(m) = self.metas.lock().expect("metas").get(&key) {
            return Ok(m.clone());
        }
        let m = cinemeta::meta(&self.http, kind, id, timeout)
            .await
            .map_err(|e| fetch_error("abrir la ficha", &e))?;
        self.metas.lock().expect("metas").insert(key, m.clone());
        Ok(m)
    }

    /// FR-40 en búsquedas: los previews no traen país ni géneros (10 §B.3), así que se pide la
    /// ficha de cada resultado (fail-open: si falla, se muestra). Avisa cada excluido.
    /// De a una (deja libre el otro lugar del host para la ficha o la próxima búsqueda) y se corta
    /// con la búsqueda siguiente (`token`: el de la búsqueda que dio estos resultados); las fichas
    /// ya cacheadas no van a la red (`meta`).
    pub async fn find_excluded(
        &self,
        previews: Vec<MetaPreview>,
        timeout: Duration,
        token: CancellationToken,
        on_excluded: impl Fn(String),
    ) {
        for p in previews {
            let meta = tokio::select! {
                m = self.meta(p.kind, &p.id, timeout) => m,
                _ = token.cancelled() => return,
            };
            if meta.is_ok_and(|m| m.excluded) {
                on_excluded(p.id);
            }
        }
    }

    /// Addons habilitados, con su URL real (del almacén seguro si es secreta). Reusa los
    /// manifests ya leídos.
    pub fn enabled_addons(&self, cfg: &CatalogConfig) -> Vec<Arc<Addon>> {
        let mut cache = self.addons.lock().expect("addons");
        cfg.addons
            .iter()
            .filter(|e| e.enabled)
            .filter_map(|e| {
                let url = if e.secret {
                    crate::secrets::secret(&secret_account(&e.id))
                } else {
                    e.url.clone()
                };
                let Some(url) = url else {
                    tracing::warn!(addon = %e.id, "addon sin URL (¿se borró del almacén seguro?)");
                    return None;
                };
                let key = format!("{}|{url}", e.id);
                Some(
                    cache
                        .entry(key)
                        .or_insert_with(|| Arc::new(Addon::new(e.clone(), url)))
                        .clone(),
                )
            })
            .collect()
    }

    /// FR-42: pide streams a todos los addons habilitados de `cfg`; cada novedad llega por
    /// `emit`. Cambiar de video cancela la consulta anterior. Los seeders reales llegan solos
    /// (scrape).
    pub fn streams(
        &self,
        cfg: &Config,
        kind: MediaKind,
        video_id: &str,
        emit: impl Fn(aggregate::StreamsUpdate) + Send + Sync + 'static,
    ) -> Result<()> {
        let video = VideoId::parse(video_id)?;
        let addons = self.enabled_addons(&cfg.catalog);
        if addons.is_empty() {
            return Err(CoreError::Catalog {
                user: "No hay fuentes habilitadas: activá alguna en Fuentes.".into(),
                detail: "sin addons habilitados".into(),
            });
        }
        let ctx = aggregate::RunCtx {
            http: self.http.clone(),
            addons,
            video,
            kind,
            audio_order: cfg.catalog.audio_order.clone(),
            exclude_cam: cfg.catalog.exclude_cam,
            default_timeout: Duration::from_millis(cfg.catalog.timeout_ms),
            trackers: cfg.trackers.clone(),
            scrape_timeout: Duration::from_secs(cfg.analyzer.scrape_timeout_secs),
            latest: self.latest.clone(),
        };
        self.start_streams(ctx, emit);
        Ok(())
    }

    /// FR-42: arranca la consulta (cancela la anterior: cambiar de episodio aborta todo).
    pub fn start_streams(
        &self,
        ctx: aggregate::RunCtx,
        emit: impl Fn(aggregate::StreamsUpdate) + Send + Sync + 'static,
    ) {
        let mut task = self.streams_task.lock().expect("streams");
        if let Some(old) = task.take() {
            old.abort();
        }
        // Marcar el video nuevo antes de arrancar: la corrida vieja (si sigue un instante) ya
        // no puede escribir (`aggregate::run` compara el video).
        *self.latest.lock().expect("latest") = aggregate::Latest {
            video: Some(ctx.video.clone()),
            candidates: Vec::new(),
        };
        *task = Some(tokio::spawn(aggregate::run(ctx, emit)).abort_handle());
    }

    pub fn stop_streams(&self) {
        if let Some(h) = self.streams_task.lock().expect("streams").take() {
            h.abort();
        }
    }

    /// Magnets (con sus trackers) de opciones de la lista vigente, para contar su enjambre.
    pub fn magnets_of(&self, hashes: &[InfoHash]) -> Vec<Magnet> {
        self.latest
            .lock()
            .expect("latest")
            .candidates
            .iter()
            .filter(|c| hashes.contains(&c.info_hash))
            .map(|c| Magnet {
                info_hash: c.info_hash,
                display_name: Some(c.release_name.clone()),
                trackers: c.trackers.clone(),
            })
            .collect()
    }

    pub fn candidate(&self, video: &VideoId, hash: &InfoHash) -> Option<StreamCandidate> {
        let latest = self.latest.lock().expect("latest");
        if latest.video.as_ref() != Some(video) {
            return None;
        }
        latest
            .candidates
            .iter()
            .find(|c| &c.info_hash == hash)
            .cloned()
    }

    /// El candidato `hash` de la consulta vigente de `video`, listo para *Mis magnets*: magnet con
    /// `trackers` (FR-10) y su origen (título de `meta` si se pudo leer la ficha; si no, el `tt…`).
    pub fn pick(
        &self,
        video: &VideoId,
        hash: &InfoHash,
        meta: Option<&Meta>,
        trackers: &[String],
    ) -> Result<CatalogPick> {
        let c = self
            .candidate(video, hash)
            .ok_or_else(|| CoreError::Catalog {
                user: "Ese torrent ya no está en la lista: actualizá los streams.".into(),
                detail: format!("candidato {hash} no encontrado"),
            })?;
        let magnet = Magnet {
            info_hash: c.info_hash,
            display_name: Some(c.release_name.clone()),
            trackers: c.trackers.clone(),
        }
        .with_trackers(trackers);
        let origin = CatalogOrigin {
            video_id: video.to_string(),
            imdb_id: video.imdb_id().to_string(),
            title: meta.map_or_else(|| video.imdb_id().to_string(), |m| m.name.clone()),
            year: meta.and_then(|m| m.year.clone()),
            season: video.episode().map(|e| e.0),
            episode: video.episode().map(|e| e.1),
            file_idx: c.file_idx,
            addons: c.addons.clone(),
        };
        Ok(CatalogPick {
            magnet,
            origin,
            size_bytes: c.size_bytes,
        })
    }

    /// "Agregar addon" (FR-41): valida el manifest y arma la entrada. Si la URL lleva
    /// configuración, va al almacén seguro y en la config queda enmascarada (NFR-22).
    pub async fn new_addon(&self, input: &str, existing: &[AddonEntry]) -> Result<AddonEntry> {
        let user = |msg: String| CoreError::Catalog {
            detail: msg.clone(),
            user: msg,
        };
        let url = addons::normalize_url(input).map_err(user)?;
        let manifest = addons::fetch_manifest(&self.http, &url, Duration::from_secs(10))
            .await
            .map_err(user)?;
        let secret = addons::has_config(&url);
        // Los secretos no tienen `url` en la config: se comparan contra el almacén seguro.
        if existing.iter().any(|e| {
            let stored = if e.secret {
                crate::secrets::secret(&secret_account(&e.id))
            } else {
                e.url.clone()
            };
            stored.as_deref() == Some(url.as_str())
        }) {
            return Err(user("Ese addon ya está en la lista.".into()));
        }
        let mut id = manifest.id.clone();
        let mut n = 2;
        while existing.iter().any(|e| e.id == id) {
            id = format!("{}-{n}", manifest.id);
            n += 1;
        }
        if secret {
            crate::secrets::set_secret(&secret_account(&id), &url)?;
        }
        Ok(AddonEntry {
            name: format!("{} {}", manifest.name, manifest.version)
                .trim()
                .to_string(),
            display_url: http::redact(&url),
            url: (!secret).then_some(url),
            secret,
            enabled: true,
            timeout_ms: None,
            id,
        })
    }

    /// Al quitar un addon secreto, se borra también del almacén seguro.
    pub fn forget_addon(&self, entry: &AddonEntry) {
        if entry.secret {
            if let Err(e) = crate::secrets::set_secret(&secret_account(&entry.id), "") {
                tracing::warn!("no se pudo borrar la URL del addon del almacén seguro: {e}");
            }
        }
        self.addons
            .lock()
            .expect("addons")
            .retain(|k, _| !k.starts_with(&format!("{}|", entry.id)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// T-20.
    #[test]
    fn video_id() {
        let v = VideoId::parse("tt0903747:1:1").unwrap();
        assert_eq!(v.episode(), Some((1, 1)));
        assert_eq!(v.imdb_id(), "tt0903747");
        assert_eq!(v.to_string(), "tt0903747:1:1");
        assert_eq!(
            VideoId::parse("tt3011894").unwrap(),
            VideoId::Movie("tt3011894".into())
        );
        assert!(VideoId::parse("kitsu:1").is_err());
        assert!(VideoId::parse("tt12").is_err());
        assert!(VideoId::parse("tt0903747:1").is_err());
    }
}
