//! Explorar con los filtros de la búsqueda avanzada de IMDb (pedido 2026-11-15; desde el
//! 2026-11-16 para películas y series, por puntaje o popularidad): rango de estreno, piso de
//! votos e idioma original. Ninguna fuente gratis tiene todo: TMDB discover da los títulos del rango (y su ficha, el
//! IMDb id y el idioma original) y el dataset oficial de IMDb `title.ratings` (gratis para uso
//! personal, se actualiza a diario) da el puntaje y los votos reales. Se cruzan por IMDb id.
//! Requiere la key de TMDB del usuario; nunca va a un log (los errores de red no llevan la URL).

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use super::cinemeta::{is_excluded, BrowseSort, MetaPreview};
use super::http::{FetchError, Http};
use super::MediaKind;
use crate::datacache::DataCache;
use crate::{CoreError, Result};

const RATINGS_URL: &str = "https://datasets.imdbws.com/title.ratings.tsv.gz";
/// El .gz pesa ~8 MB; margen por si crece.
const RATINGS_MAX: usize = 40 * 1024 * 1024;
/// Los datasets de IMDb se actualizan a diario: lo guardado sirve un día.
pub(super) const DATASET_TTL: Duration = Duration::from_secs(24 * 3600);
/// Las fichas de TMDB (IMDb id, idioma) casi no cambian.
const DETAILS_TTL: Duration = Duration::from_secs(90 * 24 * 3600);
const DETAILS_KEY: &str = "tmdb-fichas.json";
/// Menos votos que esto no se guarda. Bajo (2026-11-16) porque también lo usan los episodios
/// (`seasons`), que suelen tener pocos votos; el piso de la UI filtra después.
const KEEP_MIN_VOTES: u32 = 10;
const API: &str = "https://api.themoviedb.org/3";
const IMAGE_BASE: &str = "https://image.tmdb.org/t/p/w500";
/// TMDB tiene ~100 veces menos votos que IMDb en películas recientes: se piden candidatas con
/// un piso 2,5 veces más bajo que esa proporción para no perder ninguna.
const TMDB_VOTE_RATIO: u32 = 250;
/// Páginas de 20 de discover (600 candidatas, ordenadas por votos de TMDB).
/// shortcut: sin rango de fechas (toda la historia) quedan afuera las de menos votos en TMDB;
/// si hiciera falta, paginar hasta que el piso corte en vez de este tope.
const MAX_PAGES: u32 = 30;
/// Género de TMDB para "documentales" (en Cinemeta es `Documentary`).
const TMDB_DOCUMENTARY: u32 = 99;

/// Filtros de la lista (los de la URL de IMDb).
#[derive(Debug, Clone)]
pub struct TopQuery {
    pub kind: MediaKind,
    /// Puntaje de IMDb (a igual puntaje, más votos) o popularidad de TMDB.
    pub sort: BrowseSort,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub min_votes: u32,
    /// ISO 639-1 (`en`, `es`); vacío = cualquier idioma. Idioma original (alcanza con que sea uno de estos).
    pub languages: Vec<String>,
    pub documentary: bool,
}

/// Puntaje (una decimal, como lo muestra IMDb) y votos, por número de `tt`.
pub(super) type Ratings = HashMap<u32, (f32, u32)>;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Detail {
    imdb: Option<u32>,
    languages: Vec<String>,
    excluded: bool,
}

#[derive(Deserialize)]
struct DiscoverPage {
    #[serde(default)]
    total_pages: u32,
    #[serde(default)]
    results: Vec<Candidate>,
}

/// Película o serie de discover (las series traen `name` y `first_air_date`).
#[derive(Debug, Clone, Deserialize)]
struct Candidate {
    id: u64,
    #[serde(default, alias = "name")]
    title: String,
    #[serde(alias = "first_air_date")]
    release_date: Option<String>,
    poster_path: Option<String>,
    popularity: Option<f64>,
    #[serde(default)]
    genre_ids: Vec<u32>,
}

