//! `catalog` — buscar películas y series (Cinemeta) y juntar torrents de addons de Stremio
//! (spec 09, F4b). No indexa ni scrapea contenido propio (ADR-16/17); solo P2P (ADR-21).
//! No conoce `engine`, `analyzer` ni `playback`: la orquestación vive en `AppCore` (spec 09 §6.1);
//! acá queda lo propio del catálogo (fechas, contexto de una consulta, origen de una fila).
//! Usa `trackers` (scrape de seeders), `audio` y el parser de releases de `subtitles`.

pub mod addons;
pub mod aggregate;
pub mod awards;
pub mod cinemeta;
pub mod elitetorrent;
pub mod episode_ratings;
pub mod http;
pub mod interests;
pub mod latteam;
pub mod mkv;
pub mod normalize;
pub mod people;
pub mod protocol;
pub mod seasons;
pub mod tmdb;
pub mod top;
pub mod torbox;
pub mod wpreact;

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::config::{AddonEntry, CatalogConfig, Config, Lang, LanguageConfig};
use crate::library::CatalogOrigin;
use crate::magnet::{InfoHash, Magnet};
use crate::{CoreError, Result};
use addons::Addon;
use cinemeta::{BrowsePage, BrowseSort, Meta, MetaPreview};
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

/// Cuánto se recuerda la lista de un video (2026-11-18, pedido: 1 h): sus torrents y cuáles están en
/// TorBox. Después se vuelve a buscar (aparecen torrents nuevos y cambian los seeders). "Borrar
/// datos guardados" la borra antes.
const RECENT_TTL: Duration = Duration::from_secs(60 * 60);
/// Archivo de datos guardados de ese video (`what`: `torrents` o `torbox`; `tt…:T:E` → sin `:`).
fn recent_key(what: &str, video_id: &str) -> String {
    format!("{what}-{}.json", video_id.replace(':', "_"))
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
    /// Fuente propia de la app (no se quita, solo se apaga).
    pub own: bool,
}

impl From<&AddonEntry> for AddonView {
    fn from(e: &AddonEntry) -> Self {
        Self {
            id: e.id.clone(),
            name: e.name.clone(),
            display_url: e.display_url.clone(),
            enabled: e.enabled,
            secret: e.secret,
            own: e.kind != crate::config::SourceKind::Stremio,
        }
    }
}

fn secret_account(id: &str) -> String {
    format!("addon-url-{id}")
}

