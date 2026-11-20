//! Pósters que Cinemeta no tiene (2026-11-15): muchos títulos nuevos no tienen imagen en metahub
//! (404). Con la API key de TMDB del usuario (gratis) se busca el póster por IMDb id. Sin key, la
//! UI dibuja uno con el título. La key vive en el almacén seguro y nunca va a un log: el pedido
//! se loguea enmascarado (`?****`) y los errores de red no llevan la URL.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::http::{FetchError, Http};
use super::MediaKind;
use crate::config::{Lang, LanguageConfig};
use crate::datacache::DataCache;
use crate::Result;

const POSTERS_KEY: &str = "tmdb-posters.json";
/// Lo recordado (también "no hay") se vuelve a preguntar pasado un mes.
const POSTERS_TTL: Duration = Duration::from_secs(30 * 24 * 3600);

/// Id del servicio en Ajustes (keys de servicios).
pub const TMDB: &str = "tmdb";
pub(crate) const ACCOUNT: &str = "tmdb-api-key";
/// Página donde se pide la key (cuenta gratis → Configuración → API).
pub const KEY_PAGE: &str = "https://www.themoviedb.org/settings/api";
const IMAGE_BASE: &str = "https://image.tmdb.org/t/p/w500";

/// Guarda la key (o la borra si viene vacía).
pub fn set_key(key: &str) -> Result<()> {
    crate::secrets::set_secret(ACCOUNT, key)
}

pub fn has_key() -> bool {
    crate::secrets::secret(ACCOUNT).is_some()
}

#[derive(Deserialize)]
struct FindResponse {
    #[serde(default)]
    movie_results: Vec<Found>,
    #[serde(default)]
    tv_results: Vec<Found>,
}

#[derive(Deserialize)]
struct Found {
    #[serde(default)]
    id: u64,
    poster_path: Option<String>,
    /// Con `language=…` (solo en `localized`): título traducido y fecha de estreno.
    title: Option<String>,
    release_date: Option<String>,
}

/// Póster por IMDb id, recordado por id (también "no hay"; un error de red no se recuerda) y
/// guardado en la caché de datos.
pub struct Posters {
    data: Arc<DataCache>,
    cache: Mutex<HashMap<String, Option<String>>>,
}

impl Posters {
    pub fn new(data: Arc<DataCache>) -> Self {
        let cache = data
            .get(POSTERS_KEY)
            .filter(|(_, age)| *age < POSTERS_TTL)
            .map(|(map, _)| map)
            .unwrap_or_default();
        Self {
            data,
            cache: Mutex::new(cache),
        }
    }

    pub async fn poster(&self, http: &Http, imdb_id: &str, timeout: Duration) -> Option<String> {
        if let Some(hit) = self.cache.lock().expect("posters").get(imdb_id) {
            return hit.clone();
        }
        let key = crate::secrets::secret(ACCOUNT)?;
        let url = format!(
            "https://api.themoviedb.org/3/find/{imdb_id}?external_source=imdb_id&api_key={key}"
        );
        let found = match http.get_json::<FindResponse>(&url, timeout).await {
            Ok(r) => poster_url(r),
            Err(FetchError::Status(401)) => {
                tracing::warn!("TMDB rechazó la API key (401): revisala en Ajustes");
                return None;
            }
            Err(e) => {
                tracing::debug!(imdb_id, "TMDB sin respuesta: {}", e.user_text());
                return None;
            }
        };
        let mut cache = self.cache.lock().expect("posters");
        cache.insert(imdb_id.to_string(), found.clone());
        self.data.put(POSTERS_KEY, &*cache);
        found
    }
}

fn poster_url(r: FindResponse) -> Option<String> {
    r.movie_results
        .into_iter()
        .chain(r.tv_results)
        .find_map(|f| f.poster_path)
        .map(|p| format!("{IMAGE_BASE}{p}"))
}

