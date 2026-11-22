//! Buscar por actor/actriz o director (2026-11-21, como la web): sugerencias de TMDB para el
//! buscador y lo que actuó o dirigió la persona elegida, películas y series, con el puntaje de
//! IMDb como el resto del catálogo (el cruce lo hace `top`). Requiere la key de TMDB.

use std::collections::HashSet;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::http::{FetchError, Http};
use super::top::{bad_key, no_key, Candidate};
use super::MediaKind;
use crate::config::Lang;
use crate::Result;

const API: &str = "https://api.themoviedb.org/3";
const PHOTO_BASE: &str = "https://image.tmdb.org/t/p/w185";
/// Sugerencias que entran en la lista bajo el buscador.
const MAX_PEOPLE: usize = 3;
/// Géneros de TV que no son actuar (talk shows, noticias, realities): ahí aparece como sí mismo.
const NOT_ACTING: [u32; 3] = [10767, 10763, 10764];
/// Series donde actuó menos episodios que esto: invitado o cameo (Friends para Brad Pitt), no se muestran.
const MIN_EPISODES: u32 = 3;
/// Hasta cuántos títulos (los más populares): cada uno sin ficha guardada es un pedido a TMDB.
const MAX_CREDITS: usize = 80;

/// Qué se muestra de la persona: lo que actuó o lo que dirigió.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Cast,
    Director,
}

/// Una sugerencia del buscador: foto, rol y por qué se la conoce (dos títulos).
#[derive(Debug, Clone, Serialize)]
pub struct Person {
    pub id: u64,
    pub name: String,
    pub photo: Option<String>,
    pub known: String,
    pub role: Role,
}

#[derive(Deserialize)]
struct PersonPage {
    #[serde(default)]
    results: Vec<RawPerson>,
}

#[derive(Deserialize)]
struct RawPerson {
    id: u64,
    #[serde(default)]
    name: String,
    profile_path: Option<String>,
    #[serde(default)]
    known_for_department: String,
    #[serde(default)]
    known_for: Vec<KnownFor>,
}

