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
/// cadenas de la serie y tráiler. Los similares van aparte ([`similar`]): se piden al abrirlos.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Details {
    /// ISO 639-1 (`en`, `es`, `ja`…).
    pub original_language: Option<String>,
    /// Series: dónde se emite (HBO, Netflix…).
    pub networks: Vec<String>,
    /// Id de YouTube del tráiler más viejo (en series, el de la temporada 1). Cinemeta trae
    /// varios sin título ni orden: el primero puede ser de la última temporada.
    #[serde(default)]
    pub trailer: Option<String>,
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
    original_language: Option<String>,
    #[serde(default)]
    networks: Vec<Named>,
    videos: Option<Videos>,
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

#[derive(Deserialize)]
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
    timeout: Duration,
) -> DetailsView {
    let Some(key) = crate::secrets::secret(ACCOUNT) else {
        return DetailsView {
            has_key: false,
            details: None,
        };
    };
    // v3: con tráiler y sin similares.
    let file = format!("tmdb-detalle-v3-{}-{imdb_id}.json", kind.as_str());
    if let Some((saved, _)) = data
        .get::<Details>(&file)
        .filter(|(_, age)| *age < DETAILS_TTL)
    {
        return DetailsView {
            has_key: true,
            details: Some(saved),
        };
    }
    let found = fetch_details(http, &key, kind, imdb_id, timeout).await;
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
    timeout: Duration,
) -> Option<Details> {
    let id = tmdb_id(http, key, kind, imdb_id, timeout).await?;
    let path = tmdb_path(kind);
    let raw: RawDetails = http
        .get_json(
            &format!(
                "https://api.themoviedb.org/3/{path}/{id}?append_to_response=videos&api_key={key}"
            ),
            timeout,
        )
        .await
        .map_err(|e| tracing::debug!(imdb_id, "TMDB detalle: {}", e.user_text()))
        .ok()?;
    Some(Details {
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
    timeout: Duration,
) -> Vec<Similar> {
    let Some(key) = crate::secrets::secret(ACCOUNT) else {
        return Vec::new();
    };
    let file = format!("tmdb-similares-{}-{imdb_id}.json", kind.as_str());
    if let Some((saved, _)) = data
        .get::<Vec<Similar>>(&file)
        .filter(|(_, age)| *age < DETAILS_TTL)
    {
        return saved;
    }
    let Some(found) = fetch_similar(http, &key, kind, imdb_id, timeout).await else {
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
    timeout: Duration,
) -> Option<Vec<Similar>> {
    let id = tmdb_id(http, key, kind, imdb_id, timeout).await?;
    let path = tmdb_path(kind);
    let page: Page = http
        .get_json(
            &format!("https://api.themoviedb.org/3/{path}/{id}/recommendations?api_key={key}"),
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

#[cfg(test)]
mod tests {
    use super::*;

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
