//! Puntaje por temporada de una serie (pedido 2026-11-16: ver si la serie decayó). Con la key de
//! TMDB, el promedio por temporada de TMDB (un pedido). Sin key, el de IMDb: el dataset oficial
//! `title.episode` (qué episodios tiene cada serie) cruzado con `title.ratings` (que ya baja
//! `top`), promediando los episodios de cada temporada. Junto va el estado de la serie y el
//! próximo episodio anunciado (TMDB; sin key, lo que dice Cinemeta y su lista de episodios).

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::cinemeta::Meta;
use super::http::{FetchError, Http};
use super::top::{imdb_dataset, tt_number, Ratings, TopRated};
use crate::datacache::DataCache;
use crate::Result;

const EPISODES_URL: &str = "https://datasets.imdbws.com/title.episode.tsv.gz";
/// El .gz pesa ~55 MB; margen por si crece.
const EPISODES_MAX: usize = 150 * 1024 * 1024;
/// Puntajes y estado de una serie guardados: cambian poco.
const SEASONS_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const API: &str = "https://api.themoviedb.org/3";
/// TMDB: un episodio cuenta con al menos estos votos y una temporada con al menos estos en total.
/// Con menos, un 10 de dos personas tapa todo (pasó con una temporada en emisión).
const MIN_EPISODE_VOTES: u32 = 3;
const MIN_SEASON_VOTES: u32 = 25;

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
    /// `"IMDb"` o `"TMDB"`: de dónde salen los puntajes.
    pub source: String,
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

pub struct Seasons {
    data: Arc<DataCache>,
    /// Resultado por IMDb id en esta sesión (en disco dura `SEASONS_TTL`).
    cache: Mutex<HashMap<String, SeasonRatings>>,
}

impl Seasons {
    pub fn new(data: Arc<DataCache>) -> Self {
        Self {
            data,
            cache: Mutex::default(),
        }
    }