#[derive(Deserialize)]
struct KnownFor {
    title: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Credits {
    #[serde(default)]
    cast: Vec<Credit>,
    #[serde(default)]
    crew: Vec<Credit>,
}

/// Un crédito de `combined_credits`: el título (como los de discover) y lo que hace falta para filtrar.
#[derive(Deserialize)]
struct Credit {
    #[serde(flatten)]
    title: Candidate,
    #[serde(default)]
    media_type: String,
    #[serde(default)]
    original_language: String,
    #[serde(default)]
    genre_ids: Vec<u32>,
    episode_count: Option<u32>,
    #[serde(default)]
    job: String,
}

/// Actores y directores que coinciden con `query` (los demás oficios no). Sin key de TMDB, vacío.
pub async fn search(
    http: &Http,
    query: &str,
    titles: Lang,
    timeout: Duration,
) -> Result<Vec<Person>> {
    let Some(key) = crate::secrets::secret(super::tmdb::ACCOUNT) else {
        return Ok(Vec::new());
    };
    let url = format!(
        "{API}/search/person?query={}&language={}&include_adult=false&api_key={key}",
        super::protocol::encode_extra(query),
        titles.tmdb()
    );
    match http.get_json::<PersonPage>(&url, timeout).await {
        Ok(page) => Ok(people(page.results)),
        Err(FetchError::Status(401)) => Err(bad_key()),
        Err(e) => Err(super::fetch_error("buscar actores en TMDB", &e)),
    }
}

fn people(raw: Vec<RawPerson>) -> Vec<Person> {
    raw.into_iter()
        .filter_map(|r| {
            let role = match r.known_for_department.as_str() {
                "Acting" => Role::Cast,
                "Directing" => Role::Director,
                _ => return None,
            };
            let known: Vec<String> = r
                .known_for
                .into_iter()
                .filter_map(|k| k.title.or(k.name))
                .take(2)
                .collect();
            (!known.is_empty()).then(|| Person {
                id: r.id,
                name: r.name,
                photo: r.profile_path.map(|p| format!("{PHOTO_BASE}{p}")),
                known: known.join(", "),
                role,
            })
        })
        .take(MAX_PEOPLE)
        .collect()
}

/// Lo que actuó o dirigió la persona, de más a menos popular (sin cruzar con IMDb: ver `top`).
pub(super) async fn credits(
    http: &Http,
    id: u64,
    role: Role,
    titles: Lang,
    timeout: Duration,
) -> Result<Vec<(MediaKind, Candidate)>> {
    let key = crate::secrets::secret(super::tmdb::ACCOUNT).ok_or_else(no_key)?;
    let url = format!(
        "{API}/person/{id}/combined_credits?language={}&api_key={key}",
        titles.tmdb()
    );
    match http.get_json::<Credits>(&url, timeout).await {
        Ok(c) => Ok(pick(c, role)),
        Err(FetchError::Status(401)) => Err(bad_key()),
        Err(e) => Err(super::fetch_error(
            "cargar los títulos de la persona en TMDB",
            &e,
        )),
    }
}

/// Películas y series donde actuó (o que dirigió), sin anime/japonés (FR-40), sin programas donde
/// aparece como sí mismo ni series de invitado; sin repetir; las más populares primero.
fn pick(credits: Credits, role: Role) -> Vec<(MediaKind, Candidate)> {
    let list = match role {
        Role::Cast => credits.cast,
        Role::Director => credits
            .crew
            .into_iter()
            .filter(|c| c.job == "Director")
            .collect(),
    };
    let mut seen = HashSet::new();
    let mut out: Vec<(MediaKind, Candidate)> = list
        .into_iter()
        .filter_map(|c| {
            let kind = match c.media_type.as_str() {
                "movie" => MediaKind::Movie,
                "tv" => MediaKind::Series,
                _ => return None,
            };
            let guest = kind == MediaKind::Series
                && role == Role::Cast
                && c.episode_count.unwrap_or(0) < MIN_EPISODES;
            let skip = c.original_language == "ja"
                || c.genre_ids.iter().any(|g| NOT_ACTING.contains(g))
                || guest;
            (!skip && seen.insert((kind, c.title.id))).then_some((kind, c.title))
        })
        .collect();
    let pop = |x: &(MediaKind, Candidate)| x.1.popularity.unwrap_or(0.0);
    out.sort_by(|a, b| pop(b).total_cmp(&pop(a)));
    out.truncate(MAX_CREDITS);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credits(json: &str) -> Credits {
        serde_json::from_str(json).unwrap()
    }

    fn ids(list: &[(MediaKind, Candidate)]) -> Vec<(MediaKind, u64)> {
        list.iter().map(|(k, c)| (*k, c.id)).collect()
    }

    #[test]
    fn actor_sin_cameos_ni_programas_ni_anime_y_por_popularidad() {
        let c = credits(
            r#"{"cast":[
                {"id":1,"media_type":"movie","title":"Fight Club","original_language":"en","popularity":40.0},
                {"id":2,"media_type":"tv","name":"Friends","original_language":"en","episode_count":1,"popularity":90.0},
                {"id":3,"media_type":"tv","name":"Talk show","original_language":"en","episode_count":50,"genre_ids":[10767]},
                {"id":4,"media_type":"movie","title":"Anime","original_language":"ja","popularity":99.0},
                {"id":5,"media_type":"tv","name":"Serie","original_language":"en","episode_count":8,"popularity":60.0},
                {"id":1,"media_type":"movie","title":"Fight Club","original_language":"en","popularity":40.0}
            ],"crew":[{"id":6,"media_type":"movie","title":"Dirigida","job":"Director"}]}"#,
        );
        assert_eq!(
            ids(&pick(c, Role::Cast)),
            [(MediaKind::Series, 5), (MediaKind::Movie, 1)]
        );
    }

    #[test]
    fn director_solo_lo_que_dirigio_series_incluidas() {
        let c = credits(
            r#"{"cast":[{"id":1,"media_type":"movie","title":"Cameo","original_language":"en"}],
               "crew":[
                {"id":2,"media_type":"movie","title":"Producida","job":"Producer","original_language":"en"},
                {"id":3,"media_type":"tv","name":"Miniserie","job":"Director","original_language":"en","episode_count":1},
                {"id":4,"media_type":"movie","title":"Dirigida","job":"Director","original_language":"en","popularity":5.0}
            ]}"#,
        );
        assert_eq!(
            ids(&pick(c, Role::Director)),
            [(MediaKind::Movie, 4), (MediaKind::Series, 3)]
        );
    }

    #[test]
    fn sugerencias_solo_actores_y_directores_conocidos() {
        let page: PersonPage = serde_json::from_str(
            r#"{"results":[
                {"id":1,"name":"Brad Pitt","profile_path":"/b.jpg","known_for_department":"Acting",
                 "known_for":[{"title":"Fight Club"},{"name":"Friends"},{"title":"Troya"}]},
                {"id":2,"name":"Guionista","known_for_department":"Writing","known_for":[{"title":"X"}]},
                {"id":3,"name":"Desconocido","known_for_department":"Acting","known_for":[]},
                {"id":4,"name":"David Fincher","known_for_department":"Directing","known_for":[{"title":"Se7en"}]}
            ]}"#,
        )
        .unwrap();
        let found = people(page.results);
        assert_eq!(found.len(), 2);
        assert_eq!(
            (
                found[0].known.as_str(),
                found[0].role,
                found[0].photo.as_deref()
            ),
            (
                "Fight Club, Friends",
                Role::Cast,
                Some("https://image.tmdb.org/t/p/w185/b.jpg")
            )
        );
        assert_eq!(
            (found[1].name.as_str(), found[1].role),
            ("David Fincher", Role::Director)
        );
    }
}