/// `AAAA-MM-DD`, bordes incluidos; sin `to` = hasta hoy.
fn date_range(from: &str, to: Option<&str>) -> Result<(chrono::NaiveDate, chrono::NaiveDate)> {
    let date = |s: &str| {
        chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| CoreError::Catalog {
            user: format!("Fecha inválida: {s}."),
            detail: format!("fecha inválida: {s:?}"),
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
    Ok((from, to))
}

/// El último pedido gana (búsqueda, lista de Explorar): corta el anterior del mismo tipo y
/// devuelve el token del nuevo.
fn supersede(slot: &Mutex<CancellationToken>) -> CancellationToken {
    let mut cur = slot.lock().expect("supersede");
    cur.cancel();
    *cur = CancellationToken::new();
    cur.clone()
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
    /// Fichas ya pedidas en esta sesión; además quedan en la caché de datos (ver `meta`).
    metas: Mutex<HashMap<String, Meta>>,
    data: Arc<crate::datacache::DataCache>,
    /// Búsqueda y lista de Explorar en curso: una nueva corta la anterior (`supersede`).
    search: Mutex<CancellationToken>,
    browse: Mutex<CancellationToken>,
    streams_task: Mutex<Option<tokio::task::AbortHandle>>,
    /// Última lista de candidatos (para analizar / reproducir uno por hash).
    pub latest: Arc<Mutex<aggregate::Latest>>,
    /// Manifests ya leídos (por id + URL).
    addons: Mutex<HashMap<String, Arc<Addon>>>,
    /// Pósters de TMDB para los títulos sin imagen en Cinemeta.
    posters: tmdb::Posters,
    /// "Mejor puntuadas" con filtros de IMDb (TMDB + dataset de IMDb).
    top: top::TopRated,
    /// Puntaje por temporada de una serie (TMDB o IMDb).
    seasons: seasons::Seasons,
}

impl Catalog {
    pub fn new(cfg: &CatalogConfig, data: Arc<crate::datacache::DataCache>) -> Self {
        Self {
            http: Http::new(Duration::from_millis(cfg.connect_timeout_ms)),
            metas: Mutex::default(),
            search: Mutex::default(),
            browse: Mutex::default(),
            streams_task: Mutex::default(),
            latest: Arc::default(),
            addons: Mutex::default(),
            posters: tmdb::Posters::new(data.clone()),
            top: top::TopRated::new(data.clone()),
            seasons: seasons::Seasons::new(data.clone()),
            data,
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
    /// (como mucho 1 pedido en vuelo por tipo). Menos de 2 letras = sin resultados.
    pub async fn search(&self, query: &str, timeout: Duration) -> Result<Vec<MetaPreview>> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(Vec::new());
        }
        let token = supersede(&self.search);
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
            (m, s) => Ok(by_relevance(
                query,
                m.unwrap_or_default(),
                s.unwrap_or_default(),
                self.top.ratings_loaded().as_deref(),
            )),
        }
    }

    /// Puntaje promedio por temporada de una serie (para ver si decayó). `quick` (tarjetas al pasar
    /// el mouse): no espera al índice de IMDb si todavía se está armando.
    /// De fondo al abrir la app: los puntajes de IMDb (ordenan la búsqueda) y el índice de puntajes
    /// por temporada.
    pub async fn warm_imdb(&self) {
        if let Err(e) = self.top.ratings(&self.http).await {
            tracing::warn!("puntajes de IMDb: {e}");
        }
        if let Err(e) = self.seasons.index(&self.http, &self.top).await {
            tracing::warn!("índice de temporadas: {e}");
        }
    }

    /// Idioma original, cadenas, dónde verla y textos en los idiomas elegidos, de TMDB (con key).
    pub async fn details(
        &self,
        kind: MediaKind,
        imdb_id: &str,
        langs: LanguageConfig,
        timeout: Duration,
    ) -> tmdb::DetailsView {
        if !is_imdb_id(imdb_id) {
            return tmdb::DetailsView {
                has_key: tmdb::has_key(),
                details: None,
            };
        }
        tmdb::details(&self.http, &self.data, kind, imdb_id, langs, timeout).await
    }

    /// Títulos y sinopsis de los episodios de una temporada en los idiomas elegidos (vacío sin key).
    pub async fn episodes(
        &self,
        imdb_id: &str,
        season: u32,
        langs: LanguageConfig,
        timeout: Duration,
    ) -> Vec<tmdb::EpisodeText> {
        if !is_imdb_id(imdb_id) {
            return Vec::new();
        }
        tmdb::episodes(&self.http, &self.data, imdb_id, season, langs, timeout).await
    }

    /// Premios de un título (IMDb GraphQL). Guardados una semana; si IMDb falla, sirve lo guardado aunque esté vencido.
    pub async fn awards(&self, imdb_id: &str, timeout: Duration) -> Result<awards::TitleAwards> {
        const TTL: Duration = Duration::from_secs(7 * 24 * 3600);
        if !is_imdb_id(imdb_id) {
            return Ok(awards::TitleAwards::default());
        }
        // v2 (2026-11-24): trae el puntaje de IMDb (respaldo de la ficha).
        let file = format!("imdb-premios-v2-{imdb_id}.json");
        let saved = self.data.get::<awards::TitleAwards>(&file);
        if let Some((a, age)) = &saved {
            if *age < TTL {
                return Ok(a.clone());
            }
        }
        match awards::fetch(&self.http, imdb_id, timeout).await {
            Ok(a) => {
                self.data.put(&file, &a);
                Ok(a)
            }
            Err(e) => saved.map(|(a, _)| a).ok_or(e),
        }
    }

    /// Los bytes de un póster, para que la UI lea su color (el webview no puede leer los píxeles de metahub: no manda
    /// CORS). Solo de los hosts de pósters que usa la app.
    pub async fn image(&self, url: &str, timeout: Duration) -> Result<Vec<u8>> {
        const HOSTS: [&str; 2] = ["https://images.metahub.space/", "https://image.tmdb.org/"];
        if !HOSTS.iter().any(|h| url.starts_with(h)) {
            return Err(CoreError::NotFound("imagen de un host desconocido".into()));
        }
        self.http
            .get_image(url, timeout)
            .await
            .map_err(|e| fetch_error("traer el póster", &e))
    }

    /// Puntaje de IMDb de cada capítulo de una temporada. Guardado un día; si IMDb falla, sirve lo guardado aunque esté
    /// vencido.
    pub async fn episode_ratings(
        &self,
        imdb_id: &str,
        season: u32,
        timeout: Duration,
    ) -> Result<Vec<episode_ratings::EpisodeScore>> {
        const TTL: Duration = Duration::from_secs(24 * 3600);
        if !is_imdb_id(imdb_id) {
            return Ok(Vec::new());
        }
        let file = format!("imdb-capitulos-v1-{imdb_id}-{season}.json");
        let saved = self.data.get::<Vec<episode_ratings::EpisodeScore>>(&file);
        if let Some((s, age)) = &saved {
            if *age < TTL {
                return Ok(s.clone());
            }
        }
        match episode_ratings::fetch(&self.http, imdb_id, season, timeout).await {
            Ok(s) => {
                self.data.put(&file, &s);
                Ok(s)
            }
            Err(e) => saved.map(|(s, _)| s).ok_or(e),
        }
    }

    /// Ejemplos populares de cada subgénero de IMDb (tarjetas del filtro de géneros). Guardados una semana por tipo y
    /// subgénero.
    pub async fn interest_examples(
        &self,
        kind: MediaKind,
        ids: Vec<String>,
        timeout: Duration,
    ) -> Result<HashMap<String, Vec<interests::Example>>> {
        const TTL: Duration = Duration::from_secs(7 * 24 * 3600);
        let file = |id: &str| format!("imdb-ejemplos-{}-{id}.json", kind.as_str());
        let mut out = HashMap::new();
        let mut missing = Vec::new();
        for id in ids.into_iter().take(12) {
            match self.data.get::<Vec<interests::Example>>(&file(&id)) {
                Some((list, age)) if age < TTL => {
                    out.insert(id, list);
                }
                _ => missing.push(id),
            }
        }
        if !missing.is_empty() {
            for (id, list) in interests::examples(&self.http, kind, &missing, timeout).await? {
                self.data.put(&file(&id), &list);
                out.insert(id, list);
            }
        }
        Ok(out)
    }

    /// La película o serie de un torrent pegado, por su nombre, con el puntaje de IMDb si ya está cargado.
    pub async fn identify(
        &self,
        name: &str,
        titles: Lang,
        timeout: Duration,
    ) -> Option<tmdb::Identified> {
        let mut found = tmdb::identify(&self.http, name, titles, timeout).await?;
        found.rating = self
            .top
            .ratings_loaded()
            .zip(top::tt_number(&found.id))
            .and_then(|(r, tt)| r.get(&tt).map(|&(rating, _)| top::rating_label(rating)));
        Some(found)
    }

    /// Similares de TMDB (al abrirlos), con el puntaje de IMDb que usa el resto de la app (si no,
    /// el de TMDB); mejor puntaje primero.
    pub async fn similar(
        &self,
        kind: MediaKind,
        imdb_id: &str,
        titles: Lang,
        timeout: Duration,
    ) -> Vec<tmdb::Similar> {
        if !is_imdb_id(imdb_id) {
            return Vec::new();
        }
        let mut list = tmdb::similar(&self.http, &self.data, kind, imdb_id, titles, timeout).await;
        let ratings = self.top.ratings_loaded();
        for x in &mut list {
            let imdb = ratings
                .as_ref()
                .zip(top::tt_number(&x.id))
                .and_then(|(r, tt)| r.get(&tt).map(|&(rating, _)| rating));
            x.rating = imdb.or(x.tmdb_rating.map(|v| (v * 10.0).round() / 10.0));
        }
        list.sort_by(|a, b| b.rating.unwrap_or(0.0).total_cmp(&a.rating.unwrap_or(0.0)));
        list
    }

    /// Actores y directores para las sugerencias del buscador (vacío sin key de TMDB).
    pub async fn people(
        &self,
        query: &str,
        titles: Lang,
        timeout: Duration,
    ) -> Result<Vec<people::Person>> {
        people::search(&self.http, query, titles, timeout).await
    }

    /// Lo que actuó o dirigió una persona, películas y series, de más a menos popular, con el
    /// puntaje de IMDb. Necesita la key de TMDB.
    pub async fn person_titles(
        &self,
        id: u64,
        role: people::Role,
        titles: Lang,
        timeout: Duration,
    ) -> Result<Vec<MetaPreview>> {
        let credits = people::credits(&self.http, id, role, titles, timeout).await?;
        self.top.scored(&self.http, credits, timeout).await
    }

    pub async fn season_ratings(
        &self,
        imdb_id: &str,
        quick: bool,
        timeout: Duration,
    ) -> Result<seasons::SeasonRatings> {
        // La ficha (en caché casi siempre) da el estado si no hay TMDB.
        let meta = self.meta(MediaKind::Series, imdb_id, timeout).await.ok();
        self.seasons
            .list(
                &self.http,
                &self.top,
                imdb_id,
                meta.as_ref(),
                quick,
                timeout,
            )
            .await
    }

    /// Explorar sin key de TMDB: en tendencia ahora (Cinemeta `top`, 50 por página).
    pub async fn trending(
        &self,
        kind: MediaKind,
        skip: u32,
        timeout: Duration,
    ) -> Result<BrowsePage> {
        let key = format!("lista-tendencia-{}-{skip}.json", kind.as_str());
        self.browse_page(key, Duration::from_secs(3600), async {
            cinemeta::trending(&self.http, kind, skip, timeout)
                .await
                .map_err(|e| fetch_error("cargar la lista", &e))
        })
        .await
    }

    /// Una página de Explorar (2026-11-16): la guardada si tiene menos de `ttl` (volver a un filtro
    /// es instantáneo); si no, la nueva, que corta a la anterior en curso (`supersede`). Si la
    /// red falla, sirve la guardada aunque esté vencida.
    async fn browse_page(
        &self,
        key: String,
        ttl: Duration,
        fetch: impl std::future::Future<Output = Result<BrowsePage>>,
    ) -> Result<BrowsePage> {
        let token = supersede(&self.browse);
        let saved = self.data.get::<BrowsePage>(&key);
        if let Some((page, _)) = saved.as_ref().filter(|(_, age)| *age < ttl) {
            return Ok(page.clone());
        }
        let fresh = tokio::select! {
            r = fetch => r,
            _ = token.cancelled() => return Err(CoreError::Cancelled),
        };
        match (fresh, saved) {
            (Ok(page), _) => {
                self.data.put(&key, &page);
                Ok(page)
            }
            (Err(_), Some((page, _))) => Ok(page),
            (Err(e), None) => Err(e),
        }
    }

    /// Explorar con filtros de IMDb (piso de votos, idioma original), por puntaje o popularidad.
    /// Toda la lista de una vez (ya ordenada). Necesita la key de TMDB.
    #[allow(clippy::too_many_arguments)]
    pub async fn browse_top(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        from: &str,
        to: Option<&str>,
        min_votes: u32,
        languages: Vec<String>,
        titles: Lang,
        timeout: Duration,
    ) -> Result<BrowsePage> {
        let (from, to) = date_range(from, to)?;
        let q = top::TopQuery {
            kind,
            sort,
            from,
            to,
            min_votes,
            languages,
            titles,
        };
        let key = format!(
            "lista-top-{}-{:?}-{}-{}-{}-{}-{}.json",
            q.kind.as_str(),
            q.sort,
            q.from,
            q.to,
            q.min_votes,
            q.languages.join("+"),
            q.titles.tmdb()
        );
        self.browse_page(key, Duration::from_secs(6 * 3600), async {
            Ok(BrowsePage {
                items: self.top.list(&self.http, &q, timeout).await?,
                has_more: false,
            })
        })
        .await
    }

    /// Explorar con un género elegido: búsqueda por subgéneros de IMDb (alcanza con uno), con los mismos filtros.
    /// Toda la lista de una vez (ya ordenada). No necesita la key de TMDB.
    #[allow(clippy::too_many_arguments)]
    pub async fn browse_interests(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        from: &str,
        to: Option<&str>,
        min_votes: u32,
        languages: Vec<String>,
        interests: Vec<String>,
        titles: Lang,
        timeout: Duration,
    ) -> Result<BrowsePage> {
        let (from, to) = date_range(from, to)?;
        let q = interests::InterestQuery {
            kind,
            sort,
            from,
            to,
            min_votes,
            languages,
            interests,
            titles,
        };
        let key = format!(
            "lista-imdb-{}-{:?}-{}-{}-{}-{}-{}-{}.json",
            q.kind.as_str(),
            q.sort,
            q.from,
            q.to,
            q.min_votes,
            q.languages.join("+"),
            q.interests.join("+"),
            q.titles.tmdb()
        );
        self.browse_page(key, Duration::from_secs(6 * 3600), async {
            Ok(BrowsePage {
                items: interests::list(&self.http, &q, timeout).await?,
                has_more: false,
            })
        })
        .await
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
            return Ok(self.with_votes(m.clone()));
        }
        // Guardada: una película o una serie terminada sirve un mes; una en emisión, 12 h (salen
        // episodios). Si Cinemeta no responde, sirve aunque esté vencida.
        // v3 (2026-11-17): reparto, premios y tráiler; las guardadas antes no los tienen.
        let file = format!("ficha-v3-{}-{id}.json", kind.as_str());
        let saved = self.data.get::<Meta>(&file);
        let fresh = |m: &Meta, age: Duration| {
            let ttl = if kind == MediaKind::Movie || m.status.as_deref() == Some("Ended") {
                30 * 24 * 3600
            } else {
                12 * 3600
            };
            age < Duration::from_secs(ttl)
        };
        let m = match saved {
            Some((m, age)) if fresh(&m, age) => m,
            saved => match cinemeta::meta(&self.http, kind, id, timeout).await {
                Ok(m) => {
                    self.data.put(&file, &m);
                    m
                }
                Err(e) => saved
                    .map(|(m, _)| m)
                    .ok_or_else(|| fetch_error("abrir la ficha", &e))?,
            },
        };
        self.metas.lock().expect("metas").insert(key, m.clone());
        Ok(self.with_votes(m))
    }

    /// Votos de IMDb del dataset, si ya está en memoria (no se espera a bajarlo).
    /// Votos de IMDb y, si Cinemeta no trae el puntaje (pasa con títulos nuevos), el de la base de
    /// IMDb ya bajada (2026-11-17).
    fn with_votes(&self, mut m: Meta) -> Meta {
        let imdb = self
            .top
            .ratings_loaded()
            .zip(top::tt_number(&m.id))
            .and_then(|(r, tt)| r.get(&tt).copied());
        m.imdb_votes = imdb.map(|(_, votes)| votes);
        if m.imdb_rating.is_none() {
            m.imdb_rating = imdb.map(|(rating, _)| format!("{rating:.1}"));
        }
        m
    }

    /// Addons habilitados, con su URL real (del almacén seguro si es secreta). Reusa los
    /// manifests ya leídos.
    pub fn enabled_addons(&self, cfg: &CatalogConfig) -> Vec<Arc<Addon>> {
        let mut cache = self.addons.lock().expect("addons");
        cfg.addons
            .iter()
            .filter(|e| e.enabled)
            .filter_map(|e| {
                let url = if e.kind != crate::config::SourceKind::Stremio {
                    Some(String::new()) // fuente propia: sin manifest
                } else if e.secret {
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
        shared_trackers: Vec<String>,
        kind: MediaKind,
        video_id: &str,
        emit: impl Fn(aggregate::StreamsUpdate) + Send + Sync + 'static,
    ) -> Result<()> {
        let video = VideoId::parse(video_id)?;
        // Ya buscado hace poco (datos guardados: sobrevive a cerrar la app y no se borra con la
        // caché de descargas): la misma lista al toque y vigente para analizar y reproducir.
        let key = recent_key("torrents", video_id);
        let cached = self
            .data
            .get::<aggregate::StreamsUpdate>(&key)
            .filter(|(_, age)| *age < RECENT_TTL)
            .map(|(u, _)| u);
        if let Some(update) = cached {
            self.stop_streams();
            *self.latest.lock().expect("latest") = aggregate::Latest {
                video: Some(video),
                candidates: update.candidates.clone(),
            };
            emit(update);
            return Ok(());
        }
        let data = self.data.clone();
        let emit = move |update: aggregate::StreamsUpdate| {
            if update.done && !update.candidates.is_empty() {
                data.put(&key, &update);
            }
            emit(update);
        };
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
            trackers: cfg.all_trackers(&shared_trackers),
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

    /// Cuáles de esas opciones (de la lista de `video_id`) están en la caché de TorBox
    /// (`torbox::cached`). Se recuerda como la lista: abrir de nuevo el video no vuelve a preguntar.
    pub async fn torbox_cached(
        &self,
        video_id: &str,
        hashes: &[InfoHash],
        timeout: Duration,
    ) -> crate::Result<Option<torbox::Cached>> {
        // "torbox2": desde el 2026-11-20 solo las que traen un video de verdad (las guardadas antes no filtraban).
        let key = recent_key("torbox2", video_id);
        if let Some((saved, _)) = self
            .data
            .get::<torbox::Cached>(&key)
            .filter(|(_, age)| *age < RECENT_TTL)
        {
            return Ok(Some(saved));
        }
        let Some(found) = torbox::cached(&self.http, hashes, timeout).await? else {
            return Ok(None);
        };
        self.data.put(&key, &found);
        Ok(Some(found))
    }

    /// Qué archivo pedir a TorBox de esa opción de la lista vigente: el episodio de la lista (`None` = película) y
    /// el nombre de archivo del addon. Reproducir, copiar link y pistas eligen igual (2026-11-27).
    fn torbox_target(&self, hash: InfoHash) -> (Option<(u32, u32)>, Option<String>) {
        let latest = self.latest.lock().expect("latest");
        let file = latest
            .candidates
            .iter()
            .find(|c| c.info_hash == hash)
            .and_then(|c| c.file_name.clone());
        (latest.video.as_ref().and_then(VideoId::episode), file)
    }

    /// Link directo de TorBox para esa opción de la lista vigente, y su nombre (2026-11-17).
    pub async fn torbox_stream(
        &self,
        hash: InfoHash,
        timeout: Duration,
    ) -> Result<(String, String)> {
        let magnet = self
            .magnets_of(&[hash])
            .into_iter()
            .next()
            .ok_or_else(|| CoreError::NotFound("esa opción ya no está en la lista".into()))?;
        let (episode, file) = self.torbox_target(hash);
        let target = torbox::Target {
            episode,
            file: file.as_deref(),
        };
        let url = torbox::stream_url(&self.http, &magnet.to_uri(), target, timeout).await?;
        Ok((url, magnet.display_name.unwrap_or_else(|| hash.to_hex())))
    }

    /// Pistas de esa opción por TorBox: ver `torbox::header_tracks`. Devuelve también el nombre del torrent.
    pub async fn torbox_header_tracks(
        &self,
        hash: InfoHash,
        timeout: Duration,
    ) -> Result<(Option<Vec<mkv::Track>>, Option<String>, String)> {
        let magnet = self
            .magnets_of(&[hash])
            .into_iter()
            .next()
            .ok_or_else(|| CoreError::NotFound("esa opción ya no está en la lista".into()))?;
        let (episode, file) = self.torbox_target(hash);
        let target = torbox::Target {
            episode,
            file: file.as_deref(),
        };
        let (tracks, url) =
            torbox::header_tracks(&self.http, &magnet.to_uri(), target, timeout).await?;
        Ok((
            tracks,
            url,
            magnet.display_name.unwrap_or_else(|| hash.to_hex()),
        ))
    }

    /// Link para castear de esa opción por TorBox (HLS; si no, descarga): ver `torbox::cast_url`. `orig`: idioma
    /// original en ISO 639-1 (TMDB).
    pub async fn torbox_cast(
        &self,
        hash: InfoHash,
        orig: Option<&str>,
        latino: bool,
        timeout: Duration,
    ) -> Result<String> {
        let magnet = self
            .magnets_of(&[hash])
            .into_iter()
            .next()
            .ok_or_else(|| CoreError::NotFound("esa opción ya no está en la lista".into()))?;
        let (episode, file) = self.torbox_target(hash);
        let target = torbox::Target {
            episode,
            file: file.as_deref(),
        };
        torbox::cast_url(
            &self.http,
            &magnet.to_uri(),
            target,
            orig.and_then(torbox::iso3),
            latino,
            timeout,
        )
        .await
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
            kind: crate::config::SourceKind::Stremio,
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

/// FR-36 (2026-11-16): películas y series juntas, lo más popular primero. Cinemeta ordena cada tipo
/// por su cuenta y sin popularidad: se intercalan por ese puesto (a igual puesto, primero el título que
/// empieza con lo escrito) y, si los puntajes de IMDb ya están en memoria, se ordena por votos.
fn by_relevance(
    query: &str,
    movies: Vec<MetaPreview>,
    series: Vec<MetaPreview>,
    ratings: Option<&top::Ratings>,
) -> Vec<MetaPreview> {
    let q = query.trim().to_lowercase();
    let place =
        |i: usize, p: &MetaPreview| 2 * i + usize::from(!p.name.to_lowercase().starts_with(&q));
    let mut list: Vec<(usize, MetaPreview)> = movies
        .into_iter()
        .enumerate()
        .chain(series.into_iter().enumerate())
        .map(|(i, p)| (place(i, &p), p))
        .collect();
    list.sort_by_key(|(place, _)| *place);
    if let Some(ratings) = ratings {
        list.iter_mut()
            .for_each(|(_, p)| top::fill_rating(p, ratings));
        let votes = |p: &MetaPreview| {
            top::tt_number(&p.id)
                .and_then(|n| ratings.get(&n))
                .map_or(0, |(_, v)| *v)
        };
        list.sort_by_key(|(_, p)| std::cmp::Reverse(votes(p)));
    }
    list.into_iter().map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rango_de_fechas() {
        let d = |y, m, day| chrono::NaiveDate::from_ymd_opt(y, m, day).unwrap();
        // Bordes incluidos: desde == hasta es válido.
        assert_eq!(
            date_range("2024-03-01", Some("2024-03-01")).unwrap(),
            (d(2024, 3, 1), d(2024, 3, 1))
        );
        // Espacios alrededor se ignoran.
        assert_eq!(
            date_range(" 2020-01-01 ", Some(" 2020-12-31 ")).unwrap(),
            (d(2020, 1, 1), d(2020, 12, 31))
        );
        // Sin `to` (o vacío): hasta hoy.
        let today = chrono::Local::now().date_naive();
        assert_eq!(date_range("2000-01-01", None).unwrap().1, today);
        assert_eq!(date_range("2000-01-01", Some("  ")).unwrap().1, today);
        // Invertido: error.
        assert!(date_range("2024-03-02", Some("2024-03-01")).is_err());
        // Formato inválido (en cualquiera de los dos).
        for bad in ["01/03/2024", "2024-13-01", "2024-02-30", "", "x"] {
            assert!(date_range(bad, Some("2024-12-31")).is_err(), "{bad}");
        }
        assert!(date_range("2024-01-01", Some("mañana")).is_err());
    }

    #[test]
    fn busqueda_lo_mas_votado_primero() {
        let p = |id: &str, name: &str, kind| MetaPreview {
            id: id.into(),
            kind,
            name: name.into(),
            year: None,
            imdb_rating: None,
            documentary: false,
            poster: None,
            released: None,
            popularity: None,
        };
        let movies = vec![
            p(
                "tt10090796",
                "Game of Thrones: The Last Watch",
                MediaKind::Movie,
            ),
            p("tt0409182", "The Game of Their Lives", MediaKind::Movie),
        ];
        let series = vec![p("tt0944947", "Game of Thrones", MediaKind::Series)];
        let names = |v: Vec<MetaPreview>| v.into_iter().map(|p| p.name).collect::<Vec<_>>();
        assert_eq!(
            names(by_relevance(
                "game of th",
                movies.clone(),
                series.clone(),
                None
            )),
            [
                "Game of Thrones: The Last Watch",
                "Game of Thrones",
                "The Game of Their Lives"
            ],
            "sin puntajes: puesto de Cinemeta y lo que empieza con lo escrito"
        );
        let ratings: top::Ratings = [
            (10090796, (7.0, 9_000)),
            (409182, (6.6, 5_000)),
            (944947, (9.2, 2_400_000)),
        ]
        .into();
        assert_eq!(
            names(by_relevance(
                "game of th",
                movies.clone(),
                series.clone(),
                Some(&ratings)
            )),
            [
                "Game of Thrones",
                "Game of Thrones: The Last Watch",
                "The Game of Their Lives"
            ]
        );
        let rated = by_relevance("game of th", movies, series, Some(&ratings));
        assert_eq!(
            rated[0].imdb_rating.as_deref(),
            Some("9.2"),
            "puntaje del índice"
        );
    }

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