/// Géneros de TMDB (ids fijos de su API) con el nombre que se muestra. Los de series que juntan
/// dos (Acción y aventura, Ciencia ficción y fantasía) cuentan para los dos; los que no tienen
/// equivalente en la lista de la UI (infantil, reality, noticias…) no se muestran.
const GENRES: &[(u32, &str)] = &[
    (28, "Acción"),
    (12, "Aventura"),
    (16, "Animación"),
    (35, "Comedia"),
    (80, "Crimen"),
    (99, "Documental"),
    (18, "Drama"),
    (10751, "Familia"),
    (14, "Fantasía"),
    (36, "Historia"),
    (27, "Terror"),
    (10402, "Música"),
    (9648, "Misterio"),
    (10749, "Romance"),
    (878, "Ciencia ficción"),
    (10770, "Película de TV"),
    (53, "Suspenso"),
    (10752, "Bélica"),
    (37, "Western"),
    (10759, "Acción"),
    (10759, "Aventura"),
    (10765, "Ciencia ficción"),
    (10765, "Fantasía"),
    (10768, "Bélica"),
];

fn genre_names(ids: &[u32]) -> Vec<String> {
    ids.iter()
        .flat_map(|id| GENRES.iter().filter(move |(g, _)| g == id))
        .map(|(_, n)| (*n).to_string())
        .collect()
}

#[derive(Deserialize)]
struct RawDetail {
    /// Películas; las series lo traen en `external_ids`.
    imdb_id: Option<String>,
    external_ids: Option<ExternalIds>,
    original_language: Option<String>,
    #[serde(default)]
    origin_country: Vec<String>,
    #[serde(default)]
    genres: Vec<Genre>,
}

#[derive(Deserialize)]
struct ExternalIds {
    imdb_id: Option<String>,
}

#[derive(Deserialize)]
struct Genre {
    name: String,
}

pub struct TopRated {
    data: Arc<DataCache>,
    /// Puntajes ya leídos del dataset (leerlo cuesta segundos).
    ratings: tokio::sync::Mutex<Option<(Instant, Arc<Ratings>)>>,
    /// Ficha por tipo e id de TMDB (películas y series tienen ids independientes). La primera
    /// lista tarda (~1 pedido por candidata); quedan guardadas en la caché de datos.
    details: Mutex<HashMap<(MediaKind, u64), Detail>>,
}

impl TopRated {
    pub fn new(data: Arc<DataCache>) -> Self {
        let details = data
            .get::<Vec<(MediaKind, u64, Detail)>>(DETAILS_KEY)
            .filter(|(_, age)| *age < DETAILS_TTL)
            .map(|(list, _)| list.into_iter().map(|(k, id, d)| ((k, id), d)).collect())
            .unwrap_or_default();
        Self {
            data,
            ratings: tokio::sync::Mutex::default(),
            details: Mutex::new(details),
        }
    }

    pub async fn list(
        &self,
        http: &Http,
        q: &TopQuery,
        timeout: Duration,
    ) -> Result<Vec<MetaPreview>> {
        let key = crate::secrets::secret(super::tmdb::ACCOUNT).ok_or_else(|| CoreError::Catalog {
            user: "Para filtrar por votos e idioma hace falta la key gratuita de TMDB (Ajustes → Pósters).".into(),
            detail: "top: sin key de TMDB".into(),
        })?;
        let ratings = self.ratings(http).await?;
        let candidates = discover(http, &key, q, timeout).await?;
        self.fill_details(http, &key, q.kind, &candidates, timeout)
            .await?;
        let details = self.details.lock().expect("details").clone();
        Ok(rank(candidates, &details, &ratings, q))
    }

    /// Los puntajes si ya están en memoria, sin esperar a leerlos (para no frenar la búsqueda).
    pub(super) fn ratings_loaded(&self) -> Option<Arc<Ratings>> {
        let slot = self.ratings.try_lock().ok()?;
        slot.as_ref().map(|(_, r)| r.clone())
    }

    /// Puntajes de IMDb, leídos del dataset una vez por día (si no se puede actualizar, sirven
    /// los anteriores).
    pub(super) async fn ratings(&self, http: &Http) -> Result<Arc<Ratings>> {
        let mut slot = self.ratings.lock().await;
        if let Some((at, r)) = slot.as_ref() {
            if at.elapsed() < DATASET_TTL {
                return Ok(r.clone());
            }
        }
        let gz =
            match imdb_dataset(http, &self.data, RATINGS_URL, RATINGS_MAX, "los puntajes").await {
                Ok(gz) => gz,
                Err(e) => return slot.as_ref().map(|(_, r)| r.clone()).ok_or(e),
            };
        let r = tokio::task::spawn_blocking(move || {
            parse_ratings(flate2::read::GzDecoder::new(&gz[..]))
        })
        .await
        .unwrap_or_default();
        tracing::info!(titulos = r.len(), "puntajes de IMDb listos");
        let r = Arc::new(r);
        *slot = Some((Instant::now(), r.clone()));
        Ok(r)
    }