    pub async fn list(
        &self,
        http: &Http,
        top: &TopRated,
        imdb_id: &str,
        meta: Option<&Meta>,
        quick: bool,
        timeout: Duration,
    ) -> Result<SeasonRatings> {
        if let Some(hit) = self.cache.lock().expect("seasons").get(imdb_id) {
            return Ok(hit.clone());
        }
        // v2 (2026-11-16): TMDB pasó a ponderar por votos; lo guardado antes se descarta.
        let key = format!("temporadas-v2-{imdb_id}.json");
        // Con un estreno anunciado ya pasado, lo guardado quedó viejo aunque no haya vencido.
        let still_true = |r: &SeasonRatings| {
            r.status
                .as_ref()
                .and_then(|s| s.next.as_ref())
                .map_or(true, |n| {
                    n.date.as_str() > chrono::Utc::now().format("%Y-%m-%d").to_string().as_str()
                })
        };
        if let Some((saved, _)) = self
            .data
            .get::<SeasonRatings>(&key)
            .filter(|(r, age)| *age < SEASONS_TTL && still_true(r))
        {
            self.cache
                .lock()
                .expect("seasons")
                .insert(imdb_id.to_string(), saved.clone());
            return Ok(saved);
        }
        let tmdb = match crate::secrets::secret(super::tmdb::ACCOUNT) {
            Some(key) => from_tmdb(http, &key, imdb_id, timeout).await,
            None => None,
        };
        // Sin TMDB (o sin su estado), el de Cinemeta y su primer episodio por estrenar.
        let fallback_status = || meta.and_then(cinemeta_status);
        let out = match tmdb {
            Some((seasons, status)) => SeasonRatings {
                source: "TMDB".into(),
                seasons,
                status: status.or_else(fallback_status),
            },
            // `quick` (tarjetas del catálogo): sin TMDB no se calcula con IMDb (leer sus episodios
            // tarda segundos); va solo el estado y no se guarda, así el panel lo calcula completo.
            None if quick => {
                return Ok(SeasonRatings {
                    source: "IMDb".into(),
                    seasons: Vec::new(),
                    status: fallback_status(),
                })
            }
            None => {
                let Some(series) = tt_number(imdb_id) else {
                    return Ok(SeasonRatings {
                        source: "IMDb".into(),
                        seasons: Vec::new(),
                        status: fallback_status(),
                    });
                };
                let ratings = top.ratings(http).await?;
                let gz = imdb_dataset(
                    http,
                    &self.data,
                    EPISODES_URL,
                    EPISODES_MAX,
                    "los episodios",
                )
                .await?;
                let seasons = tokio::task::spawn_blocking(move || {
                    let eps = episodes_of(flate2::read::GzDecoder::new(&gz[..]), series);
                    average(&eps, &ratings)
                })
                .await
                .unwrap_or_default();
                SeasonRatings {
                    source: "IMDb".into(),
                    seasons,
                    status: fallback_status(),
                }
            }
        };
        self.data.put(&key, &out);
        self.cache
            .lock()
            .expect("seasons")
            .insert(imdb_id.to_string(), out.clone());
        Ok(out)
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
    #[serde(default)]
    seasons: Vec<TmdbSeason>,
    status: Option<String>,
    next_episode_to_air: Option<TmdbEpisode>,
}

#[derive(Deserialize)]
struct TmdbEpisode {
    season_number: u32,
    episode_number: u32,
    air_date: Option<String>,
}

#[derive(Deserialize)]
struct TmdbSeason {
    season_number: u32,
}

/// Puntajes y estado. `None` si TMDB no la tiene, falló o no tiene puntajes: entonces se usa IMDb.
async fn from_tmdb(
    http: &Http,
    key: &str,
    imdb_id: &str,
    timeout: Duration,
) -> Option<(Vec<SeasonScore>, Option<ShowStatus>)> {
    let log = |e: FetchError| tracing::debug!(imdb_id, "TMDB temporadas: {}", e.user_text());
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
    let status = tmdb_status(&tv);
    // El promedio por temporada de TMDB no dice cuántos votos tiene: se pide cada temporada y se
    // pondera por los votos de cada episodio (temporada 0 = especiales, afuera).
    let mut tasks = tokio::task::JoinSet::new();
    for n in tv
        .seasons
        .iter()
        .map(|s| s.season_number)
        .filter(|n| *n > 0)
    {
        let (http, url) = (
            http.clone(),
            format!("{API}/tv/{id}/season/{n}?api_key={key}"),
        );
        tasks.spawn(async move { (n, http.get_json::<TmdbSeasonDetail>(&url, timeout).await) });
    }
    let mut seasons = Vec::new();
    while let Some(done) = tasks.join_next().await {
        let Ok((season, res)) = done else { continue };
        match res {
            Ok(detail) => {
                seasons.extend(
                    weighted(&detail.episodes).map(|(rating, episodes)| SeasonScore {
                        season,
                        rating,
                        episodes,
                    }),
                )
            }
            Err(e) => log(e),
        }
    }
    seasons.sort_by_key(|s| s.season);
    (!seasons.is_empty()).then_some((seasons, status))
}

#[derive(Deserialize)]
struct TmdbSeasonDetail {
    #[serde(default)]
    episodes: Vec<TmdbEpisodeVotes>,
}

#[derive(Deserialize)]
struct TmdbEpisodeVotes {
    #[serde(default)]
    vote_average: f32,
    #[serde(default)]
    vote_count: u32,
}

/// Promedio de la temporada ponderado por votos, con los episodios que tienen suficientes; `None`
/// si en total no alcanzan. Devuelve (puntaje con un decimal, episodios contados).
fn weighted(episodes: &[TmdbEpisodeVotes]) -> Option<(f32, u32)> {
    let counted: Vec<_> = episodes
        .iter()
        .filter(|e| e.vote_count >= MIN_EPISODE_VOTES)
        .collect();
    let votes: u32 = counted.iter().map(|e| e.vote_count).sum();
    if votes < MIN_SEASON_VOTES {
        return None;
    }
    let sum: f32 = counted
        .iter()
        .map(|e| e.vote_average * e.vote_count as f32)
        .sum();
    Some((
        (sum / votes as f32 * 10.0).round() / 10.0,
        counted.len() as u32,
    ))
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

/// Episodios (`tt` del episodio, temporada) de una serie: `tconst\tparentTconst\tseason\tepisode`.
fn episodes_of(r: impl Read, series: u32) -> Vec<(u32, u32)> {
    BufReader::new(r)
        .lines()
        .map_while(std::result::Result::ok)
        .filter_map(|line| {
            let mut f = line.split('\t');
            let ep = tt_number(f.next()?)?;
            (tt_number(f.next()?)? == series).then_some(())?;
            let season: u32 = f.next()?.parse().ok()?; // "\N" = sin temporada
            Some((ep, season))
        })
        .collect()
}

/// Promedio por temporada de los episodios con puntaje (sin especiales).
fn average(episodes: &[(u32, u32)], ratings: &Ratings) -> Vec<SeasonScore> {
    let mut by_season: BTreeMap<u32, (f32, u32)> = BTreeMap::new();
    for (ep, season) in episodes {
        if let (true, Some(&(rating, _))) = (*season > 0, ratings.get(ep)) {
            let e = by_season.entry(*season).or_default();
            e.0 += rating;
            e.1 += 1;
        }
    }
    by_season
        .into_iter()
        .map(|(season, (sum, n))| SeasonScore {
            season,
            rating: (sum / n as f32 * 10.0).round() / 10.0,
            episodes: n,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promedio_de_tmdb_ponderado_y_sin_temporadas_con_pocos_votos() {
        let ep = |vote_average, vote_count| TmdbEpisodeVotes {
            vote_average,
            vote_count,
        };
        // 2 votos de 10 no cuentan; el resto pondera por votos: (8×30 + 9×10) / 40 = 8,25 → 8,3.
        assert_eq!(
            weighted(&[ep(8.0, 30), ep(9.0, 10), ep(10.0, 2)]),
            Some((8.3, 2))
        );
        // Temporada en emisión con pocos votos: afuera.
        assert_eq!(weighted(&[ep(10.0, 4), ep(10.0, 6)]), None);
    }

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
    fn episodios_de_la_serie_y_promedio_por_temporada() {
        let tsv = "tconst\tparentTconst\tseasonNumber\tepisodeNumber\n\
                   tt0000011\ttt0000001\t1\t1\n\
                   tt0000012\ttt0000001\t1\t2\n\
                   tt0000021\ttt0000001\t2\t1\n\
                   tt0000031\ttt0000001\t0\t1\n\
                   tt0000041\ttt0000001\t\\N\t\\N\n\
                   tt0000099\ttt0000002\t1\t1\n";
        let eps = episodes_of(tsv.as_bytes(), 1);
        assert_eq!(eps.len(), 4, "otra serie y sin temporada quedan afuera");
        let ratings: Ratings = [
            (11, (8.0, 100)),
            (12, (9.0, 100)),
            (21, (6.5, 100)),
            (31, (9.9, 100)),
        ]
        .into();
        assert_eq!(
            average(&eps, &ratings),
            [
                SeasonScore {
                    season: 1,
                    rating: 8.5,
                    episodes: 2
                },
                SeasonScore {
                    season: 2,
                    rating: 6.5,
                    episodes: 1
                },
            ],
            "sin especiales (temporada 0)"
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
        let eps = episodes_of(flate2::read::GzDecoder::new(&gz[..]), 903747);
        let seasons = average(&eps, &ratings);
        println!("{seasons:?}");
        assert_eq!(seasons.len(), 5, "Breaking Bad: 5 temporadas");
        assert!(seasons.iter().all(|s| s.rating > 8.0));
    }
}
