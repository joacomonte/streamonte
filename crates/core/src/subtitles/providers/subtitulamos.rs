//! Subtitulamos (2026-11-15): web española de series, sin API (se lee el HTML a mano, como
//! Subdivx). Solo series. Una página de episodio trae todos los idiomas a la vez.
//!
//! `GET /search/query?q={serie}` → `[{show_id, show_name}]` · `GET /shows/{id}` → redirige a
//! la página de un episodio con `#season-choices`, `#episode-choices` y, por idioma
//! (`.language-name`: "English", "Español (España)", "Español (Latinoamérica)"), sus versiones
//! (`.version-container`) con `/subtitles/{id}/download` (SRT en ISO-8859-1/CRLF).
//! La navegación solo ofrece las temporadas que la web tiene (Game of Thrones: 7 y 8): si la
//! pedida no está, no hay subtítulos de acá.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde_json::Value;

use super::cache::{cached, save, to_utf8};
use super::http::{get_bytes, http};
use super::{err, http_err, normalized_title, release_match, SubtitleProvider, SUBTITULAMOS};
use crate::audio::spanish_variant;
use crate::config::SubtitleLanguage;
use crate::subtitles::{Quota, SpanishVariant, SubtitleCandidate, VideoIdentity};
use crate::Result;

pub struct SubtitulamosProvider;

const SUBTITULAMOS_BASE: &str = "https://www.subtitulamos.tv";

/// Id de la serie cuyo nombre es el título buscado (devuelve también parecidas: "The Game").
pub(super) fn parse_subtitulamos_show(json: &Value, title: &str) -> Option<u64> {
    let wanted = normalized_title(title);
    json.as_array()?
        .iter()
        .find(|s| s["show_name"].as_str().map(normalized_title).as_deref() == Some(&wanted))
        .and_then(|s| s["show_id"].as_u64())
}

/// Valor de un atributo dentro de una etiqueta (`href="…"`).
fn attr(tag: &str, name: &str) -> Option<String> {
    let start = tag.find(&format!("{name}=\""))? + name.len() + 2;
    let rest = &tag[start..];
    Some(rest[..rest.find('"')?].to_string())
}

/// Las opciones de `#season-choices` / `#episode-choices`: (número, href, seleccionada).
pub(super) fn parse_choices(html: &str, block: &str) -> Vec<(u32, String, bool)> {
    let Some(start) = html.find(&format!("id=\"{block}\"")) else {
        return Vec::new();
    };
    let section = &html[start..];
    let section = &section[..section.find("</div>").unwrap_or(section.len())];
    section
        .split("<a ")
        .skip(1)
        .filter_map(|a| {
            let (tag, rest) = a.split_once('>')?;
            let number = rest.split('<').next()?.trim().parse().ok()?;
            let href = attr(tag, "href").filter(|h| h.starts_with('/') && !h.starts_with("//"))?;
            let selected = attr(tag, "class")
                .is_some_and(|c| c.split_whitespace().any(|c| c == "selected"));
            Some((number, href, selected))
        })
        .collect()
}

