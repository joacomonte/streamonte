//! Agregación (spec 09 §7): fan-out a todos los addons a la vez, fusión por info hash,
//! filtros y orden provisorio; actualizaciones agrupadas (≤ 4/s) hacia la UI (FR-42, 44, 47,
//! NFR-19). Los seeders reales salen del scrape de trackers, que arranca apenas llegan candidatos
//! (Q-14, 2026-11-14: "scrapear seeders automáticamente"; medir solo lo que el usuario elige).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::mpsc;

use super::addons::{Addon, AddonOutcome};
use super::http::Http;
use super::normalize::StreamCandidate;
use super::{MediaKind, VideoId};
use crate::magnet::InfoHash;
use crate::trackers::ScrapeResult;

const FLUSH_EVERY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AddonState {
    Pending,
    Ok,
    /// FR-45: el addon pide configuración.
    NeedsConfig,
    /// No ofrece este tipo de video (types/idPrefixes del manifest).
    Unsupported,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct AddonStatus {
    pub id: String,
    pub name: String,
    pub state: AddonState,
    /// Candidatos que aportó (antes de deduplicar).
    pub count: usize,
    pub ms: Option<u64>,
    /// En español: "sin respuesta (timeout)", "error HTTP 503"…
    pub message: Option<String>,
}

/// Lo que recibe la UI (evento `catalog-streams`): la lista completa ya fusionada y ordenada.
#[derive(Debug, Clone, Serialize)]
pub struct StreamsUpdate {
    pub video_id: String,
    pub addons: Vec<AddonStatus>,
    pub candidates: Vec<StreamCandidate>,
    /// Todos los addons respondieron (o vencieron) y terminó el scrape.
    pub done: bool,
}

/// Mapa de dedup + filtros + orden. Puro (sin red): lo prueban T-23 y T-40.
pub struct Merged {
    map: HashMap<InfoHash, StreamCandidate>,
    audio_order: Vec<String>,
    exclude_cam: bool,
}

impl Merged {
    pub fn new(audio_order: Vec<String>, exclude_cam: bool) -> Self {
        Self {
            map: HashMap::new(),
            audio_order,
            exclude_cam,
        }
    }

    /// FR-44: mismo hash (sin importar mayúsculas: ya viene normalizado) = una sola fila.
    pub fn add(&mut self, c: StreamCandidate) {
        if self.exclude_cam && c.source.as_deref() == Some("CAM") {
            return;
        }
        match self.map.get_mut(&c.info_hash) {
            Some(existing) => merge(existing, c),
            None => {
                self.map.insert(c.info_hash, c);
            }
        }
    }

    pub fn set_scrape(&mut self, hash: &InfoHash, s: &ScrapeResult) {
        if let Some(c) = self.map.get_mut(hash) {
            c.seeders = Some(s.seeders);
            c.leechers = Some(s.leechers);
        }
    }

    pub fn hashes(&self) -> Vec<InfoHash> {
        self.map.keys().copied().collect()
    }

    pub fn trackers(&self) -> Vec<String> {
        let mut t: Vec<String> = self.map.values().flat_map(|c| c.trackers.clone()).collect();
        t.sort();
        t.dedup();
        t
    }

    /// Orden provisorio (spec 09 §7.5 paso 1): idioma de audio según el orden configurado →
    /// subtítulos en español (desempate) → resolución → seeders (scrape > declarados) → tamaño.
    pub fn sorted(&self) -> Vec<StreamCandidate> {
        let mut out: Vec<StreamCandidate> = self
            .map
            .values()
            .cloned()
            .map(|mut c| {
                c.lang_group = lang_group(&c.audio, &self.audio_order);
                c
            })
            .collect();
        out.sort_by_key(|c| {
            (
                group_rank(&c.lang_group, &self.audio_order),
                !c.subs.iter().any(|s| s == "es"),
                std::cmp::Reverse(resolution_rank(c.resolution.as_deref())),
                std::cmp::Reverse(c.seeders.or(c.seeders_declared).unwrap_or(0)),
                std::cmp::Reverse(c.size_bytes.unwrap_or(0)),
                c.info_hash.to_hex(),
            )
        });
        out
    }
}

/// FR-44: unión de addons/trackers/sitios/idiomas, máx. seeders, tamaño exacto preferido,
/// `fileIdx` conocido preferido, textos del addon de mayor prioridad.
fn merge(a: &mut StreamCandidate, b: StreamCandidate) {
    let union = |x: &mut Vec<String>, y: Vec<String>| {
        for v in y {
            if !x.contains(&v) {
                x.push(v);
            }
        }
    };
    if b.addon_rank < a.addon_rank {
        a.release_name = b.release_name.clone();
        a.addon_rank = b.addon_rank;
    }
    a.file_idx = a.file_idx.or(b.file_idx);
    a.file_name = a.file_name.take().or(b.file_name);
    if b.size_bytes.is_some() && ((b.size_exact && !a.size_exact) || a.size_bytes.is_none()) {
        a.size_bytes = b.size_bytes;
        a.size_exact = b.size_exact;
    }
    a.seeders_declared = a.seeders_declared.max(b.seeders_declared);
    a.resolution = a.resolution.take().or(b.resolution);
    a.codec = a.codec.take().or(b.codec);
    a.source = a.source.take().or(b.source);
    a.binge_group = a.binge_group.take().or(b.binge_group);
    a.is_pack |= b.is_pack;
    union(&mut a.hdr, b.hdr);
    union(&mut a.audio_format, b.audio_format);
    union(&mut a.audio, b.audio);
    if a.audio.iter().any(|c| c == "lat" || c == "cast") {
        a.audio.retain(|c| c != "es");
    }
    union(&mut a.subs, b.subs);
    union(&mut a.sites, b.sites);
    union(&mut a.addons, b.addons);
    union(&mut a.trackers, b.trackers);
}

/// Grupo de idioma para la UI: el primero del orden que tenga el audio; si no trae idioma,
/// `unknown` (nunca se descarta, FR-47); si solo trae otros, `other`.
pub fn lang_group(audio: &[String], order: &[String]) -> String {
    if audio.is_empty() {
        return "unknown".into();
    }
    order
        .iter()
        .find(|o| audio.contains(o))
        .cloned()
        .unwrap_or_else(|| "other".into())
}

fn group_rank(group: &str, order: &[String]) -> usize {
    match group {
        "unknown" => order.len(),
        "other" => order.len() + 1,
        g => order.iter().position(|o| o == g).unwrap_or(order.len() + 1),
    }
}

fn resolution_rank(r: Option<&str>) -> u8 {
    match r {
        Some("2160p") => 5,
        Some("1440p") => 4,
        Some("1080p") => 3,
        Some("720p") => 2,
        Some("480p") => 1,
        _ => 0,
    }
}

pub struct RunCtx {
    pub http: Http,
    pub addons: Vec<Arc<Addon>>,
    pub video: VideoId,
    pub kind: MediaKind,
    pub audio_order: Vec<String>,
    pub exclude_cam: bool,
    pub default_timeout: Duration,
    /// Trackers de la config (FR-10) para el scrape, además de los que traen los streams.
    pub trackers: Vec<String>,
    pub scrape_timeout: Duration,
    /// Última lista, para que `AppCore` encuentre un candidato al analizar/reproducir.
    pub latest: Arc<Mutex<Vec<StreamCandidate>>>,
}

enum Msg {
    Addon {
        idx: usize,
        outcome: AddonOutcome,
        ms: u64,
    },
    Scrape(HashMap<InfoHash, ScrapeResult>),
}

/// Fan-out progresivo (FR-42): una tarea por addon con su propio plazo; un único agregador dueño
/// del mapa (sin locks compartidos). Cancelar = abortar la tarea que corre esto (las de cada
/// addon se abortan con el `JoinSet`).
pub async fn run(ctx: RunCtx, emit: impl Fn(StreamsUpdate) + Send + Sync) {
    let (tx, mut rx) = mpsc::unbounded_channel::<Msg>();
    let mut tasks = tokio::task::JoinSet::new();
    let mut statuses: Vec<AddonStatus> = ctx
        .addons
        .iter()
        .map(|a| AddonStatus {
            id: a.entry.id.clone(),
            name: a.entry.name.clone(),
            state: AddonState::Pending,
            count: 0,
            ms: None,
            message: None,
        })
        .collect();
    for (idx, addon) in ctx.addons.iter().enumerate() {
        let (addon, http, tx, video) = (
            addon.clone(),
            ctx.http.clone(),
            tx.clone(),
            ctx.video.clone(),
        );
        let (kind, timeout) = (ctx.kind, addon.timeout(ctx.default_timeout));
        tasks.spawn(async move {
            let t0 = Instant::now();
            let outcome = match tokio::time::timeout(
                timeout,
                addon.streams(&http, &video, kind, idx),
            )
            .await
            {
                Ok(o) => o,
                Err(_) => AddonOutcome::Failed("sin respuesta (timeout)".into()),
            };
            let _ = tx.send(Msg::Addon {
                idx,
                outcome,
                ms: t0.elapsed().as_millis() as u64,
            });
        });
    }

    let mut merged = Merged::new(ctx.audio_order.clone(), ctx.exclude_cam);
    let mut pending = ctx.addons.len();
    let mut scraped: HashSet<InfoHash> = HashSet::new();
    let mut scrapes_running = 0usize;
    let mut dirty = true;
    let mut tick = tokio::time::interval(FLUSH_EVERY);
    let flush = |merged: &Merged, statuses: &[AddonStatus], done: bool| {
        let candidates = merged.sorted();
        *ctx.latest.lock().expect("latest") = candidates.clone();
        emit(StreamsUpdate {
            video_id: ctx.video.to_string(),
            addons: statuses.to_vec(),
            candidates,
            done,
        });
    };
    loop {
        tokio::select! {
            Some(msg) = rx.recv() => {
                dirty = true;
                match msg {
                    Msg::Addon { idx, outcome, ms } => {
                        pending -= 1;
                        let st = &mut statuses[idx];
                        st.ms = Some(ms);
                        match outcome {
                            AddonOutcome::Ok(list) => {
                                st.state = AddonState::Ok;
                                st.count = list.len();
                                for c in list {
                                    merged.add(c);
                                }
                            }
                            AddonOutcome::NeedsConfig => {
                                st.state = AddonState::NeedsConfig;
                                st.message = Some("requiere configuración".into());
                            }
                            AddonOutcome::Unsupported => st.state = AddonState::Unsupported,
                            AddonOutcome::Failed(m) => {
                                tracing::info!(addon = %st.name, "addon: {m}");
                                st.state = AddonState::Error;
                                st.message = Some(m);
                            }
                        }
                    }
                    Msg::Scrape(results) => {
                        scrapes_running -= 1;
                        for (h, s) in &results {
                            merged.set_scrape(h, s);
                        }
                    }
                }
            }
            _ = tick.tick() => {
                if dirty {
                    // Scrape de los hashes nuevos, en tandas a medida que llegan (FR-48: los 40 con seeders).
                    let fresh: Vec<InfoHash> = merged.hashes().into_iter().filter(|h| scraped.insert(*h)).collect();
                    if !fresh.is_empty() {
                        scrapes_running += 1;
                        let mut trackers = ctx.trackers.clone();
                        trackers.extend(merged.trackers());
                        trackers.dedup();
                        let (tx, timeout) = (tx.clone(), ctx.scrape_timeout);
                        tokio::spawn(async move {
                            let r = crate::trackers::scrape_batch(&fresh, &trackers, timeout).await;
                            let _ = tx.send(Msg::Scrape(r));
                        });
                    }
                    flush(&merged, &statuses, false);
                    dirty = false;
                } else if pending == 0 && scrapes_running == 0 {
                    break;
                }
            }
        }
    }
    flush(&merged, &statuses, true);
    tasks.abort_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(hash: u8, addon: &str, rank: usize) -> StreamCandidate {
        StreamCandidate {
            info_hash: InfoHash::from_bytes([hash; 20]),
            file_idx: None,
            file_name: None,
            release_name: format!("rel-{addon}"),
            size_bytes: None,
            size_exact: false,
            seeders_declared: None,
            seeders: None,
            leechers: None,
            resolution: None,
            hdr: vec![],
            audio_format: vec![],
            codec: None,
            source: None,
            audio: vec![],
            subs: vec![],
            lang_group: String::new(),
            sites: vec![],
            addons: vec![addon.into()],
            addon_rank: rank,
            trackers: vec![],
            binge_group: None,
            is_pack: false,
        }
    }
    fn order() -> Vec<String> {
        crate::config::CatalogConfig::default().audio_order
    }

    /// T-23 / CA de FR-44.
    #[test]
    fn dedup_fusiona_tres_addons() {
        let mut m = Merged::new(order(), true);
        let mut a = cand(1, "Torrentio", 0);
        a.seeders_declared = Some(53);
        a.size_bytes = Some(4_670_000_000);
        let mut b = cand(1, "TorrentsDB", 3);
        b.seeders_declared = Some(14);
        b.file_idx = Some(2);
        let mut c = cand(1, "Comet", 2);
        c.size_bytes = Some(4_671_234_567);
        c.size_exact = true;
        c.audio = vec!["en".into()];
        m.add(b);
        m.add(a);
        m.add(c);
        let out = m.sorted();
        assert_eq!(out.len(), 1);
        let x = &out[0];
        assert_eq!(x.addons, vec!["TorrentsDB", "Torrentio", "Comet"]);
        assert_eq!(x.seeders_declared, Some(53));
        assert_eq!(x.size_bytes, Some(4_671_234_567));
        assert_eq!(x.file_idx, Some(2));
        assert_eq!(x.release_name, "rel-Torrentio");
        assert_eq!(x.lang_group, "en");
    }

    /// T-40: default Inglés > Latino > (es) > Castellano; sin idioma = "unknown", no se pierde;
    /// otros al final; cambiar el orden reordena sin red.
    #[test]
    fn orden_de_idiomas() {
        let mk = |h, audio: &[&str]| {
            let mut c = cand(h, "x", 0);
            c.audio = audio.iter().map(|s| s.to_string()).collect();
            c
        };
        let all = [
            mk(1, &["cast"]),
            mk(2, &[]),
            mk(3, &["lat"]),
            mk(4, &["it"]),
            mk(5, &["en"]),
            mk(6, &["es"]),
        ];
        let mut m = Merged::new(order(), true);
        for c in all.clone() {
            m.add(c);
        }
        let groups: Vec<String> = m.sorted().into_iter().map(|c| c.lang_group).collect();
        assert_eq!(groups, ["en", "lat", "es", "cast", "unknown", "other"]);

        let mut m = Merged::new(["lat", "en", "cast"].map(String::from).to_vec(), true);
        for c in all {
            m.add(c);
        }
        let first: Vec<String> = m
            .sorted()
            .into_iter()
            .map(|c| c.lang_group)
            .take(3)
            .collect();
        assert_eq!(first, ["lat", "en", "cast"]);
    }

    #[test]
    fn cam_filtrado_y_desempates() {
        let mut m = Merged::new(order(), true);
        let mut cam = cand(1, "x", 0);
        cam.source = Some("CAM".into());
        m.add(cam);
        let mut low = cand(2, "x", 0);
        low.audio = vec!["en".into()];
        low.resolution = Some("720p".into());
        low.seeders_declared = Some(500);
        let mut high = cand(3, "x", 0);
        high.audio = vec!["en".into()];
        high.resolution = Some("2160p".into());
        let mut subs = cand(4, "x", 0);
        subs.audio = vec!["en".into()];
        subs.subs = vec!["es".into()];
        subs.resolution = Some("480p".into());
        for c in [low, high, subs] {
            m.add(c);
        }
        let out: Vec<u8> = m
            .sorted()
            .iter()
            .map(|c| c.info_hash.as_bytes()[0])
            .collect();
        assert_eq!(out, [4, 3, 2]);
    }
}