    async fn fill_details(
        &self,
        http: &Http,
        key: &str,
        kind: MediaKind,
        candidates: &[Candidate],
        timeout: Duration,
    ) -> Result<()> {
        let missing: Vec<u64> = {
            let known = self.details.lock().expect("details");
            candidates
                .iter()
                .map(|c| c.id)
                .filter(|id| !known.contains_key(&(kind, *id)))
                .collect()
        };
        if missing.is_empty() {
            return Ok(());
        }
        // El cliente limita a 2 pedidos a la vez por host (NFR-23): se lanzan todos y esperan turno.
        let mut tasks = tokio::task::JoinSet::new();
        for id in missing {
            let url = match kind {
                MediaKind::Movie => format!("{API}/movie/{id}?api_key={key}"),
                MediaKind::Series => {
                    format!("{API}/tv/{id}?api_key={key}&append_to_response=external_ids")
                }
            };
            let http = http.clone();
            tasks.spawn(async move { (id, http.get_json::<RawDetail>(&url, timeout).await) });
        }
        while let Some(done) = tasks.join_next().await {
            let Ok((id, res)) = done else { continue };
            match res {
                Ok(raw) => {
                    self.details
                        .lock()
                        .expect("details")
                        .insert((kind, id), detail(raw));
                }
                Err(FetchError::Status(401)) => return Err(bad_key()),
                // Una ficha que falla queda afuera esta vez (no se recuerda: se reintenta la próxima).
                Err(e) => tracing::debug!(id, "TMDB sin ficha: {}", e.user_text()),
            }
        }
        let all: Vec<(MediaKind, u64, Detail)> = self
            .details
            .lock()
            .expect("details")
            .iter()
            .map(|((k, id), d)| (*k, *id, d.clone()))
            .collect();
        self.data.put(DETAILS_KEY, &all);
        Ok(())
    }
}

/// Un dataset de IMDb (.gz), guardado en la caché de datos: si tiene menos de un día se usa ese;
/// si no, se baja de nuevo y, si falla, sirve el viejo. `what`: para el mensaje de error.
pub(super) async fn imdb_dataset(
    http: &Http,
    data: &DataCache,
    url: &str,
    max: usize,
    what: &str,
) -> Result<Vec<u8>> {
    let key = url.rsplit('/').next().unwrap_or(url);
    let saved = data.read(key);
    if saved.as_ref().is_some_and(|(_, age)| *age < DATASET_TTL) {
        return Ok(saved.map(|(gz, _)| gz).unwrap_or_default());
    }
    match http.get_large(url, max, Duration::from_secs(180)).await {
        Ok(gz) => {
            data.write(key, &gz);
            Ok(gz)
        }
        Err(e) => match saved {
            Some((old, _)) => {
                tracing::warn!(
                    "no se pudo actualizar {key} ({}); uso el guardado",
                    e.user_text()
                );
                Ok(old)
            }
            None => Err(super::fetch_error(&format!("bajar {what} de IMDb"), &e)),
        },
    }
}

fn bad_key() -> CoreError {
    CoreError::Catalog {
        user: "TMDB rechazó la key: revisala en Ajustes → Pósters.".into(),
        detail: "top: TMDB 401".into(),
    }
}

/// Títulos del rango, de más a menos votados en TMDB, hasta que bajan del piso proporcional.
async fn discover(
    http: &Http,
    key: &str,
    q: &TopQuery,
    timeout: Duration,
) -> Result<Vec<Candidate>> {
    let floor = (q.min_votes / TMDB_VOTE_RATIO).max(20);
    let genre = if q.documentary {
        format!("&with_genres={TMDB_DOCUMENTARY}")
    } else {
        String::new()
    };
    let (path, date) = match q.kind {
        MediaKind::Movie => ("movie", "primary_release_date"),
        MediaKind::Series => ("tv", "first_air_date"),
    };
    let mut out = Vec::new();
    let mut page = 1;
    loop {
        let url = format!(
            "{API}/discover/{path}?api_key={key}&sort_by=vote_count.desc&include_adult=false&include_video=false\
             &{date}.gte={}&{date}.lte={}&vote_count.gte={floor}{genre}&page={page}",
            q.from, q.to
        );
        let p: DiscoverPage = match http.get_json(&url, timeout).await {
            Ok(p) => p,
            Err(FetchError::Status(401)) => return Err(bad_key()),
            Err(e) => return Err(super::fetch_error("cargar la lista de TMDB", &e)),
        };
        out.extend(p.results);
        if page >= p.total_pages.min(MAX_PAGES) {
            return Ok(out);
        }
        page += 1;
    }
}

