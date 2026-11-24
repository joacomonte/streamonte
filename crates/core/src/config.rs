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
    /// Se agregan a TODO magnet y como announce (FR-10, ADR-08, lección 4). Usar
    /// [`Config::all_trackers`], que suma la lista compartida.
    pub trackers: Vec<String>,
    /// Lista mantenida públicamente (`trackers::shared_list`), al día una vez por día. No se guarda.
    #[serde(skip)]
    pub shared_trackers: Vec<String>,
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
    /// Idiomas elegidos por el usuario (2026-11-20, como la web): textos de la app y títulos.
    pub language: LanguageConfig,
}

impl Config {
    /// Todos los trackers para un torrent: los de la config más la lista compartida, sin repetir.
    /// Sin los WebRTC (`wss://`): solo los entiende el motor webtorrent, que suma los suyos.
    pub fn all_trackers(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for t in self.trackers.iter().chain(&self.shared_trackers) {
            if !t.starts_with("wss://") && !out.contains(t) {
                out.push(t.clone());
            }
        }
        out
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            // Lista probada en v1 (streamonte-core.ps1).
            trackers: [
                "udp://tracker.opentrackr.org:1337/announce",
                "udp://open.stealth.si:80/announce",
                "udp://tracker.torrent.eu.org:451/announce",
                "udp://exodus.desync.com:6969/announce",
                "udp://open.demonii.com:1337/announce",
                "udp://tracker.dler.org:6969/announce",
                "udp://explodie.org:6969/announce",
            ]
            .map(String::from)
            .to_vec(),
            shared_trackers: Vec::new(),
            engine: EngineConfig::default(),
            preload: PreloadConfig::default(),
            analyzer: AnalyzerConfig::default(),
            ranking: RankingConfig::default(),
            player: PlayerConfig::default(),
            subtitles: SubtitlesConfig::default(),
            clipboard: ClipboardConfig::default(),
            logging: LoggingConfig::default(),
            catalog: CatalogConfig::default(),
            language: LanguageConfig::default(),
        }
    }
}

/// Idioma de la app o de los títulos. Español por defecto.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Lang {
    #[default]
    Es,
    En,
}

impl Lang {
    /// Parámetro `language` de TMDB (el español de TMDB más cercano al rioplatense es el de México).
    pub fn tmdb(self) -> &'static str {
        match self {
            Self::Es => "es-MX",
            Self::En => "en-US",
        }
    }
}

/// `app`: menús, botones, sinopsis y géneros. `titles`: títulos de películas, series y capítulos
/// (puede ser otro). Los subtítulos no dependen de esto: siempre priorizan español.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct LanguageConfig {
    pub app: Lang,
    pub titles: Lang,
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
    /// del analizador no, salvo el conteo profundo con `announce_early` (ADR-30). Apagarlo sirve
    /// para comparar antes/después.
    pub incoming: bool,
    /// Puertos TCP a probar en orden `[primero, último]`; si están todos ocupados, uno al azar.
    pub listen_ports: [u16; 2],
    /// Pedir al router el reenvío del puerto por UPnP (sin NAT-PMP/PCP).
    pub upnp: bool,
    /// uTP (UDP) además de TCP. Prendido por defecto (2026-11-16): con el puerto cerrado y sin
    /// acceso al router, suma peers salientes (muchos clientes lo prefieren). librqbit todavía lo
    /// marca inestable: si da problemas, se apaga acá.
    pub utp: bool,
    /// Salud fiel, idea 1 (2026-11-16): al elegir un episodio, contar a fondo los 15 mejores enseguida
    /// con el motor ESCUCHANDO: se anuncia con el puerto real a trackers y DHT y los peers se
    /// conectan solos (entrantes). Deja la IP listada ~30 min en esos enjambres.
    pub announce_early: bool,
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
            utp: true,
            announce_early: true,
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
    /// Al pegar magnets: buscar el nombre real y hacerles el análisis rápido solos (pedido del
    /// usuario, 2026-11-13; sin medir velocidad desde 2026-11-15).
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
            tracing::warn!(
                "config: ranking.movie_minutes = 0; se usa {}",
                d.movie_minutes
            );
            self.movie_minutes = d.movie_minutes;
        }
        if self.episode_minutes == 0 {
            tracing::warn!(
                "config: ranking.episode_minutes = 0; se usa {}",
                d.episode_minutes
            );
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
    /// `None` = detectar automáticamente (NFR-03).
    pub mpv_path: Option<PathBuf>,
    pub vlc_path: Option<PathBuf>,
    /// Perfil de la app con caché para streaming + gpu-next (FR-34).
    pub use_app_profile: bool,
    /// uosc + thumbfast (FR-35).
    pub modern_ui: bool,
    /// Ecualizador de mpv (2026-11-17, Ajustes): por defecto el "cine" que venía fijo.
    pub equalizer: Equalizer,
    /// Intensidad del ecualizador en % (0–[`EQ_MAX_INTENSITY`]): escala las ganancias del preset.
    pub equalizer_intensity: u8,
}