/// Datos de TMDB para el panel (2026-11-17): idioma original (manda en el audio por defecto),
/// cadenas de la serie, tráiler, dónde verla y los textos en los idiomas elegidos (2026-11-20).
/// Los similares van aparte ([`similar`]): se piden al abrirlos.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Details {
    /// Título en el idioma de los títulos.
    pub title: Option<String>,
    /// Sinopsis y géneros en el idioma de la app.
    pub overview: Option<String>,
    pub genres: Vec<String>,
    /// Dónde verla en Argentina (TMDB/JustWatch): suscripción primero, después con avisos o gratis.
    pub providers: Vec<Provider>,
    /// ISO 639-1 (`en`, `es`, `ja`…).
    pub original_language: Option<String>,
    /// Series: dónde se emite (HBO, Netflix…).
    pub networks: Vec<String>,
    /// Id de YouTube del tráiler más viejo (en series, el de la temporada 1). Cinemeta trae
    /// varios sin título ni orden: el primero puede ser de la última temporada.
    #[serde(default)]
    pub trailer: Option<String>,
}

/// Un servicio donde está el título, con su logo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,
    pub logo: Option<String>,
}

/// Un título similar, del mismo tipo que el de la ficha.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Similar {
    /// IMDb id: se abre como cualquier título del catálogo.
    pub id: String,
    pub name: String,
    pub year: Option<String>,
    pub poster: Option<String>,
    /// Puntaje de IMDb (dataset en memoria); si no está, el de TMDB. Se completa al pedirlo.
    #[serde(default)]
    pub rating: Option<f32>,
    /// Puntaje de TMDB, de respaldo.
    #[serde(default)]
    pub tmdb_rating: Option<f32>,
}

/// Lo que ve la UI: sin key, `has_key = false` y el panel ofrece configurarla.
#[derive(Debug, Clone, Serialize)]
pub struct DetailsView {
    pub has_key: bool,
    pub details: Option<Details>,
}

/// Similares que se muestran (cada uno cuesta un pedido para saber su IMDb id).
const SIMILAR_MAX: usize = 8;
const DETAILS_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

#[derive(Deserialize)]
struct RawDetails {
    /// Películas: `title`; series: `name`.
    title: Option<String>,
    name: Option<String>,
    overview: Option<String>,
    #[serde(default)]
    genres: Vec<Named>,
    original_language: Option<String>,
    #[serde(default)]
    networks: Vec<Named>,
    videos: Option<Videos>,
    #[serde(rename = "watch/providers")]
    providers: Option<WatchProviders>,
}

#[derive(Deserialize)]
struct WatchProviders {
    #[serde(default)]
    results: HashMap<String, Offers>,
}

#[derive(Deserialize, Default)]
struct Offers {
    #[serde(default)]
    flatrate: Vec<RawProvider>,
    #[serde(default)]
    ads: Vec<RawProvider>,
    #[serde(default)]
    free: Vec<RawProvider>,
}

#[derive(Deserialize, Clone)]
struct RawProvider {
    provider_id: u64,
    provider_name: String,
    logo_path: Option<String>,
    #[serde(default)]
    display_priority: i64,
}

const LOGO_BASE: &str = "https://image.tmdb.org/t/p/w92";

/// Argentina: suscripción, con avisos y gratis, sin repetir, en el orden de TMDB.
fn providers_ar(p: Option<WatchProviders>) -> Vec<Provider> {
    let ar = p
        .and_then(|mut p| p.results.remove("AR"))
        .unwrap_or_default();
    let mut all: Vec<RawProvider> = ar
        .flatrate
        .into_iter()
        .chain(ar.ads)
        .chain(ar.free)
        .collect();
    let mut seen = std::collections::HashSet::new();
    all.retain(|x| seen.insert(x.provider_id));
    all.sort_by_key(|x| x.display_priority);
    all.into_iter()
        .map(|x| Provider {
            name: super::normalize::clean(&x.provider_name),
            logo: x.logo_path.map(|l| format!("{LOGO_BASE}{l}")),
        })
        .collect()
}