fn detail(raw: RawDetail) -> Detail {
    // Idioma original, no los hablados: una francesa con diálogos en inglés no es "en inglés" (pedido 2026-11-15).
    let languages: Vec<String> = raw.original_language.into_iter().collect();
    // `is_excluded` (FR-40) espera nombres de país; solo le importa Japón.
    let countries = raw
        .origin_country
        .iter()
        .map(|c| if c == "JP" { "Japan" } else { c.as_str() })
        .collect::<Vec<_>>()
        .join(", ");
    let genres: Vec<String> = raw.genres.into_iter().map(|g| g.name).collect();
    Detail {
        imdb: raw
            .imdb_id
            .or(raw.external_ids.and_then(|e| e.imdb_id))
            .as_deref()
            .and_then(tt_number),
        languages,
        excluded: is_excluded(Some(&countries), &genres),
    }
}

pub(super) fn tt_number(id: &str) -> Option<u32> {
    id.strip_prefix("tt")?.parse().ok()
}

/// Una línea por título: `tconst\taverageRating\tnumVotes` (con encabezado).
fn parse_ratings(r: impl Read) -> Ratings {
    BufReader::new(r)
        .lines()
        .map_while(std::result::Result::ok)
        .filter_map(|line| {
            let mut f = line.split('\t');
            let tt = tt_number(f.next()?)?;
            let rating: f32 = f.next()?.parse().ok()?;
            let votes: u32 = f.next()?.parse().ok()?;
            (votes >= KEEP_MIN_VOTES).then_some((tt, (rating, votes)))
        })
        .collect()
}