/// Tope de la intensidad del ecualizador (%).
pub const EQ_MAX_INTENSITY: u8 = 150;
/// Intensidad por defecto (%): las ganancias tal cual las define cada preset.
pub const EQ_DEFAULT_INTENSITY: u8 = 100;
/// Headroom (dB) antes de realzar, a 100 %: se escala con la intensidad para no saturar.
pub const EQ_HEADROOM_DB: f64 = 2.0;

/// Una banda del ecualizador (`equalizer` de lavfi, ancho en Q).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EqBand {
    pub freq_hz: f64,
    pub width_q: f64,
    /// Ganancia a 100 % de intensidad.
    pub gain_db: f64,
}

/// Número sin ceros de más (`2`, `1.5`, `0.8`) para las cadenas de lavfi y las opciones del script.
pub fn eq_num(x: f64) -> String {
    let s = format!("{x:.2}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Presets del ecualizador de mpv (Ajustes → Reproductor).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Equalizer {
    /// +2 dB de graves (80 Hz), +1,5 dB de presencia de voces (3 kHz) y +1 dB de aire (10 kHz).
    #[default]
    Cine,
    /// Voces al frente: +1,5 dB a 1,5 kHz y +3 dB a 3 kHz; graves sin tocar.
    Voices,
    /// Sin ecualizador.
    Flat,
}

const fn band(freq_hz: f64, width_q: f64, gain_db: f64) -> EqBand {
    EqBand {
        freq_hz,
        width_q,
        gain_db,
    }
}

impl Equalizer {
    /// Bandas del preset a 100 %; vacío = sin ecualizador. Única fuente: la cadena de lavfi y el
    /// script de teclas de mpv (`player::eq_script_opts`) salen de acá.
    pub fn bands(self) -> &'static [EqBand] {
        // `const`: una llamada a fn (aunque sea const) no se promueve sola a `'static`.
        const CINE: &[EqBand] = &[
            band(80.0, 0.8, 2.0),
            band(3000.0, 1.0, 1.5),
            band(10000.0, 1.0, 1.0),
        ];
        const VOICES: &[EqBand] = &[band(1500.0, 1.0, 1.5), band(3000.0, 1.0, 3.0)];
        match self {
            Equalizer::Cine => CINE,
            Equalizer::Voices => VOICES,
            Equalizer::Flat => &[],
        }
    }

    /// Cadena lavfi para `--af-append`; `None` = sin ecualizador (preset plano o intensidad 0).
    /// Ganancias y headroom (-2 dB a 100 %) escalan con `intensity` (%, tope 150).
    pub fn lavfi(self, intensity: u8) -> Option<String> {
        let bands = self.bands();
        let intensity = intensity.min(EQ_MAX_INTENSITY);
        if bands.is_empty() || intensity == 0 {
            return None;
        }
        let k = f64::from(intensity) / 100.0;
        let mut parts = vec![format!("volume=-{}dB", eq_num(EQ_HEADROOM_DB * k))];
        for b in bands {
            parts.push(format!(
                "equalizer=f={}:t=q:w={}:g={}",
                eq_num(b.freq_hz),
                eq_num(b.width_q),
                eq_num(b.gain_db * k)
            ));
        }
        Some(parts.join(","))
    }
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            mpv_path: None,
            vlc_path: None,
            use_app_profile: true,
            modern_ui: false,
            equalizer: Equalizer::default(),
            equalizer_intensity: EQ_DEFAULT_INTENSITY,
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
                add_missing_sources(&mut config);
                self.own_port(&mut config);
                Ok(config)
            }
            Ok(None) => {
                let mut config = Config::default();
                self.own_port(&mut config);
                Ok(config)
            }
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

    /// Cada instalación con sus puertos (2026-11-16): con el rango por defecto, dos PCs de la misma
    /// red piden al router el mismo puerto por UPnP y solo una lo consigue. Se elige uno al azar
    /// en 41000–48999 (debajo del rango efímero de Windows) y se guarda.
    fn own_port(&self, config: &mut Config) {
        use std::hash::{BuildHasher, Hasher};
        if config.engine.listen_ports != EngineConfig::default().listen_ports {
            return;
        }
        let pick = std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish();
        let mut first = 41_000 + (pick % 800) as u16 * 10;
        // Nunca el par por defecto: al recargar parecería sin elegir y se sortearía de nuevo en cada arranque
        // (1 de 800; el test `sin_archivo_devuelve_defaults` falló así en CI, 2026-11-23).
        if first == EngineConfig::default().listen_ports[0] {
            first += 10;
        }
        config.engine.listen_ports = [first, first + 9];
        if let Err(e) = self.save(config) {
            tracing::warn!("no se pudo guardar el puerto propio: {e}");
        }
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

/// De dónde sale una fuente: un addon de Stremio o una fuente propia de la app (API conocida,
/// sin manifest). Las propias se agregan solas a las configs guardadas (`add_missing_sources`).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    #[default]
    Stremio,
    /// hacktorrent.cc con pelispanda.org de respaldo (audio latino/castellano, solo películas).
    Hacktorrent,
    /// elitetorrent.com (castellano/latino, solo películas; magnets decodificados en local).
    EliteTorrent,
    /// Tracker privado lat-team.com (necesita el API token del usuario).
    LatTeam,
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
    #[serde(default)]
    pub kind: SourceKind,
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
        kind: SourceKind::Stremio,
    };
    // Fuentes propias: sin URL (la base está en su módulo).
    let own = |id: &str, name: &str, kind: SourceKind, shown: &str, enabled: bool| AddonEntry {
        id: id.into(),
        name: name.into(),
        url: None,
        display_url: shown.into(),
        secret: false,
        enabled,
        timeout_ms: None,
        kind,
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
        // Apagada por defecto (2026-11-15): no respondía nunca y cada búsqueda la esperaba 8 s.
        AddonEntry {
            enabled: false,
            ..public("cometa", "Cometa", "https://cometa.stremaddon.net/manifest.json", Some(8_000))
        },
        own(
            "hacktorrent",
            "Hacktorrent",
            SourceKind::Hacktorrent,
            "hacktorrent.cc (respaldo: pelispanda.org) · latino y castellano, películas",
            true,
        ),
        own(
            "elitetorrent",
            "EliteTorrent",
            SourceKind::EliteTorrent,
            "elitetorrent.com · castellano y latino, películas",
            true,
        ),
        // Apagada: necesita el API token del usuario y es un tracker privado con reglas de ratio.
        own(
            "latteam",
            "Lat-Team",
            SourceKind::LatTeam,
            "lat-team.com · tracker privado, con tu API token",
            false,
        ),
    ]
}

