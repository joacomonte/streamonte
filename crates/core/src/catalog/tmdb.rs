//! Pósters que Cinemeta no tiene (2026-11-15): muchos títulos nuevos no tienen imagen en metahub
//! (404). Con la API key de TMDB del usuario (gratis) se busca el póster por IMDb id. Sin key, la
//! UI dibuja uno con el título. La key vive en el almacén seguro y nunca va a un log: el pedido
//! se loguea enmascarado (`?****`) y los errores de red no llevan la URL.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;

use super::http::{FetchError, Http};
use crate::Result;

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
    poster_path: Option<String>,
}

/// Póster por IMDb id, recordado por id (también "no hay"; un error de red no se recuerda).
#[derive(Default)]
pub struct Posters {
    /// shortcut: en memoria y sin límite; alcanza para una sesión de búsquedas.
    cache: Mutex<HashMap<String, Option<String>>>,
}

impl Posters {
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
        self.cache
            .lock()
            .expect("posters")
            .insert(imdb_id.to_string(), found.clone());
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

#[cfg(test)]
mod tests {
    use super::*;

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
