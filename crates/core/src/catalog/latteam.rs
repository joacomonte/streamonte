//! Lat-Team (2026-11-18): tracker privado hecho con UNIT3D. Con el API token del usuario (Ajustes,
//! almacén seguro) se consulta `GET /api/torrents/filter?imdbId=…` con `Authorization: Bearer`.
//! Formato (código de UNIT3D, `API/TorrentController::filter` y `TorrentResource`): `{data: [{id,
//! attributes: {name, size, seeders, leechers, magnet_link?, download_link, …}}]}`; `imdbId` va
//! sin el `tt`. Sin token no se consulta nada. NO PROBADO EN VIVO (no hay token).
//!
//! Privacidad: el `magnet_link` y el `download_link` llevan el passkey / rsskey del usuario. Del
//! magnet solo se toma el info hash: los trackers (con el passkey) no pasan al candidato, que se
//! guarda en disco con la lista del video. Un `.torrent` sin magnet no se integra todavía.

use std::time::Duration;

use serde::Deserialize;

use super::addons::AddonOutcome;
use super::http::{FetchError, Http};
use super::normalize::{self, ParseCtx, Parsed, StreamCandidate};
use super::protocol::{Stream, StreamHints};
use super::{MediaKind, VideoId};
use crate::magnet::Magnet;
use crate::Result;

/// Id del servicio en Ajustes (keys de servicios).
pub const LATTEAM: &str = "latteam";
const ACCOUNT: &str = "lat-team-api-token";
/// Sitio del tracker: el token está en el perfil de la cuenta.
pub const KEY_PAGE: &str = "https://lat-team.com/";
const BASE: &str = "https://lat-team.com";
const PER_PAGE: u32 = 100;

/// Guarda el token (o lo borra si viene vacío).
pub fn set_key(key: &str) -> Result<()> {
    crate::secrets::set_secret(ACCOUNT, key)
}

pub fn has_key() -> bool {
    crate::secrets::secret(ACCOUNT).is_some()
}

#[derive(Deserialize)]
struct Response {
    #[serde(default)]
    data: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    attributes: Attributes,
}

#[derive(Deserialize)]
struct Attributes {
    #[serde(default)]
    name: String,
    /// Bytes.
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    seeders: Option<u32>,
    /// Solo si el tracker tiene los magnets activados.
    #[serde(default)]
    magnet_link: Option<String>,
}

/// Qué pasó con los resultados: candidatos, y cuántos vinieron solo como `.torrent`.
struct Parsed2 {
    list: Vec<StreamCandidate>,
    torrent_only: usize,
}

/// Resultados → candidatos. En series solo sirve lo del episodio pedido o los packs de su
/// temporada (el filtro del tracker por temporada trae también otros episodios).
fn candidates(resp: Response, name: &str, rank: usize, video: &VideoId) -> Parsed2 {
    let ctx = ParseCtx {
        addon_name: name,
        addon_rank: rank,
        spain_flag_is_generic: false,
        is_series: video.episode().is_some(),
    };
    let mut out = Parsed2 {
        list: Vec::new(),
        torrent_only: 0,
    };
    for item in resp.data {
        let a = item.attributes;
        if let Some((season, episode)) = video.episode() {
            let rel = crate::release::parse_release_name(&a.name);
            let ok_season = rel.season.map_or(true, |s| u32::from(s) == season);
            let ok_episode = rel.episode.map_or(true, |e| u32::from(e) == episode);
            if !ok_season || !ok_episode {
                continue;
            }
        }
        let Some(magnet) = a.magnet_link.as_deref().and_then(|m| Magnet::parse(m).ok()) else {
            out.torrent_only += 1;
            continue;
        };
        let stream = Stream {
            info_hash: Some(magnet.info_hash.to_hex()),
            title: Some(format!(
                "{}\n👤 {}\n⚙ Lat-Team",
                a.name,
                a.seeders.unwrap_or(0)
            )),
            behavior_hints: a.size.map(|size| StreamHints {
                video_size: Some(size),
                ..StreamHints::default()
            }),
            ..Stream::default()
        };
        if let Parsed::Candidate(c) = normalize::parse(&stream, &ctx) {
            out.list.push(*c);
        }
    }
    out
}

pub async fn streams(
    http: &Http,
    video: &VideoId,
    _kind: MediaKind,
    rank: usize,
    name: &str,
    timeout: Duration,
) -> AddonOutcome {
    let Some(token) = crate::secrets::secret(ACCOUNT) else {
        return AddonOutcome::NeedsConfig;
    };
    let imdb = video.imdb_id().trim_start_matches("tt");
    let mut url = format!(
        "{BASE}/api/torrents/filter?imdbId={imdb}&perPage={PER_PAGE}&sortField=seeders&sortDirection=desc"
    );
    if let Some((season, _)) = video.episode() {
        url.push_str(&format!("&seasonNumber={season}"));
    }
    let resp: Response = match http.get_json_bearer(&url, &token, timeout).await {
        Ok(r) => r,
        Err(FetchError::Status(401)) => {
            return AddonOutcome::Failed("token rechazado (401): revisalo en Ajustes".into())
        }
        Err(e) => return AddonOutcome::Failed(e.user_text()),
    };
    let found = candidates(resp, name, rank, video);
    if found.list.is_empty() && found.torrent_only > 0 {
        return AddonOutcome::Failed(format!(
            "{} resultado(s) solo con .torrent (sin magnet): todavía no se usan",
            found.torrent_only
        ));
    }
    AddonOutcome::Ok(found.list)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Forma documentada de UNIT3D (`TorrentResource`); el magnet lleva passkey y rsskey inventados.
    const RESPONSE: &str = r#"{"data":[
      {"type":"torrent","id":"1","attributes":{"name":"Los Locos Addams 1991 1080p WEB-DL DUAL LAT","size":3124000000,
       "seeders":12,"leechers":1,"imdb_id":104694,
       "download_link":"https://lat-team.com/torrent/download/1.RSSKEY",
       "magnet_link":"magnet:?dn=Los Locos Addams 1991 1080p WEB-DL DUAL LAT&xt=urn:btih:11d28409e84e630afa6f105f5746cc3b168cbe6b&as=https://lat-team.com/torrent/download/1.RSSKEY&tr=https://lat-team.com/announce/PASSKEY&xl=3124000000"}},
      {"type":"torrent","id":"2","attributes":{"name":"Otra 720p","size":1,"seeders":3,
       "download_link":"https://lat-team.com/torrent/download/2.RSSKEY"}}],
      "links":{"next":null},"meta":{"current_page":1}}"#;

    #[test]
    fn resultados_a_candidatos_sin_passkey() {
        let resp: Response = serde_json::from_str(RESPONSE).unwrap();
        let video = VideoId::parse("tt0101670").unwrap();
        let out = candidates(resp, "Lat-Team", 6, &video);
        assert_eq!(out.torrent_only, 1);
        assert_eq!(out.list.len(), 1);
        let c = &out.list[0];
        assert_eq!(
            c.info_hash.to_hex(),
            "11d28409e84e630afa6f105f5746cc3b168cbe6b"
        );
        assert_eq!(c.audio, ["lat", "multi"]);
        assert_eq!(c.resolution.as_deref(), Some("1080p"));
        assert_eq!(c.seeders_declared, Some(12));
        assert_eq!(c.size_bytes, Some(3_124_000_000));
        assert!(c.trackers.is_empty(), "el passkey no pasa al candidato");
    }
}