/// Las fuentes propias que una config vieja todavía no tiene (apagadas o no, como en fábrica).
fn add_missing_sources(config: &mut Config) {
    for d in default_addons()
        .into_iter()
        .filter(|d| d.kind != SourceKind::Stremio)
    {
        if !config.catalog.addons.iter().any(|a| a.id == d.id) {
            config.catalog.addons.push(d);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> (ConfigStore, crate::fsutil::TestDir) {
        let dir = crate::fsutil::test_dir(&format!("config-{name}"));
        (ConfigStore::at(dir.join("config.json")), dir)
    }

    #[test]
    fn sin_archivo_devuelve_defaults() {
        let (store, _dir) = temp_store("missing");
        let mut loaded = store.load().unwrap();
        // Puertos propios de la instalación: al azar, guardados y estables al recargar.
        let [a, b] = loaded.engine.listen_ports;
        assert!((41_000..49_000).contains(&a) && b == a + 9, "{a}-{b}");
        assert_eq!(store.load().unwrap(), loaded);
        loaded.engine.listen_ports = EngineConfig::default().listen_ports;
        assert_eq!(loaded, Config::default());
    }

    #[test]
    fn guardar_y_cargar_ida_y_vuelta() {
        let (store, _dir) = temp_store("roundtrip");
        let mut c = Config::default();
        c.logging.diagnostics = true;
        c.player.equalizer = Equalizer::Flat;
        c.trackers.push("udp://ejemplo:1/announce".into());
        c.engine.listen_ports = [43_210, 43_219];
        store.save(&c).unwrap();
        assert_eq!(store.load().unwrap(), c);
    }

    #[test]
    fn ecualizador_escala_ganancias_con_la_intensidad() {
        // 100 % = las cadenas fijas de antes.
        assert_eq!(
            Equalizer::Cine.lavfi(100).as_deref(),
            Some("volume=-2dB,equalizer=f=80:t=q:w=0.8:g=2,equalizer=f=3000:t=q:w=1:g=1.5,equalizer=f=10000:t=q:w=1:g=1")
        );
        assert_eq!(
            Equalizer::Voices.lavfi(50).as_deref(),
            Some("volume=-1dB,equalizer=f=1500:t=q:w=1:g=0.75,equalizer=f=3000:t=q:w=1:g=1.5")
        );
        // 150 % también sube el headroom; con el tope se recorta lo que pase de 150.
        assert_eq!(Equalizer::Voices.lavfi(150), Equalizer::Voices.lavfi(200));
        assert!(Equalizer::Voices
            .lavfi(150)
            .unwrap()
            .starts_with("volume=-3dB,"));
        assert_eq!(Equalizer::Cine.lavfi(0), None);
        assert_eq!(Equalizer::Flat.lavfi(100), None);
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
        // `speed_factor` ya no es campo de config (serde lo ignora): los márgenes quedan en default.
        assert_eq!(
            (r.green_margin, r.yellow_margin),
            (d.green_margin, d.yellow_margin)
        );
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
    }

    #[test]
    fn all_trackers_suma_la_lista_compartida_sin_repetir_ni_webrtc() {
        let c = Config {
            trackers: vec!["udp://a/announce".into(), "wss://w".into()],
            shared_trackers: vec!["udp://a/announce".into(), "http://b/announce".into()],
            ..Default::default()
        };
        assert_eq!(c.all_trackers(), ["udp://a/announce", "http://b/announce"]);
    }

    #[test]
    fn defaults_documentados() {
        let c = Config::default();
        assert!(!c.trackers.is_empty());
        assert!(c.trackers.iter().all(|t| !t.starts_with("wss://")));
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
