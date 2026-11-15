//! Tipos del protocolo de addons de Stremio (spec 10 §A). Esquema tolerante (NFR-24): todo es
//! opcional y lo desconocido se ignora; un campo con un tipo inesperado no rompe la respuesta.

use serde::{Deserialize, Deserializer};

/// `Option<T>` que ante un valor de otro tipo da `None` en vez de error (datos no confiables).
fn lenient<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let v = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(v).ok())
}

/// `bool` que también acepta `"true"`, `1`, `"1"`… (un `adult: "true"` no debe pasar como `false`).
fn truthy<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::Bool(b) => b,
        serde_json::Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        serde_json::Value::String(s) => {
            matches!(s.trim().to_lowercase().as_str(), "true" | "1" | "yes")
        }
        _ => false,
    })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default, deserialize_with = "lenient")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub version: Option<String>,
    /// Strings (`"stream"`) u objetos `{name, types, idPrefixes}`.
    #[serde(default, deserialize_with = "lenient")]
    pub resources: Option<Vec<serde_json::Value>>,
    #[serde(default, deserialize_with = "lenient")]
    pub types: Option<Vec<String>>,
    #[serde(default, deserialize_with = "lenient")]
    pub id_prefixes: Option<Vec<String>>,
    #[serde(default, deserialize_with = "lenient")]
    pub behavior_hints: Option<ManifestHints>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestHints {
    #[serde(default, deserialize_with = "truthy")]
    pub adult: bool,
    #[serde(default, deserialize_with = "truthy")]
    pub configuration_required: bool,
}

impl Manifest {
    /// `(types, idPrefixes)` del recurso `stream`, o `None` si el addon no ofrece streams.
    pub fn stream_resource(&self) -> Option<(Vec<String>, Option<Vec<String>>)> {
        let base_types = self.types.clone().unwrap_or_default();
        self.resources.iter().flatten().find_map(|r| match r {
            serde_json::Value::String(s) if s == "stream" => {
                Some((base_types.clone(), self.id_prefixes.clone()))
            }
            serde_json::Value::Object(o)
                if o.get("name").and_then(|n| n.as_str()) == Some("stream") =>
            {
                let list = |k: &str| {
                    o.get(k)
                        .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok())
                };
                Some((
                    list("types").unwrap_or_else(|| base_types.clone()),
                    list("idPrefixes").or_else(|| self.id_prefixes.clone()),
                ))
            }
            _ => None,
        })
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct StreamsResponse {
    #[serde(default, deserialize_with = "lenient")]
    pub streams: Option<Vec<serde_json::Value>>,
}

/// Un stream crudo (spec 10 §A.4).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    #[serde(default, deserialize_with = "lenient")]
    pub info_hash: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub file_idx: Option<usize>,
    #[serde(default, deserialize_with = "lenient")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub url: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub sources: Option<Vec<String>>,
    #[serde(default, deserialize_with = "lenient")]
    pub behavior_hints: Option<StreamHints>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamHints {
    #[serde(default, deserialize_with = "lenient")]
    pub binge_group: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub filename: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub video_size: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CatalogResponse {
    #[serde(default, deserialize_with = "lenient")]
    pub metas: Option<Vec<serde_json::Value>>,
    #[serde(default, rename = "hasMore", deserialize_with = "lenient")]
    pub has_more: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct MetaResponse {
    #[serde(default, deserialize_with = "lenient")]
    pub meta: Option<RawMeta>,
}

/// Meta / MetaPreview de Cinemeta (spec 10 §A.5, §B).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawMeta {
    #[serde(default, deserialize_with = "lenient")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub release_info: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub year: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub released: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub poster: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub background: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub runtime: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub country: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub genres: Option<Vec<String>>,
    #[serde(default, deserialize_with = "lenient")]
    pub imdb_rating: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub videos: Option<Vec<serde_json::Value>>,
    #[serde(default, deserialize_with = "lenient")]
    pub popularities: Option<Popularities>,
}

/// Puntajes de popularidad que Cinemeta trae en sus catálogos; se usa el de TMDB (`moviedb`).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Popularities {
    #[serde(default, deserialize_with = "lenient")]
    pub moviedb: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawVideo {
    #[serde(default, deserialize_with = "lenient")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub season: Option<u32>,
    #[serde(default, deserialize_with = "lenient")]
    pub episode: Option<u32>,
    #[serde(default, deserialize_with = "lenient")]
    pub released: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub overview: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub thumbnail: Option<String>,
}

/// Valor de un extra en el path (`search=el%20padrino`): todo lo que no es seguro, codificado.
pub fn encode_extra(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_de_torrentio_ofrece_streams() {
        let m: Manifest = serde_json::from_str(
            r#"{"id":"com.stremio.torrentio.addon","name":"Torrentio","version":"0.0.15",
                "resources":["stream"],"types":["movie","series","anime","other"],
                "idPrefixes":["tt","kitsu"]}"#,
        )
        .unwrap();
        let (types, prefixes) = m.stream_resource().unwrap();
        assert!(types.contains(&"movie".to_string()));
        assert_eq!(prefixes.unwrap(), vec!["tt", "kitsu"]);
    }

    #[test]
    fn cinemeta_no_ofrece_streams_y_campos_raros_no_rompen() {
        let m: Manifest = serde_json::from_str(
            r#"{"id":"com.linvo.cinemeta","name":7,"resources":["catalog",{"name":"meta","types":["movie"]}]}"#,
        )
        .unwrap();
        assert!(m.stream_resource().is_none());
        assert_eq!(m.name, None);
    }

    #[test]
    fn resources_null_no_rompe_y_adult_truthy() {
        let m: Manifest = serde_json::from_str(r#"{"id":"x","resources":null}"#).unwrap();
        assert!(m.stream_resource().is_none());
        for adult in [r#""true""#, "1", "true"] {
            let m: Manifest = serde_json::from_str(&format!(
                r#"{{"resources":["stream"],"behaviorHints":{{"adult":{adult},"configurationRequired":"no"}}}}"#
            ))
            .unwrap();
            assert!(m.behavior_hints.unwrap().adult, "adult = {adult}");
        }
    }

    #[test]
    fn extra_codificado() {
        assert_eq!(encode_extra("el padrino"), "el%20padrino");
        assert_eq!(encode_extra("año/x"), "a%C3%B1o%2Fx");
    }
}