#[derive(Deserialize)]
struct Videos {
    #[serde(default)]
    results: Vec<Video>,
}

#[derive(Deserialize)]
struct Video {
    key: String,
    site: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    official: bool,
    #[serde(default)]
    published_at: String,
}

/// El tráiler oficial de YouTube publicado primero (sin oficiales, cualquiera).
fn first_trailer(videos: Vec<Video>) -> Option<String> {
    videos
        .into_iter()
        .filter(|v| {
            v.site == "YouTube" && v.kind == "Trailer" && super::cinemeta::is_youtube_id(&v.key)
        })
        .min_by(|a, b| (!a.official, &a.published_at).cmp(&(!b.official, &b.published_at)))
        .map(|v| v.key)
}

#[derive(Deserialize, Clone)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct Page {
    #[serde(default)]
    results: Vec<Rec>,
}

#[derive(Deserialize)]
struct Rec {
    id: u64,
    /// Películas: `title`; series: `name`.
    title: Option<String>,
    name: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    poster_path: Option<String>,
    vote_average: Option<f32>,
}

#[derive(Deserialize)]
struct ExternalIds {
    imdb_id: Option<String>,
}

/// Detalles por IMDb id, guardados una semana en la caché de datos (un error no se guarda).
pub async fn details(
    http: &Http,
    data: &DataCache,
    kind: MediaKind,
    imdb_id: &str,
    langs: LanguageConfig,
    timeout: Duration,
) -> DetailsView {
    let Some(key) = crate::secrets::secret(ACCOUNT) else {
        return DetailsView {
            has_key: false,
            details: None,
        };
    };
    // v4: con dónde verla y los textos en los idiomas elegidos (uno por combinación).
    let file = format!(
        "tmdb-detalle-v4-{}-{imdb_id}-{}-{}.json",
        kind.as_str(),
        langs.titles.tmdb(),
        langs.app.tmdb()
    );
    if let Some((saved, _)) = data
        .get::<Details>(&file)
        .filter(|(_, age)| *age < DETAILS_TTL)
    {
        return DetailsView {
            has_key: true,
            details: Some(saved),
        };
    }
    let found = fetch_details(http, &key, kind, imdb_id, langs, timeout).await;
    if let Some(d) = &found {
        data.put(&file, d);
    }
    DetailsView {
        has_key: true,
        details: found,
    }
}

/// Película en TMDB con su título en español: lo necesitan las fuentes que solo buscan por ese
/// título (Hacktorrent). `None` sin key o si TMDB no responde.
pub struct Localized {
    pub tmdb_id: u64,
    pub title: Option<String>,
    pub year: Option<String>,
}

pub async fn localized(http: &Http, imdb_id: &str, timeout: Duration) -> Option<Localized> {
    let key = crate::secrets::secret(ACCOUNT)?;
    let find: FindResponse = http
        .get_json(
            &format!(
                "https://api.themoviedb.org/3/find/{imdb_id}?external_source=imdb_id&language=es-MX&api_key={key}"
            ),
            timeout,
        )
        .await
        .map_err(|e| tracing::debug!(imdb_id, "TMDB título: {}", e.user_text()))
        .ok()?;
    let f = find.movie_results.into_iter().next()?;
    Some(Localized {
        tmdb_id: f.id,
        title: f
            .title
            .map(|t| super::normalize::clean(&t))
            .filter(|t| !t.is_empty()),
        year: f.release_date.and_then(|d| d.get(..4).map(String::from)),
    })
}

const fn tmdb_path(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Movie => "movie",
        MediaKind::Series => "tv",
    }
}

/// Id de TMDB del título por su IMDb id.
async fn tmdb_id(
    http: &Http,
    key: &str,
    kind: MediaKind,
    imdb_id: &str,
    timeout: Duration,
) -> Option<u64> {
    let find: FindResponse = http
        .get_json(
            &format!(
                "https://api.themoviedb.org/3/find/{imdb_id}?external_source=imdb_id&api_key={key}"
            ),
            timeout,
        )
        .await
        .map_err(|e| tracing::debug!(imdb_id, "TMDB find: {}", e.user_text()))
        .ok()?;
    let found = match kind {
        MediaKind::Movie => find.movie_results.first(),
        MediaKind::Series => find.tv_results.first(),
    };
    found.map(|f| f.id)
}

