//! `config` — configuración centralizada y tipada, con defaults documentados (NFR-04).
//! Se guarda en `config.json` (carpeta de datos). Campos faltantes toman el default
//! (`#[serde(default)]`), así un config viejo nunca rompe la app.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths::AppPaths;
use crate::Result;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Config {
    /// Se agregan a TODO magnet y como announce (FR-10, ADR-08, lección 4).
    pub trackers: Vec<String>,
    pub engine: EngineConfig,
    pub preload: PreloadConfig,
    pub analyzer: AnalyzerConfig,
    pub ranking: RankingConfig,
    pub player: PlayerConfig,
    pub subtitles: SubtitlesConfig,
    pub clipboard: ClipboardConfig,
    pub logging: LoggingConfig,
    /// Catálogo y addons de Stremio (F4b, spec 09 §9).
    pub catalog: CatalogConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            // Lista probada en v1 (tstream-core.ps1).
            trackers: [
                "udp://tracker.opentrackr.org:1337/announce",
                "udp://open.stealth.si:80/announce",
                "udp://tracker.torrent.eu.org:451/announce",
                "udp://exodus.desync.com:6969/announce",
                "udp://open.demonii.com:1337/announce",
                "udp://tracker.dler.org:6969/announce",
                "udp://explodie.org:6969/announce",
                "wss://tracker.webtorrent.dev",
                "wss://tracker.openwebtorrent.com",
            ]
            .map(String::from)
            .to_vec(),
            engine: EngineConfig::default(),
            preload: PreloadConfig::default(),
            analyzer: AnalyzerConfig::default(),
            ranking: RankingConfig::default(),
            player: PlayerConfig::default(),
            subtitles: SubtitlesConfig::default(),
            clipboard: ClipboardConfig::default(),
            logging: LoggingConfig::default(),
            catalog: CatalogConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum EngineKind {
    /// Sidecar Node con almacenamiento pieza-por-archivo (probado en v1). Queda como alternativa:
    /// es el único que usa web seeds (BEP 19), p. ej. torrents de Internet Archive.
    Webtorrent,
    /// librqbit embebido (ADR-15). Motor por defecto desde el benchmark de F1 (ADR-04, 2026-11-13).
    #[default]
    Rqbit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct EngineConfig {
    /// Se fija tras el benchmark de F1 (ADR-04).
    pub kind: EngineKind,
    /// Lección 5: 100 conexiones aceleran el arranque.
    pub max_connections: u32,
    /// NFR-08: metadatos < 10 s; el timeout es más largo para no cortar swarms lentos.
    pub metadata_timeout_secs: u64,
    /// Node.js para el sidecar webtorrent. `None` = buscar en PATH (NFR-03).
    pub node_path: Option<PathBuf>,
    /// `main.mjs` del sidecar. `None` = junto al ejecutable (o el del repo en builds de desarrollo).
    pub webtorrent_sidecar: Option<PathBuf>,
    /// Conexiones entrantes de peers (rqbit). Solo el motor de una reproducción escucha; los
    /// del analizador no (ADR-30). Apagarlo sirve para comparar antes/después.
    pub incoming: bool,
    /// Puertos TCP a probar en orden `[primero, último]`; si están todos ocupados, uno al azar.
    pub listen_ports: [u16; 2],
    /// Pedir al router el reenvío del puerto por UPnP (sin NAT-PMP/PCP).
    pub upnp: bool,
    /// uTP (UDP) además de TCP. librqbit todavía lo marca inestable: apagado por defecto.
    pub utp: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            kind: EngineKind::default(),
            max_connections: 100,
            metadata_timeout_secs: 60,
            node_path: None,
            webtorrent_sidecar: None,
            incoming: true,
            // Fuera del rango efímero de Windows (49152+) y de 6881-6889, que algunos ISP limitan.
            listen_ports: [41850, 41859],
            upnp: true,
            utp: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct PreloadConfig {
    /// Principio del video (lección 2).
    pub head_bytes: u64,
    /// Final del video, solo MP4/MOV: el índice `moov` suele estar en los últimos ~20 MB.
    pub tail_bytes: u64,
    /// Plan B: abrir el reproductor igual a los N s (FR-11, lección 5).
    pub fallback_open_secs: u64,
}

impl Default for PreloadConfig {
    fn default() -> Self {
        Self {
            head_bytes: 16 * MIB,
            tail_bytes: 40 * MIB,
            fallback_open_secs: 45,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AnalyzerConfig {
    /// Ventana de medición de velocidad real (FR-06).
    pub measure_secs: u64,
    /// Mediciones en paralelo. 1 = resultados comparables entre sí.
    pub concurrency: usize,
    /// Reintentos automáticos si el medidor falla (FR-08, NFR-12).
    pub retries: u32,
    pub scrape_timeout_secs: u64,
    /// Al pegar magnets: buscar el nombre real y analizarlos solos (pedido del usuario, 2026-11-13).
    /// Ojo (R-11): analizar expone la IP a cada swarm aunque no se reproduzca.
    pub auto_on_paste: bool,
    /// Máximo de la medición de velocidad (s): se mide hasta que se estabiliza o hasta acá,
    /// o hasta que el usuario toca "Listo". `measure_secs` es el mínimo (2026-11-13).
    pub speed_max_secs: u64,
    /// Fase rápida (nombre, duración, seeds/peers): cuántos torrents a la vez.
    pub quick_concurrency: usize,
    /// Fase rápida: segundos conectado para contar seeds y peers.
    pub quick_secs: u64,
}

impl Default for AnalyzerConfig {
    fn default() -> Self {
        Self {
            measure_secs: 15,
            concurrency: 1,
            retries: 2,
            scrape_timeout_secs: 8,
            auto_on_paste: true,
            speed_max_secs: 90,
            quick_concurrency: 3,
            quick_secs: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct RankingConfig {
    /// Duración estimada si no hay real (se muestra con "~") (FR-07).
    pub movie_minutes: u32,
    pub episode_minutes: u32,
    /// Margen ≥ verde → verde; ≥ amarillo → amarillo; si no, rojo.
    pub green_margin: f64,
    pub yellow_margin: f64,
    // El factor de calibración (real ÷ análisis) NO es config del usuario: es dato derivado de
    // `calibration.json` (`playback::Calibration`). Un `config.json` viejo con `speed_factor` /
    // `speed_factor_samples` igual carga (serde ignora campos desconocidos) y siembra la calibración.
}

impl Default for RankingConfig {
    fn default() -> Self {
        Self {
            movie_minutes: 120,
            episode_minutes: 45,
            green_margin: 1.5,
            yellow_margin: 1.0,
        }
    }
}

impl RankingConfig {
    /// Valores imposibles (editado a mano, versión vieja) → su default, con aviso: un 0 o un
    /// NaN acá rompería el cálculo del margen de todo el semáforo (FR-07).
    fn fix_invalid(&mut self) {
        let d = Self::default();
        if self.movie_minutes == 0 {
            tracing::warn!("config: ranking.movie_minutes = 0; se usa {}", d.movie_minutes);
            self.movie_minutes = d.movie_minutes;
        }
        if self.episode_minutes == 0 {
            tracing::warn!("config: ranking.episode_minutes = 0; se usa {}", d.episode_minutes);
            self.episode_minutes = d.episode_minutes;
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PlayerKind {
    #[default]
    Mpv,
    Vlc,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct PlayerConfig {
    /// mpv por defecto (FR-09, ADR-05).
    pub default_player: PlayerKind,
    /// `None` = detectar automáticamente (NFR-03).
    pub mpv_path: Option<PathBuf>,
    pub vlc_path: Option<PathBuf>,
    /// Perfil de la app con caché para streaming + gpu-next (FR-34).
    pub use_app_profile: bool,
    /// uosc + thumbfast (FR-35).
    pub modern_ui: bool,
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            default_player: PlayerKind::Mpv,
            mpv_path: None,
            vlc_path: None,
            use_app_profile: true,
            modern_ui: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SubtitleLanguage {
    #[default]
    Es,
    En,
    None,
}

impl SubtitleLanguage {
    /// ISO 639-1 ("es", "en"); `None` si no se quieren subtítulos.
    pub fn iso1(self) -> Option<&'static str> {
        match self {
            SubtitleLanguage::Es => Some("es"),
            SubtitleLanguage::En => Some("en"),
            SubtitleLanguage::None => None,
        }
    }

    /// ISO 639-2 ("spa", "eng"), el que entiende mpv; `None` si no se quieren subtítulos.
    pub fn iso2(self) -> Option<&'static str> {
        match self {
            SubtitleLanguage::Es => Some("spa"),
            SubtitleLanguage::En => Some("eng"),
            SubtitleLanguage::None => None,
        }
    }

    /// Nombre en español para los mensajes ("español", "inglés").
    pub fn name_es(self) -> &'static str {
        match self {
            SubtitleLanguage::Es => "español",
            SubtitleLanguage::En => "inglés",
            SubtitleLanguage::None => "ninguno",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct SubtitlesConfig {
    /// FR-21.
    pub language: SubtitleLanguage,
    /// Proveedores activos (F6, ver Q-01..Q-04). Las API keys NO van acá: van al
    /// almacén seguro del sistema (NFR-16).
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ClipboardConfig {
    /// "Leer portapapeles" al abrir (FR-02).
    pub read_history_on_start: bool,
}

impl Default for ClipboardConfig {
    fn default() -> Self {
        Self {
            read_history_on_start: true,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LogLevel {
    Error,
    Warn,
    #[default]
    Info,
    Debug,
    Trace,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct LoggingConfig {
    pub level: LogLevel,
    /// Q-06 (resuelta): logs de diagnóstico (precarga por pieza, mpv) OPCIONALES,
    /// se activan desde Ajustes para depurar. Default: apagados.
    pub diagnostics: bool,
}

pub const MIB: u64 = 1024 * 1024;

/// Lectura/escritura de `config.json`. Escritura atómica (archivo temporal + rename).
pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(paths: &AppPaths) -> Self {
        Self {
            path: paths.config_file(),
        }
    }

    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    /// Si no existe, devuelve `Config::default()`. Si está corrupto, lo aparta
    /// (`config.json.corrupt-<fecha>`), avisa en el log y usa los defaults: la app siempre abre (NFR-12).
    pub fn load(&self) -> Result<Config> {
        match crate::fsutil::read_json::<Config>(&self.path) {
            Ok(Some(mut config)) => {
                config.ranking.fix_invalid();
                Ok(config)
            }
            Ok(None) => Ok(Config::default()),
            Err(crate::CoreError::Json { .. }) => {
                let moved = crate::fsutil::quarantine(&self.path)?;
                tracing::warn!(?moved, "config.json inválido; se usan valores por defecto");
                Ok(Config::default())
            }
            Err(e) => Err(e),
        }
    }

    pub fn save(&self, config: &Config) -> Result<()> {
        crate::fsutil::write_json_atomic(&self.path, config)
    }
}

/// Catálogo (spec 09 §9). Solo lo que usa la Entrega 1; el resto de la tabla llega con su FR.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CatalogConfig {
    /// Addons de streams en orden de prioridad (FR-41). El orden decide qué texto se muestra
    /// cuando el mismo torrent llega de varios (FR-44).
    pub addons: Vec<AddonEntry>,
    /// Orden de idioma de AUDIO (FR-47). Códigos de `audio`: `en`, `lat`, `es` (sin variante),
    /// `cast`, `multi`. Default decidido por el usuario el 2026-11-14 (Q-24): inglés primero.
    pub audio_order: Vec<String>,
    /// Descartar CAM/TS/TC/screener (FR-47).
    pub exclude_cam: bool,
    /// Ocultar anime / contenido japonés (FR-40, Q-12). La UI lo muestra como filtro discreto.
    pub exclude_japanese: bool,
    /// Plazo total por pedido a un addon o a Cinemeta (NFR-19). Cada addon puede tener el suyo.
    pub timeout_ms: u64,
    pub connect_timeout_ms: u64,
}

impl Default for CatalogConfig {
    fn default() -> Self {
        Self {
            addons: default_addons(),
            audio_order: ["en", "lat", "es", "cast", "multi"]
                .map(String::from)
                .to_vec(),
            exclude_cam: true,
            exclude_japanese: true,
            timeout_ms: 10_000,
            connect_timeout_ms: 4_000,
        }
    }
}

/// Un addon configurado. Las URLs con configuración propia (pueden llevar claves) NO se guardan
/// acá: van al almacén seguro del SO con `secret = true` (NFR-22); acá queda la versión enmascarada.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AddonEntry {
    /// `manifest.id` (los de fábrica, un id corto propio).
    pub id: String,
    pub name: String,
    /// URL del manifest si es pública; `None` si está en el almacén seguro.
    #[serde(default)]
    pub url: Option<String>,
    /// URL para mostrar (enmascarada si es secreta).
    pub display_url: String,
    #[serde(default)]
    pub secret: bool,
    pub enabled: bool,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// Lista por defecto (spec 09 §9, Q-11): todos los que funcionaron en P2P sin debrid.
pub fn default_addons() -> Vec<AddonEntry> {
    let public = |id: &str, name: &str, url: &str, timeout_ms: Option<u64>| AddonEntry {
        id: id.into(),
        name: name.into(),
        url: Some(url.into()),
        display_url: url.into(),
        secret: false,
        enabled: true,
        timeout_ms,
    };
    vec![
        public(
            "torrentio",
            "Torrentio",
            "https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,uindex,knaben,ext,mejortorrent,wolfmax4k,cinecalidad|language=latino,spanish|sort=qualityseeders/manifest.json",
            None,
        ),
        public("peerflix", "Peerflix", "https://addon.peerflix.mov/manifest.json", None),
        public("comet", "Comet", "https://comet.feels.legal/manifest.json", None),
        public("torrentsdb", "TorrentsDB", "https://torrentsdb.com/manifest.json", None),
        public("cometa", "Cometa", "https://cometa.stremaddon.net/manifest.json", Some(8_000)),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> (ConfigStore, PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("tstream-test-config-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        (ConfigStore::at(dir.join("config.json")), dir)
    }

    #[test]
    fn sin_archivo_devuelve_defaults() {
        let (store, dir) = temp_store("missing");
        assert_eq!(store.load().unwrap(), Config::default());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn guardar_y_cargar_ida_y_vuelta() {
        let (store, dir) = temp_store("roundtrip");
        let mut c = Config::default();
        c.logging.diagnostics = true;
        c.player.default_player = PlayerKind::Vlc;
        c.trackers.push("udp://ejemplo:1/announce".into());
        store.save(&c).unwrap();
        assert_eq!(store.load().unwrap(), c);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn campos_faltantes_toman_default() {
        let (store, dir) = temp_store("partial");
        std::fs::write(
            dir.join("config.json"),
            r#"{ "preload": { "tail_bytes": 1 } }"#,
        )
        .unwrap();
        let c = store.load().unwrap();
        assert_eq!(c.preload.tail_bytes, 1);
        assert_eq!(c.preload.head_bytes, 16 * MIB);
        assert_eq!(c.trackers, Config::default().trackers);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ranking_invalido_vuelve_al_default() {
        let (store, dir) = temp_store("ranking");
        std::fs::write(
            dir.join("config.json"),
            r#"{ "ranking": { "movie_minutes": 0, "episode_minutes": 30, "speed_factor": -2.0 } }"#,
        )
        .unwrap();
        let r = store.load().unwrap().ranking;
        let d = RankingConfig::default();
        assert_eq!((r.movie_minutes, r.episode_minutes), (d.movie_minutes, 30));
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// `config.json` de antes de mover la calibración a `calibration.json`: sigue cargando igual.
    #[test]
    fn config_viejo_con_speed_factor_carga() {
        let (store, dir) = temp_store("legacy-factor");
        std::fs::write(
            dir.join("config.json"),
            r#"{ "ranking": { "green_margin": 2.0, "speed_factor": 1.7, "speed_factor_samples": 4 } }"#,
        )
        .unwrap();
        let c = store.load().unwrap();
        assert_eq!(c.ranking.green_margin, 2.0);
        assert_eq!(c.trackers, Config::default().trackers);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn json_corrupto_se_aparta_y_usa_defaults() {
        let (store, dir) = temp_store("corrupt");
        std::fs::write(dir.join("config.json"), "{ esto no es json").unwrap();
        assert_eq!(store.load().unwrap(), Config::default());
        assert!(!dir.join("config.json").exists());
        let apartados = std::fs::read_dir(&dir).unwrap().filter(|e| {
            e.as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("config.json.corrupt-")
        });
        assert_eq!(apartados.count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn defaults_documentados() {
        let c = Config::default();
        assert_eq!(c.trackers.len(), 9);
        assert_eq!(c.player.default_player, PlayerKind::Mpv);
        assert!(c.player.use_app_profile);
        assert!(
            !c.logging.diagnostics,
            "Q-06: diagnóstico apagado por defecto"
        );
        assert_eq!(c.engine.max_connections, 100);
        assert_eq!(c.preload.fallback_open_secs, 45);
        assert_eq!(
            (c.ranking.green_margin, c.ranking.yellow_margin),
            (1.5, 1.0)
        );
    }
}