/// Parser puro de la página de un episodio: cada versión descargable de cada idioma.
pub(super) fn parse_subtitulamos(html: &str, video: &VideoIdentity) -> Vec<SubtitleCandidate> {
    let mut out = Vec::new();
    for block in html.split("language-name\"").skip(1) {
        let name = block
            .split_once('>')
            .and_then(|(_, r)| r.split('<').next())
            .unwrap_or_default()
            .trim();
        let (language, variant) = if name.starts_with("English") {
            (SubtitleLanguage::En, SpanishVariant::Unknown)
        } else if name.starts_with("Español") {
            // "Español (Latinoamérica)" → latino; "Español (España)" → España (regla única).
            (SubtitleLanguage::Es, spanish_variant(name))
        } else {
            continue; // català, galego…
        };
        for version in block.split("version-container").skip(1) {
            let release = version
                .split("spaced bold\">")
                .nth(1)
                .and_then(|r| r.split('<').next())
                .unwrap_or_default()
                .trim();
            let Some(i) = version.find("href=\"/subtitles/") else {
                continue;
            };
            let id: String = version[i + 17..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            // En traducción: el botón viene con la clase `unavailable`.
            let button = version[i..]
                .find("download-button")
                .map(|j| &version[i + j..])
                .and_then(|b| b.split('"').next())
                .unwrap_or_default();
            if id.is_empty() || button.contains("unavailable") {
                continue;
            }
            out.push(SubtitleCandidate {
                provider: SUBTITULAMOS,
                provider_id: id.clone(),
                release_name: release.to_string(),
                language,
                match_kind: release_match(video, release),
                downloads: 0,
                variant,
                url: format!("{SUBTITULAMOS_BASE}/subtitles/{id}/download"),
            });
        }
    }
    out
}

async fn get_page(path: &str) -> Result<String> {
    let req = http()
        .get(format!("{SUBTITULAMOS_BASE}{path}"))
        .header(reqwest::header::REFERER, SUBTITULAMOS_BASE);
    let bytes = get_bytes(req)
        .await
        .map_err(|e| http_err(SUBTITULAMOS, e))?;
    Ok(to_utf8(&bytes))
}

/// Navega de la página que se tiene a la opción `number` de `block` (si no es la elegida ya).
async fn go_to(html: String, block: &str, number: u32) -> Result<Option<String>> {
    let choices = parse_choices(&html, block);
    match choices.into_iter().find(|(n, _, _)| *n == number) {
        None => Ok(None),
        Some((_, _, true)) => Ok(Some(html)),
        Some((_, href, false)) => get_page(&href).await.map(Some),
    }
}

#[async_trait]
impl SubtitleProvider for SubtitulamosProvider {
    fn id(&self) -> &'static str {
        SUBTITULAMOS
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(None)
    }
    /// Una página trae todos los idiomas: contesta todo en la búsqueda en español y nada en la
    /// de inglés, para no pedir las mismas páginas dos veces.
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        let (Some(title), Some(season), Some(episode)) = (&video.title, video.season, video.episode)
        else {
            return Ok(Vec::new()); // solo series
        };
        if lang != SubtitleLanguage::Es {
            return Ok(Vec::new());
        }
        let req = http()
            .get(format!("{SUBTITULAMOS_BASE}/search/query"))
            .header(reqwest::header::REFERER, SUBTITULAMOS_BASE)
            .query(&[("q", title)]);
        let bytes = get_bytes(req)
            .await
            .map_err(|e| http_err(SUBTITULAMOS, e))?;
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err(SUBTITULAMOS, format!("respuesta inválida: {e}")))?;
        let Some(show) = parse_subtitulamos_show(&json, title) else {
            return Ok(Vec::new());
        };
        let page = get_page(&format!("/shows/{show}")).await?;
        let Some(page) = go_to(page, "season-choices", season.into()).await? else {
            return Ok(Vec::new());
        };
        let Some(page) = go_to(page, "episode-choices", episode.into()).await? else {
            return Ok(Vec::new());
        };
        Ok(parse_subtitulamos(&page, video))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p);
        }
        let req = http()
            .get(&cand.url)
            .header(reqwest::header::REFERER, SUBTITULAMOS_BASE);
        let bytes = get_bytes(req)
            .await
            .map_err(|e| http_err(SUBTITULAMOS, e))?;
        save(cache_dir, cand, &bytes) // ISO-8859-1 → UTF-8 adentro
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::MatchKind;

    // Recortado de páginas reales (Game of Thrones 7x01, 2026-11-15).
    const PAGE: &str = r#"
      <div id="season-choices" class="choices no-scroll-bar">
        <a href="/episodes/9/game-of-thrones-7x01-dragonstone" class="choice selected">7</a>
        <a href="/episodes/4524/game-of-thrones-8x01-winterfell" class="choice ">8</a>
      </div>
      <div id="episode-choices" class="choices no-scroll-bar">
        <a href="/episodes/9/game-of-thrones-7x01-dragonstone" class="choice selected">1</a>
        <a href="/episodes/60/game-of-thrones-7x02-stormborn" class="choice ">2</a>
      </div>
      <div class="text small bold blue-a language-name"  data-lang-id="1">English</div>
      <div class="language-content">
        <template id="subtitle-properties-1">
          <option value="es-lat" >Español (Latinoamérica)</option>
        </template>
        <div class="version-container ">
          <p class="text mini">versión</p>
          <p class="text tiny spaced bold">AVS/SVA</p>
          <a rel="nofollow" href="/subtitles/12115/download">
            <div class="download-button "><i class="far fa-arrow-alt-circle-down"></i></div>
          </a>
        </div>
      </div>
      <div class="text small bold blue-a language-name"  data-lang-id="6">Español (Latinoamérica)</div>
      <div class="language-content">
        <div class="version-container ">
          <p class="text tiny spaced bold">iNTERNAL WEBRip MOROSE</p>
          <a rel="nofollow" href="/subtitles/12200/download">
            <div class="download-button "></div>
          </a>
        </div>
        <div class="version-container ">
          <p class="text tiny spaced bold">WEB TBS</p>
          <a rel="nofollow" href="/subtitles/12201/download">
            <div class="download-button unavailable"></div>
          </a>
        </div>
      </div>
      <div class="text small bold blue-a language-name"  data-lang-id="5">Español (España)</div>
      <div class="language-content">
        <div class="version-container ">
          <p class="text tiny spaced bold">AVS/SVA</p>
          <a rel="nofollow" href="/subtitles/12116/download">
            <div class="download-button "></div>
          </a>
        </div>
      </div>
      <div class="text small bold blue-a language-name"  data-lang-id="12">Català</div>
      <div class="version-container ">
        <p class="text tiny spaced bold">AVS/SVA</p>
        <a rel="nofollow" href="/subtitles/12117/download"><div class="download-button "></div></a>
      </div>"#;

    #[test]
    fn subtitulamos_serie_por_nombre_exacto() {
        let json: Value = serde_json::from_str(
            r#"[{"show_id":7,"show_name":"Game of Thrones"},{"show_id":956,"show_name":"The Game"}]"#,
        )
        .unwrap();
        assert_eq!(parse_subtitulamos_show(&json, "Game of Thrones"), Some(7));
        assert_eq!(parse_subtitulamos_show(&json, "The Game Show"), None);
    }

    #[test]
    fn subtitulamos_temporadas_y_episodios() {
        let seasons = parse_choices(PAGE, "season-choices");
        assert_eq!(seasons.len(), 2);
        assert_eq!(seasons[0], (7, "/episodes/9/game-of-thrones-7x01-dragonstone".into(), true));
        assert!(!seasons[1].2);
        assert!(
            !seasons.iter().any(|(n, _, _)| *n == 3),
            "temporada vieja: no está"
        );
        let episodes = parse_choices(PAGE, "episode-choices");
        assert_eq!(episodes[1].0, 2);
        assert_eq!(episodes[1].1, "/episodes/60/game-of-thrones-7x02-stormborn");
    }

    #[test]
    fn subtitulamos_parser() {
        let video = VideoIdentity {
            file_name: "Game.of.Thrones.S07E01.720p.WEBRip.x264-MOROSE.mkv".into(),
            title: Some("Game of Thrones".into()),
            season: Some(7),
            episode: Some(1),
            release_group: Some("MOROSE".into()),
            ..Default::default()
        };
        let c = parse_subtitulamos(PAGE, &video);
        let got: Vec<_> = c
            .iter()
            .map(|c| (c.provider_id.as_str(), c.language, c.variant))
            .collect();
        assert_eq!(
            got,
            vec![
                ("12115", SubtitleLanguage::En, SpanishVariant::Unknown),
                ("12200", SubtitleLanguage::Es, SpanishVariant::Latino),
                ("12116", SubtitleLanguage::Es, SpanishVariant::Spain),
            ],
            "sin la versión en traducción ni el catalán"
        );
        assert_eq!(c[1].match_kind, MatchKind::Release, "por el grupo MOROSE");
        assert_eq!(c[1].release_name, "iNTERNAL WEBRip MOROSE");
        assert_eq!(c[0].url, "https://www.subtitulamos.tv/subtitles/12115/download");
    }
}