async fn fetch_details(
    http: &Http,
    key: &str,
    kind: MediaKind,
    imdb_id: &str,
    langs: LanguageConfig,
    timeout: Duration,
) -> Option<Details> {
    let id = tmdb_id(http, key, kind, imdb_id, timeout).await?;
    let path = tmdb_path(kind);
    let get = |lang: Lang, extra: &str| {
        let url = format!(
            "https://api.themoviedb.org/3/{path}/{id}?language={}{extra}&api_key={key}",
            lang.tmdb()
        );
        async move {
            http.get_json::<RawDetails>(&url, timeout)
                .await
                .map_err(|e| tracing::debug!(imdb_id, "TMDB detalle: {}", e.user_text()))
                .ok()
        }
    };
    // Los videos en inglés (o sin idioma), como antes de pedir en el idioma de los títulos.
    let raw = get(
        langs.titles,
        "&append_to_response=videos,watch/providers&include_video_language=en,null",
    )
    .await?;
    // Sinopsis y géneros siempre en el idioma de la app: un pedido más solo si difiere.
    let about = if langs.app == langs.titles {
        None
    } else {
        get(langs.app, "").await
    };
    let (overview, genres) = match about {
        Some(a) => (a.overview, a.genres),
        None => (raw.overview.clone(), raw.genres.clone()),
    };
    Some(Details {
        title: raw
            .title
            .or(raw.name)
            .map(|t| super::normalize::clean(&t))
            .filter(|t| !t.is_empty()),
        overview: overview
            .map(|o| super::normalize::clean(&o))
            .filter(|o| !o.is_empty()),
        genres: genres
            .into_iter()
            .map(|g| super::normalize::clean(&g.name))
            .collect(),
        providers: providers_ar(raw.providers),
        original_language: raw.original_language.filter(|l| !l.is_empty()),
        networks: raw
            .networks
            .into_iter()
            .map(|n| super::normalize::clean(&n.name))
            .collect(),
        trailer: first_trailer(raw.videos.map(|v| v.results).unwrap_or_default()),
    })
}

/// Títulos similares (recomendaciones de TMDB) con su IMDb id, guardados una semana. Se piden solo
/// cuando el usuario abre "Similares" (2026-11-17): cada uno cuesta un pedido. Sin key, vacío.
pub async fn similar(
    http: &Http,
    data: &DataCache,
    kind: MediaKind,
    imdb_id: &str,
    titles: Lang,
    timeout: Duration,
) -> Vec<Similar> {
    let Some(key) = crate::secrets::secret(ACCOUNT) else {
        return Vec::new();
    };
    let file = format!(
        "tmdb-similares-{}-{imdb_id}-{}.json",
        kind.as_str(),
        titles.tmdb()
    );
    if let Some((saved, _)) = data
        .get::<Vec<Similar>>(&file)
        .filter(|(_, age)| *age < DETAILS_TTL)
    {
        return saved;
    }
    let Some(found) = fetch_similar(http, &key, kind, imdb_id, titles, timeout).await else {
        return Vec::new();
    };
    data.put(&file, &found);
    found
}

