//! Puntaje por temporada de una serie (pedido 2026-11-16: ver si la serie decayó), siempre el de
//! IMDb: el dataset oficial `title.episode` (qué episodios tiene cada serie) cruzado con
//! `title.ratings` (que ya baja `top`), promediando los episodios de cada temporada. TMDB tiene sus
//! propios votos y no coincide con lo que el usuario ve en IMDb, así que de TMDB (con key) solo se
//! toma el estado de la serie y el próximo episodio; sin key, los de Cinemeta.
//!
//! Los datasets se cruzan una vez por día en un índice (serie → temporadas) que queda en la caché
//! de datos y se arma de fondo al abrir la app: cada serie sale después en milisegundos.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::cinemeta::Meta;
use super::http::{FetchError, Http};
use super::top::{imdb_dataset, tt_number, Ratings, TopRated, DATASET_TTL};
use crate::datacache::DataCache;
use crate::Result;

const EPISODES_URL: &str = "https://datasets.imdbws.com/title.episode.tsv.gz";
/// El .gz pesa ~55 MB; margen por si crece.
const EPISODES_MAX: usize = 150 * 1024 * 1024;
/// El índice armado, en la caché de datos (se rehace cuando vence, como los datasets).
const INDEX_KEY: &str = "imdb-temporadas-v1.tsv";
/// Estado de una serie guardado: cambia poco.
const STATUS_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const API: &str = "https://api.themoviedb.org/3";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SeasonScore {
    pub season: u32,
    /// Promedio, con un decimal.
    pub rating: f32,
    /// Episodios con puntaje (en TMDB: los de la temporada).
    pub episodes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonRatings {
    /// Puntajes de IMDb (vacío si IMDb no tiene, o con `quick` si el índice no está listo).
    pub seasons: Vec<SeasonScore>,
    /// `None` si ninguna fuente lo sabe.
    pub status: Option<ShowStatus>,
}

/// En qué está la serie (2026-11-16: "¿sale otra temporada?").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShowState {
    /// Sigue: renovada o en emisión.
    Returning,
    /// En producción (rodaje, piloto).
    InProduction,
    Planned,
    Ended,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NextEpisode {
    pub season: u32,
    pub episode: u32,
    /// `AAAA-MM-DD`.
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShowStatus {
    pub state: ShowState,
    pub next: Option<NextEpisode>,
}

/// IMDb id numérico de la serie → sus temporadas en orden.
type Index = HashMap<u32, Vec<SeasonScore>>;

pub struct Seasons {
    data: Arc<DataCache>,
    index: tokio::sync::Mutex<Option<(Instant, Arc<Index>)>>,
    /// Estado por IMDb id en esta sesión (en disco dura `STATUS_TTL`).
    status: Mutex<HashMap<String, Option<ShowStatus>>>,
}

impl Seasons {
    pub fn new(data: Arc<DataCache>) -> Self {
        Self {
            data,
            index: tokio::sync::Mutex::default(),
            status: Mutex::default(),
        }
    }

    /// `quick` (tarjetas del catálogo): no espera al índice; si todavía se está armando, va solo el
    /// estado.
    pub async fn list(
        &self,
        http: &Http,
        top: &TopRated,
        imdb_id: &str,
        meta: Option<&Meta>,
        quick: bool,
        timeout: Duration,
    ) -> Result<SeasonRatings> {
        let index = if quick {
            self.index
                .try_lock()
                .ok()
                .and_then(|slot| slot.as_ref().map(|(_, i)| i.clone()))
        } else {
            Some(self.index(http, top).await?)
        };
        let seasons = index
            .zip(tt_number(imdb_id))
            .and_then(|(i, series)| i.get(&series).cloned())
            .unwrap_or_default();
        let status = self.status(http, imdb_id, meta, timeout).await;
        Ok(SeasonRatings { seasons, status })
    }

    /// El índice del día: en memoria, si no el guardado, si no se arma (unos segundos) y se guarda.
    pub async fn index(&self, http: &Http, top: &TopRated) -> Result<Arc<Index>> {
        let mut slot = self.index.lock().await;
        if let Some((_, i)) = slot.as_ref().filter(|(at, _)| at.elapsed() < DATASET_TTL) {
            return Ok(i.clone());
        }
        let saved = self
            .data
            .read(INDEX_KEY)
            .filter(|(_, age)| *age < DATASET_TTL);
        let index = match saved {
            Some((tsv, _)) => tokio::task::spawn_blocking(move || parse_index(&tsv))
                .await
                .unwrap_or_default(),
            None => {
                let ratings = top.ratings(http).await?;
                let gz = imdb_dataset(
                    http,
                    &self.data,
                    EPISODES_URL,
                    EPISODES_MAX,
                    "los episodios",
                )
                .await?;
                let (index, tsv) = tokio::task::spawn_blocking(move || {
                    let index = build_index(flate2::read::GzDecoder::new(&gz[..]), &ratings);
                    let tsv = to_tsv(&index);
                    (index, tsv)
                })
                .await
                .unwrap_or_default();
                self.data.write(INDEX_KEY, tsv.as_bytes());
                index
            }
        };
        tracing::info!(series = index.len(), "índice de temporadas listo");
        let index = Arc::new(index);
        *slot = Some((Instant::now(), index.clone()));
        Ok(index)
    }

    /// Estado: TMDB si hay key (sabe renovaciones y fechas); si no, Cinemeta.
    async fn status(
        &self,
        http: &Http,
        imdb_id: &str,
        meta: Option<&Meta>,
        timeout: Duration,
    ) -> Option<ShowStatus> {
        if let Some(hit) = self.status.lock().expect("status").get(imdb_id) {
            return hit.clone();
        }
        let key = format!("estado-serie-{imdb_id}.json");
        // Con un estreno anunciado ya pasado, lo guardado quedó viejo aunque no haya vencido.
        let still_true = |s: &Option<ShowStatus>| {
            s.as_ref().and_then(|s| s.next.as_ref()).map_or(true, |n| {
                n.date.as_str() > chrono::Utc::now().format("%Y-%m-%d").to_string().as_str()
            })
        };
        let status = match self
            .data
            .get::<Option<ShowStatus>>(&key)
            .filter(|(s, age)| *age < STATUS_TTL && still_true(s))
        {
            Some((saved, _)) => saved,
            None => {
                let tmdb = match crate::secrets::secret(super::tmdb::ACCOUNT) {
                    Some(key) => tmdb_status_of(http, &key, imdb_id, timeout).await,
                    None => None,
                };
                let status = tmdb.or_else(|| meta.and_then(cinemeta_status));
                self.data.put(&key, &status);
                status
            }
        };
        self.status
            .lock()
            .expect("status")
            .insert(imdb_id.to_string(), status.clone());
        status
    }
}

#[derive(Deserialize)]
struct Find {
    #[serde(default)]
    tv_results: Vec<FoundTv>,
}

#[derive(Deserialize)]
struct FoundTv {
    id: u64,
}

#[derive(Deserialize)]
struct TvDetail {
    status: Option<String>,
    next_episode_to_air: Option<TmdbEpisode>,
}

#[derive(Deserialize)]
struct TmdbEpisode {
    season_number: u32,
    episode_number: u32,
    air_date: Option<String>,
}

/// Estado y próximo episodio según TMDB; `None` si no la tiene o falló.
async fn tmdb_status_of(
    http: &Http,
    key: &str,
    imdb_id: &str,
    timeout: Duration,
) -> Option<ShowStatus> {
    let log = |e: FetchError| tracing::debug!(imdb_id, "TMDB estado: {}", e.user_text());
    let find: Find = http
        .get_json(
            &format!("{API}/find/{imdb_id}?external_source=imdb_id&api_key={key}"),
            timeout,
        )
        .await
        .map_err(log)
        .ok()?;
    let id = find.tv_results.first()?.id;
    let tv: TvDetail = http
        .get_json(&format!("{API}/tv/{id}?api_key={key}"), timeout)
        .await
        .map_err(log)
        .ok()?;
    tmdb_status(&tv)
}

fn tmdb_status(tv: &TvDetail) -> Option<ShowStatus> {
    let state = match tv.status.as_deref()? {
        "Returning Series" => ShowState::Returning,
        "In Production" | "Pilot" => ShowState::InProduction,
        "Planned" => ShowState::Planned,
        "Ended" => ShowState::Ended,
        "Canceled" | "Cancelled" => ShowState::Canceled,
        _ => return None,
    };
    let next = tv.next_episode_to_air.as_ref().and_then(|e| {
        Some(NextEpisode {
            season: e.season_number,
            episode: e.episode_number,
            date: e.air_date.clone().filter(|d| !d.is_empty())?,
        })
    });
    Some(ShowStatus { state, next })
}

/// Cinemeta: `Ended` / `Continuing` y el primer episodio con fecha que todavía no salió.
fn cinemeta_status(meta: &Meta) -> Option<ShowStatus> {
    let state = match meta.status.as_deref()? {
        "Ended" => ShowState::Ended,
        "Continuing" => ShowState::Returning,
        _ => return None,
    };
    let next = meta
        .episodes
        .iter()
        .find(|e| e.season > 0 && !e.available && e.released.is_some())
        .map(|e| NextEpisode {
            season: e.season,
            episode: e.episode,
            date: e
                .released
                .as_deref()
                .unwrap_or_default()
                .chars()
                .take(10)
                .collect(),
        });
    Some(ShowStatus { state, next })
}

/// Recorre `title.episode` (`tconst\tparentTconst\tseason\tepisode`) una vez y promedia, por
/// serie y temporada, los episodios con puntaje (sin especiales ni episodios sin temporada).
fn build_index(r: impl Read, ratings: &Ratings) -> Index {
    let mut sums: BTreeMap<(u32, u32), (f32, u32)> = BTreeMap::new();
    for line in BufReader::new(r).lines().map_while(std::result::Result::ok) {
        let mut f = line.split('\t');
        let (Some(ep), Some(series), Some(season)) = (
            f.next().and_then(tt_number),
            f.next().and_then(tt_number),
            f.next().and_then(|s| s.parse::<u32>().ok()), // "\N" = sin temporada
        ) else {
            continue;
        };
        if let (true, Some(&(rating, _))) = (season > 0, ratings.get(&ep)) {
            let e = sums.entry((series, season)).or_default();
            e.0 += rating;
            e.1 += 1;
        }
    }
    let mut index = Index::new();
    for ((series, season), (sum, n)) in sums {
        index.entry(series).or_default().push(SeasonScore {
            season,
            rating: (sum / n as f32 * 10.0).round() / 10.0,
            episodes: n,
        });
    }
    index
}

/// Una línea por temporada: `serie\ttemporada\tpuntaje\tepisodios`, en orden de temporada.
fn to_tsv(index: &Index) -> String {
    let mut out = String::new();
    for (series, seasons) in index {
        for s in seasons {
            out += &format!("{series}\t{}\t{}\t{}\n", s.season, s.rating, s.episodes);
        }
    }
    out
}

fn parse_index(tsv: &[u8]) -> Index {
    let mut index = Index::new();
    for line in tsv.split(|b| *b == b'\n') {
        let mut f = std::str::from_utf8(line).unwrap_or_default().split('\t');
        if let (Some(series), Some(season), Some(rating), Some(episodes)) = (
            f.next().and_then(|v| v.parse::<u32>().ok()),
            f.next().and_then(|v| v.parse().ok()),
            f.next().and_then(|v| v.parse().ok()),
            f.next().and_then(|v| v.parse().ok()),
        ) {
            index.entry(series).or_default().push(SeasonScore {
                season,
                rating,
                episodes,
            });
        }
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estado_de_tmdb() {
        let tv: TvDetail = serde_json::from_str(
            r#"{"status":"Returning Series","next_episode_to_air":{"season_number":3,"episode_number":1,"air_date":"2026-03-12"}}"#,
        )
        .unwrap();
        assert_eq!(
            tmdb_status(&tv),
            Some(ShowStatus {
                state: ShowState::Returning,
                next: Some(NextEpisode {
                    season: 3,
                    episode: 1,
                    date: "2026-03-12".into()
                })
            })
        );
        let tv: TvDetail = serde_json::from_str(r#"{"status":"Canceled"}"#).unwrap();
        assert_eq!(tmdb_status(&tv).unwrap().state, ShowState::Canceled);
    }

    #[test]
    fn indice_por_serie_y_temporada_ida_y_vuelta() {
        let tsv = "tconst\tparentTconst\tseasonNumber\tepisodeNumber\n\
                   tt0000011\ttt33043892\t1\t1\n\
                   tt0000012\ttt33043892\t1\t2\n\
                   tt0000021\ttt33043892\t2\t1\n\
                   tt0000031\ttt33043892\t0\t1\n\
                   tt0000041\ttt33043892\t\\N\t\\N\n\
                   tt0000051\ttt33043892\t3\t1\n\
                   tt0000099\ttt0000002\t1\t1\n";
        let ratings: Ratings = [
            (11, (8.0, 100)),
            (12, (9.0, 100)),
            (21, (6.5, 100)),
            (31, (9.9, 100)),
            (41, (9.9, 100)),
            (99, (5.0, 100)),
        ]
        .into();
        let index = build_index(tsv.as_bytes(), &ratings);
        let expected = [
            SeasonScore {
                season: 1,
                rating: 8.5,
                episodes: 2,
            },
            SeasonScore {
                season: 2,
                rating: 6.5,
                episodes: 1,
            },
        ];
        assert_eq!(
            index[&33043892], expected,
            "sin especiales, sin temporada ni episodios sin puntaje"
        );
        assert_eq!(index[&2].len(), 1, "cada serie con lo suyo");
        assert_eq!(
            parse_index(to_tsv(&index).as_bytes()),
            index,
            "guardado y leído da lo mismo (ids grandes incluidos)"
        );
    }

    // Red real: `cargo test -p streamonte-core --lib seasons::tests::imdb_real -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn imdb_real() {
        let http = Http::new(Duration::from_secs(10));
        let data = Arc::new(DataCache::new(
            std::env::temp_dir().join("streamonte-test-seasons-real"),
        ));
        let ratings = TopRated::new(data.clone()).ratings(&http).await.unwrap();
        let gz = imdb_dataset(&http, &data, EPISODES_URL, EPISODES_MAX, "los episodios")
            .await
            .unwrap();
        let at = Instant::now();
        let index = build_index(flate2::read::GzDecoder::new(&gz[..]), &ratings);
        println!("índice: {} series en {:?}", index.len(), at.elapsed());
        let tsv = to_tsv(&index);
        let at = Instant::now();
        assert_eq!(parse_index(tsv.as_bytes()).len(), index.len());
        println!("{} MB, leído en {:?}", tsv.len() / 1_000_000, at.elapsed());
        let seasons = &index[&903747];
        println!("{seasons:?}");
        assert_eq!(seasons.len(), 5, "Breaking Bad: 5 temporadas");
        assert!(seasons.iter().all(|s| s.rating > 8.0));
        // Dexter: Resurrection, T1 en IMDb ≈ 9,3 (TMDB daba 7,5: por eso se usa IMDb).
        let dexter = &index[&33043892];
        println!("{dexter:?}");
        assert!(dexter[0].season == 1 && dexter[0].rating > 9.0);
    }
}