/// Cruce y orden: como IMDb, por puntaje y, a igual puntaje, por votos (o por popularidad de TMDB).
fn rank(
    candidates: Vec<Candidate>,
    details: &HashMap<(MediaKind, u64), Detail>,
    ratings: &Ratings,
    q: &TopQuery,
) -> Vec<MetaPreview> {
    let mut seen = HashSet::new();
    let mut hits: Vec<(f32, u32, MetaPreview)> = candidates
        .into_iter()
        .filter_map(|c| {
            let d = details.get(&(q.kind, c.id))?;
            let tt = d.imdb?;
            let &(rating, votes) = ratings.get(&tt)?;
            let lang_ok =
                q.languages.is_empty() || d.languages.iter().any(|l| q.languages.contains(l));
            if votes < q.min_votes || !lang_ok || !seen.insert(tt) {
                return None;
            }
            let released = c.release_date.filter(|d| !d.is_empty());
            Some((
                rating,
                votes,
                MetaPreview {
                    id: format!("tt{tt:07}"),
                    kind: q.kind,
                    name: c.title,
                    year: released.as_ref().map(|d| d[..4.min(d.len())].to_string()),
                    imdb_rating: Some(format!("{rating:.1}")),
                    excluded: d.excluded,
                    poster: c.poster_path.map(|p| format!("{IMAGE_BASE}{p}")),
                    released,
                    popularity: c.popularity,
                    genres: genre_names(&c.genre_ids),
                },
            ))
        })
        .collect();
    match q.sort {
        BrowseSort::Rating => hits.sort_by(|a, b| b.0.total_cmp(&a.0).then(b.1.cmp(&a.1))),
        BrowseSort::Popular => hits.sort_by(|a, b| {
            let pop = |h: &(f32, u32, MetaPreview)| h.2.popularity.unwrap_or(0.0);
            pop(b).total_cmp(&pop(a))
        }),
    }
    hits.into_iter().map(|(_, _, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(min_votes: u32, languages: &[&str]) -> TopQuery {
        TopQuery {
            kind: MediaKind::Movie,
            sort: BrowseSort::Rating,
            from: NaiveDate::from_ymd_opt(2025, 1, 1).unwrap(),
            to: NaiveDate::from_ymd_opt(2026, 11, 30).unwrap(),
            min_votes,
            languages: languages.iter().map(|s| s.to_string()).collect(),
            documentary: false,
        }
    }

    fn cand(id: u64, title: &str) -> Candidate {
        Candidate {
            id,
            title: title.into(),
            release_date: Some("2025-04-18".into()),
            poster_path: None,
            popularity: None,
            genre_ids: vec![28, 53, 1],
        }
    }

    #[test]
    fn generos_de_tmdb_en_espanol_ignorando_ids_desconocidos() {
        assert_eq!(genre_names(&cand(1, "A").genre_ids), ["Acción", "Suspenso"]);
    }

    #[test]
    fn lee_el_dataset_y_descarta_los_de_pocos_votos() {
        let tsv = "tconst\taverageRating\tnumVotes\ntt0000001\t5.7\t2100\ntt0000002\t5.6\t5\nmal\n";
        let r = parse_ratings(tsv.as_bytes());
        assert_eq!(r.get(&1), Some(&(5.7, 2100)));
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn cruza_filtra_por_votos_e_idioma_y_ordena_por_puntaje() {
        let ratings: Ratings = [
            (10, (7.5, 300_000)),
            (20, (8.1, 60_000)),
            (30, (9.0, 40_000)),
            (40, (7.5, 900_000)),
            (50, (8.5, 80_000)),
        ]
        .into();
        let d = |imdb, langs: &[&str]| Detail {
            imdb: Some(imdb),
            languages: langs.iter().map(|s| s.to_string()).collect(),
            excluded: false,
        };
        let m = MediaKind::Movie;
        let details: HashMap<(MediaKind, u64), Detail> = [
            ((m, 1), d(10, &["en"])),
            ((m, 2), d(20, &["es"])),
            ((m, 3), d(30, &["en"])),
            ((m, 4), d(40, &["en", "fr"])),
            ((m, 5), d(50, &["fr"])),
        ]
        .into();
        let cands = vec![
            cand(1, "A"),
            cand(2, "B"),
            cand(3, "C"),
            cand(4, "D"),
            cand(5, "E"),
            cand(6, "sin ficha"),
        ];
        let names: Vec<String> = rank(cands, &details, &ratings, &q(50_000, &["en", "es"]))
            .into_iter()
            .map(|p| p.name)
            .collect();
        // C: pocos votos; E: solo francés; a igual puntaje (A, D) va primero el más votado.
        assert_eq!(names, ["B", "D", "A"]);
    }

    #[test]
    fn ficha_de_tmdb_a_idiomas_imdb_y_filtro_anime() {
        let raw: RawDetail = serde_json::from_str(
            r#"{"imdb_id":"tt31193180","spoken_languages":[{"iso_639_1":"ja"}],"original_language":"ja","origin_country":["JP"],"genres":[{"name":"Animation"}]}"#,
        )
        .unwrap();
        let d = detail(raw);
        assert_eq!(d.imdb, Some(31193180));
        assert!(d.excluded);
        assert_eq!(d.languages, ["ja"]);
    }

    #[test]
    fn serie_de_tmdb_nombre_fecha_imdb_y_generos_dobles() {
        let c: Candidate = serde_json::from_str(
            r#"{"id":1396,"name":"Breaking Bad","first_air_date":"2008-01-20","genre_ids":[18,10759,10764]}"#,
        )
        .unwrap();
        assert_eq!(
            (c.title.as_str(), c.release_date.as_deref()),
            ("Breaking Bad", Some("2008-01-20"))
        );
        assert_eq!(genre_names(&c.genre_ids), ["Drama", "Acción", "Aventura"]);
        let raw: RawDetail = serde_json::from_str(
            r#"{"original_language":"en","external_ids":{"imdb_id":"tt0903747"}}"#,
        )
        .unwrap();
        assert_eq!(detail(raw).imdb, Some(903747));
    }

    // Red real: `cargo test -p streamonte-core --lib top::tests::dataset_real -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn dataset_real() {
        let data = DataCache::new(std::env::temp_dir().join("streamonte-test-top-real"));
        let r = TopRated::new(Arc::new(data))
            .ratings(&Http::new(Duration::from_secs(10)))
            .await
            .unwrap();
        let &(rating, votes) = r.get(&29355505).expect("Toy Story 5");
        assert!(votes > 50_000 && rating > 5.0, "{rating} {votes}");
    }
}