async fn fetch_similar(
    http: &Http,
    key: &str,
    kind: MediaKind,
    imdb_id: &str,
    titles: Lang,
    timeout: Duration,
) -> Option<Vec<Similar>> {
    let id = tmdb_id(http, key, kind, imdb_id, timeout).await?;
    let path = tmdb_path(kind);
    let page: Page = http
        .get_json(
            &format!(
                "https://api.themoviedb.org/3/{path}/{id}/recommendations?language={}&api_key={key}",
                titles.tmdb()
            ),
            timeout,
        )
        .await
        .map_err(|e| tracing::debug!(imdb_id, "TMDB similares: {}", e.user_text()))
        .ok()?;
    let recs: Vec<Rec> = page.results.into_iter().take(SIMILAR_MAX).collect();
    // El IMDb id de cada recomendación, en paralelo; las que no lo tienen no se pueden abrir.
    let mut ids = tokio::task::JoinSet::new();
    for (i, r) in recs.iter().enumerate() {
        let (http, url) = (
            http.clone(),
            format!(
                "https://api.themoviedb.org/3/{path}/{}/external_ids?api_key={key}",
                r.id
            ),
        );
        ids.spawn(async move {
            (
                i,
                http.get_json::<ExternalIds>(&url, timeout)
                    .await
                    .ok()
                    .and_then(|x| x.imdb_id),
            )
        });
    }
    let mut imdb: Vec<Option<String>> = vec![None; recs.len()];
    while let Some(Ok((i, id))) = ids.join_next().await {
        imdb[i] = id.filter(|id| id.starts_with("tt"));
    }
    Some(
        recs.into_iter()
            .zip(imdb)
            .filter_map(|(r, id)| {
                Some(Similar {
                    id: id?,
                    name: super::normalize::clean(r.title.or(r.name)?.as_str()),
                    year: r
                        .release_date
                        .or(r.first_air_date)
                        .and_then(|d| d.get(..4).map(str::to_string)),
                    poster: r.poster_path.map(|p| format!("{IMAGE_BASE}{p}")),
                    rating: None,
                    tmdb_rating: r.vote_average.filter(|&v| v > 0.0),
                })
            })
            .collect(),
    )
}

/// Título y sinopsis de un episodio en los idiomas elegidos (Cinemeta los trae solo en inglés).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeText {
    pub episode: u32,
    pub name: Option<String>,
    pub overview: Option<String>,
}

#[derive(Deserialize)]
struct RawSeason {
    #[serde(default)]
    episodes: Vec<RawEpisode>,
}

#[derive(Deserialize)]
struct RawEpisode {
    episode_number: u32,
    name: Option<String>,
    overview: Option<String>,
}

/// Episodios de una temporada: título en el idioma de los títulos, sinopsis en el de la app.
/// Guardados una semana por temporada y combinación de idiomas. Sin key o si falla, vacío (la UI
/// deja los de Cinemeta).
pub async fn episodes(
    http: &Http,
    data: &DataCache,
    imdb_id: &str,
    season: u32,
    langs: LanguageConfig,
    timeout: Duration,
) -> Vec<EpisodeText> {
    let Some(key) = crate::secrets::secret(ACCOUNT) else {
        return Vec::new();
    };
    let file = format!(
        "tmdb-episodios-{imdb_id}-{season}-{}-{}.json",
        langs.titles.tmdb(),
        langs.app.tmdb()
    );
    if let Some((saved, _)) = data
        .get::<Vec<EpisodeText>>(&file)
        .filter(|(_, age)| *age < DETAILS_TTL)
    {
        return saved;
    }
    let Some(id) = tmdb_id(http, &key, MediaKind::Series, imdb_id, timeout).await else {
        return Vec::new();
    };
    let get = |lang: Lang| {
        let url = format!(
            "https://api.themoviedb.org/3/tv/{id}/season/{season}?language={}&api_key={key}",
            lang.tmdb()
        );
        async move {
            http.get_json::<RawSeason>(&url, timeout)
                .await
                .map_err(|e| tracing::debug!(imdb_id, "TMDB temporada: {}", e.user_text()))
                .ok()
                .map(|s| s.episodes)
        }
    };
    let Some(named) = get(langs.titles).await else {
        return Vec::new();
    };
    let about = if langs.app == langs.titles {
        None
    } else {
        get(langs.app).await
    };
    let text = |t: Option<String>| {
        t.map(|t| super::normalize::clean(&t))
            .filter(|t| !t.is_empty())
    };
    let found: Vec<EpisodeText> = named
        .into_iter()
        .map(|e| {
            let overview = match &about {
                Some(list) => list
                    .iter()
                    .find(|a| a.episode_number == e.episode_number)
                    .and_then(|a| a.overview.clone()),
                None => e.overview,
            };
            EpisodeText {
                episode: e.episode_number,
                name: text(e.name),
                overview: text(overview),
            }
        })
        .collect();
    data.put(&file, &found);
    found
}

