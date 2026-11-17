//! Agregación (spec 09 §7): fan-out a todos los addons a la vez, fusión por info hash,
//! filtros y orden provisorio; actualizaciones agrupadas (≤ 4/s) hacia la UI (FR-42, 44, 47,
//! NFR-19). Los seeders reales salen del scrape de trackers, que arranca apenas llegan candidatos
//! (Q-14, 2026-11-14: "scrapear seeders automáticamente"; medir solo lo que el usuario elige).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::addons::{Addon, AddonOutcome};
use super::http::Http;
use super::normalize::StreamCandidate;
use super::{MediaKind, VideoId};
use crate::magnet::InfoHash;
use crate::trackers::ScrapeResult;

const FLUSH_EVERY: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
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
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
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
    /// El filtro de CAM va en `sorted`: basta que un addon lo marque para que el hash entero caiga.
    pub fn add(&mut self, c: StreamCandidate) {
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
            c.completed = Some(s.completed);
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
            .filter(|c| !(self.exclude_cam && is_cam(c)))
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

fn is_cam(c: &StreamCandidate) -> bool {
    c.source.as_deref() == Some("CAM")
}

/// `b` gana si viene del addon de mayor prioridad (menor `addon_rank`); si no, solo completa.
fn prefer<T>(a: &mut Option<T>, b: Option<T>, b_first: bool) {
    *a = if b_first {
        b.or(a.take())
    } else {
        a.take().or(b)
    };
}

/// FR-44: unión de addons/trackers/sitios/idiomas, máx. seeders, tamaño exacto preferido,
/// `fileIdx` conocido preferido, textos y campos sueltos del addon de mayor prioridad (sin
/// depender de cuál respondió primero); CAM si algún addon lo marca.
fn merge(a: &mut StreamCandidate, b: StreamCandidate) {
    let union = |x: &mut Vec<String>, y: Vec<String>| {
        for v in y {
            if !x.contains(&v) {
                x.push(v);
            }
        }
    };
    let b_first = b.addon_rank < a.addon_rank;
    let cam = is_cam(a) || is_cam(&b);
    if b_first {
        a.release_name = b.release_name.clone();
        a.addon_rank = b.addon_rank;
    }
    prefer(&mut a.file_idx, b.file_idx, b_first);
    prefer(&mut a.file_name, b.file_name, b_first);
    if b.size_bytes.is_some() && ((b.size_exact && !a.size_exact) || a.size_bytes.is_none()) {
        a.size_bytes = b.size_bytes;
        a.size_exact = b.size_exact;
    }
    a.seeders_declared = a.seeders_declared.max(b.seeders_declared);
    prefer(&mut a.resolution, b.resolution, b_first);
    prefer(&mut a.codec, b.codec, b_first);
    prefer(&mut a.source, b.source, b_first);
    if cam {
        a.source = Some("CAM".into());
    }
    prefer(&mut a.binge_group, b.binge_group, b_first);
    a.is_pack |= b.is_pack;
    union(&mut a.hdr, b.hdr);
    union(&mut a.audio_format, b.audio_format);
    union(&mut a.audio, b.audio);
    crate::audio::collapse_spanish(&mut a.audio);
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
    pub latest: Arc<Mutex<Latest>>,
}

/// Candidatos de la última consulta, con el video al que pertenecen.
#[derive(Debug, Default)]
pub struct Latest {
    pub video: Option<VideoId>,
    pub candidates: Vec<StreamCandidate>,
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
/// del mapa (sin locks compartidos). Addons y scrapes viven en un `JoinSet`: cancelar = abortar
/// la tarea que corre esto (el `JoinSet` aborta las suyas al soltarse) y una tarea que entra en
/// pánico cuenta como addon fallido en vez de dejar la consulta colgada.
pub async fn run(ctx: RunCtx, emit: impl Fn(StreamsUpdate) + Send + Sync) {
    let mut tasks = tokio::task::JoinSet::new();
    let mut addon_of: HashMap<tokio::task::Id, usize> = HashMap::new();
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
        let (addon, http, video) = (addon.clone(), ctx.http.clone(), ctx.video.clone());
        let (kind, timeout) = (ctx.kind, addon.timeout(ctx.default_timeout));
        let handle = tasks.spawn(async move {
            let t0 = Instant::now();
            let outcome = addon.streams(&http, &video, kind, idx, timeout).await;
            Msg::Addon {
                idx,
                outcome,
                ms: t0.elapsed().as_millis() as u64,
            }
        });
        addon_of.insert(handle.id(), idx);
    }

    let mut merged = Merged::new(ctx.audio_order.clone(), ctx.exclude_cam);
    let mut scraped: HashSet<InfoHash> = HashSet::new();
    let mut dirty = true;
    let mut tick = tokio::time::interval(FLUSH_EVERY);
    let flush = |merged: &Merged, statuses: &[AddonStatus], done: bool| {
        let candidates = merged.sorted();
        let mut latest = ctx.latest.lock().expect("latest");
        // Una corrida vieja que llega tarde no pisa la lista de otro video (`start_streams`).
        if latest.video.as_ref().is_some_and(|v| v != &ctx.video) {
            return;
        }
        *latest = Latest {
            video: Some(ctx.video.clone()),
            candidates: candidates.clone(),
        };
        drop(latest);
        emit(StreamsUpdate {
            video_id: ctx.video.to_string(),
            addons: statuses.to_vec(),
            candidates,
            done,
        });
    };
    loop {
        tokio::select! {
            Some(joined) = tasks.join_next_with_id() => {
                dirty = true;
                let msg = match joined {
                    Ok((_, msg)) => msg,
                    Err(e) => match addon_of.get(&e.id()) {
                        Some(&idx) => Msg::Addon {
                            idx,
                            outcome: AddonOutcome::Failed("falló internamente".into()),
                            ms: 0,
                        },
                        None => {
                            tracing::warn!("scrape de seeders: {e}");
                            continue;
                        }
                    },
                };
                match msg {
                    Msg::Addon { idx, outcome, ms } => {
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
                        let mut trackers = ctx.trackers.clone();
                        trackers.extend(merged.trackers());
                        trackers.sort();
                        trackers.dedup();
                        let timeout = ctx.scrape_timeout;
                        tasks.spawn(async move {
                            Msg::Scrape(crate::trackers::scrape_batch(&fresh, &trackers, timeout).await)
                        });
                    }
                    flush(&merged, &statuses, false);
                    dirty = false;
                } else if tasks.is_empty() {
                    break;
                }
            }
        }
    }
    flush(&merged, &statuses, true);
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
            completed: None,
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

    /// CAM por hash: otro addon con la misma copia sin marcar no la cuela; los campos sueltos
    /// salen del addon de mayor prioridad sin importar el orden de llegada.
    #[test]
    fn cam_por_hash_y_campos_por_prioridad() {
        for first_cam in [true, false] {
            let mut m = Merged::new(order(), true);
            let mut cam = cand(1, "x", 1);
            cam.source = Some("CAM".into());
            let clean = cand(1, "y", 0);
            let (p, q) = if first_cam {
                (cam, clean)
            } else {
                (clean, cam)
            };
            m.add(p);
            m.add(q);
            assert!(m.sorted().is_empty());
        }
        let mut lo = cand(2, "lo", 3);
        lo.resolution = Some("720p".into());
        lo.file_idx = Some(1);
        let mut hi = cand(2, "hi", 0);
        hi.resolution = Some("1080p".into());
        hi.file_idx = Some(4);
        let mut m = Merged::new(order(), true);
        m.add(lo);
        m.add(hi);
        let x = &m.sorted()[0];
        assert_eq!(x.resolution.as_deref(), Some("1080p"));
        assert_eq!(x.file_idx, Some(4));
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