/// La película o serie de un torrent pegado (2026-11-20, "Pegar magnet" de la web), reconocida
/// por su nombre en TMDB.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identified {
    pub kind: MediaKind,
    /// IMDb id: se abre como cualquier título del catálogo.
    pub id: String,
    pub name: String,
    pub year: Option<String>,
    pub poster: Option<String>,
    /// Puntaje de IMDb (se completa con el índice en memoria, si está).
    #[serde(default)]
    pub rating: Option<String>,
    pub season: Option<u16>,
    pub episode: Option<u16>,
}

#[derive(Deserialize)]
struct MultiPage {
    #[serde(default)]
    results: Vec<MultiHit>,
}

#[derive(Deserialize)]
struct MultiHit {
    id: u64,
    #[serde(default)]
    media_type: String,
    title: Option<String>,
    name: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    poster_path: Option<String>,
    #[serde(default)]
    original_language: String,
}

/// Lo que se busca en TMDB por el nombre de un release: título, año y si es de una serie.
#[derive(Debug, PartialEq, Eq)]
struct NameQuery {
    title: String,
    year: Option<String>,
    season: Option<u16>,
    episode: Option<u16>,
}

fn name_query(name: &str) -> Option<NameQuery> {
    let r = crate::release::parse_release_name(name);
    let title = r.title.filter(|t| t.chars().count() >= 2)?;
    Some(NameQuery {
        title,
        year: r.year.map(|y| y.to_string()),
        season: r.season,
        episode: r.episode,
    })
}

/// De los resultados, el que mejor calza: con temporada o capítulo solo series; si el nombre trae
/// año, el de ese año; si no, el primero (TMDB ordena por relevancia). Sin anime (FR-40).
fn best_hit(hits: Vec<MultiHit>, q: &NameQuery) -> Option<MultiHit> {
    let fit: Vec<MultiHit> = hits
        .into_iter()
        .filter(|h| match h.media_type.as_str() {
            "tv" => true,
            "movie" => q.season.is_none(),
            _ => false,
        })
        .filter(|h| h.original_language != "ja")
        .collect();
    let year_of = |h: &MultiHit| {
        h.release_date
            .as_deref()
            .or(h.first_air_date.as_deref())
            .and_then(|d| d.get(..4))
            .map(str::to_string)
    };
    let pick = q
        .year
        .as_ref()
        .and_then(|y| fit.iter().position(|h| year_of(h).as_ref() == Some(y)))
        .unwrap_or(0);
    fit.into_iter().nth(pick)
}

pub async fn identify(
    http: &Http,
    name: &str,
    titles: Lang,
    timeout: Duration,
) -> Option<Identified> {
    let key = crate::secrets::secret(ACCOUNT)?;
    let q = name_query(name)?;
    let url = format!(
        "https://api.themoviedb.org/3/search/multi?query={}&language={}&include_adult=false&api_key={key}",
        super::protocol::encode_extra(&q.title),
        titles.tmdb()
    );
    let page: MultiPage = http
        .get_json(&url, timeout)
        .await
        .map_err(|e| tracing::debug!("TMDB identificar: {}", e.user_text()))
        .ok()?;
    let hit = best_hit(page.results, &q)?;
    let (kind, path) = if hit.media_type == "tv" {
        (MediaKind::Series, "tv")
    } else {
        (MediaKind::Movie, "movie")
    };
    let ids: ExternalIds = http
        .get_json(
            &format!(
                "https://api.themoviedb.org/3/{path}/{}/external_ids?api_key={key}",
                hit.id
            ),
            timeout,
        )
        .await
        .ok()?;
    Some(Identified {
        kind,
        id: ids.imdb_id.filter(|id| id.starts_with("tt"))?,
        name: super::normalize::clean(hit.title.or(hit.name)?.as_str()),
        year: hit
            .release_date
            .or(hit.first_air_date)
            .and_then(|d| d.get(..4).map(str::to_string)),
        poster: hit.poster_path.map(|p| format!("{IMAGE_BASE}{p}")),
        rating: None,
        season: q.season,
        episode: q.episode,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconoce_el_titulo_de_un_release() {
        let q = name_query("The.Bear.S03E02.1080p.WEB-DL.mkv").unwrap();
        assert_eq!(
            (q.title.as_str(), q.season, q.episode),
            ("The Bear", Some(3), Some(2))
        );
        let hit = |id, media: &str, date: &str| MultiHit {
            id,
            media_type: media.into(),
            title: Some("X".into()),
            name: None,
            release_date: Some(date.into()),
            first_air_date: None,
            poster_path: None,
            original_language: "en".into(),
        };
        // Con capítulo, solo series; con año, el de ese año.
        let hits = vec![hit(1, "movie", "2022-01-01"), hit(2, "tv", "2022-06-01")];
        assert_eq!(best_hit(hits, &q).map(|h| h.id), Some(2));
        let movie = name_query("Oppenheimer (2023) [1080p]").unwrap();
        assert_eq!(movie.year.as_deref(), Some("2023"));
        let hits = vec![hit(1, "movie", "1990-01-01"), hit(2, "movie", "2023-07-21")];
        assert_eq!(best_hit(hits, &movie).map(|h| h.id), Some(2));
        assert!(name_query("x").is_none());
    }

    #[test]
    fn donde_verla_en_argentina_sin_repetir() {
        let p: WatchProviders = serde_json::from_str(
            r#"{"results":{"AR":{"flatrate":[{"provider_id":8,"provider_name":"Netflix","logo_path":"/n.jpg","display_priority":2}],
              "free":[{"provider_id":8,"provider_name":"Netflix","display_priority":2},{"provider_id":1,"provider_name":"Cine.ar","display_priority":1}]},
              "US":{"flatrate":[{"provider_id":9,"provider_name":"Prime","display_priority":0}]}}}"#,
        )
        .unwrap();
        let names: Vec<String> = providers_ar(Some(p)).into_iter().map(|x| x.name).collect();
        assert_eq!(names, ["Cine.ar", "Netflix"]);
    }

    #[test]
    fn trailer_oficial_mas_viejo() {
        let v: Videos = serde_json::from_str(
            r#"{"results":[
              {"key":"SSSSSSSSSS5","site":"YouTube","type":"Trailer","official":true,"published_at":"2024-01-01"},
              {"key":"TEASERxxxxx","site":"YouTube","type":"Teaser","official":true,"published_at":"2018-01-01"},
              {"key":"FANxxxxxxxx","site":"YouTube","type":"Trailer","official":false,"published_at":"2017-01-01"},
              {"key":"SSSSSSSSSS1","site":"YouTube","type":"Trailer","official":true,"published_at":"2019-03-01"}]}"#,
        )
        .unwrap();
        assert_eq!(first_trailer(v.results).as_deref(), Some("SSSSSSSSSS1"));
    }

    #[test]
    fn toma_el_primer_poster_de_pelicula_o_serie() {
        let r: FindResponse = serde_json::from_str(
            r#"{"movie_results":[],"tv_results":[{"poster_path":null},{"poster_path":"/x.jpg"}]}"#,
        )
        .unwrap();
        assert_eq!(
            poster_url(r).as_deref(),
            Some("https://image.tmdb.org/t/p/w500/x.jpg")
        );
        let empty: FindResponse = serde_json::from_str("{}").unwrap();
        assert_eq!(poster_url(empty), None);
    }
}
