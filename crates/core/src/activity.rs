//! `activity` — el log del núcleo, en vivo, para la burbuja de actividad de la UI (2026-11-14).
//!
//! Una capa de `tracing` manda los eventos INFO+ propios (y WARN+ de las dependencias, más el
//! resultado de UPnP) como [`CoreEvent::Activity`] por el `EventSink` de la app.
//! - Límite: como mucho [`MAX_PER_SEC`] por segundo; lo que sobra se cuenta y se avisa una vez.
//! - Nunca manda secretos: URLs con configuración en el path o en la query se enmascaran
//!   (`http::redact`) y `key=…`, `token=…`, `password=…`, `Bearer …` quedan en `****`.

use std::cell::Cell;
use std::fmt::Write as _;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Metadata, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

use crate::events::{CoreEvent, EventSink, StatusLevel};

/// Mensajes por segundo que llegan a la UI como máximo.
pub const MAX_PER_SEC: u32 = 8;
const MAX_LEN: usize = 300;

static SINK: RwLock<Option<Arc<dyn EventSink>>> = RwLock::new(None);
static LIMITER: Mutex<Option<Limiter>> = Mutex::new(None);

thread_local! {
    /// Emitir puede loguear (la cáscara): sin esto, un evento podría generar otro sin fin.
    static IN_EMIT: Cell<bool> = const { Cell::new(false) };
}

/// A partir de ahora la actividad va a `sink` (lo llama `AppCore` al arrancar).
pub fn set_sink(sink: Arc<dyn EventSink>) {
    *SINK.write().expect("activity sink") = Some(sink);
}

/// Capa para `logger::init`. Filtro por capa (no `Layer::enabled`, que apagaría el evento
/// también para los archivos de log).
pub fn layer<S>() -> impl Layer<S>
where
    S: Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    ActivityLayer.with_filter(tracing_subscriber::filter::filter_fn(wanted))
}

struct ActivityLayer;

impl<S: Subscriber> Layer<S> for ActivityLayer {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        let m = event.metadata();
        if !wanted(m) || IN_EMIT.with(Cell::get) {
            return;
        }
        let Some(sink) = SINK.read().expect("activity sink").clone() else {
            return;
        };
        let mut v = Fields::default();
        event.record(&mut v);
        let area = area(m.target());
        let level = match *m.level() {
            Level::ERROR => StatusLevel::Error,
            Level::WARN => StatusLevel::Warn,
            _ => StatusLevel::Info,
        };
        let message = friendly(area, &v.text());

        let now = Instant::now();
        let dropped = {
            let mut lim = LIMITER.lock().expect("activity limiter");
            match lim.get_or_insert_with(|| Limiter::new(now)).allow(now) {
                Some(d) => d,
                None => return,
            }
        };
        IN_EMIT.with(|f| f.set(true));
        if dropped > 0 {
            sink.emit(CoreEvent::Activity {
                level: StatusLevel::Info,
                area: "general",
                message: format!("(se omitieron {dropped} mensajes seguidos)"),
                at: Utc::now(),
            });
        }
        sink.emit(CoreEvent::Activity {
            level,
            area,
            message,
            at: Utc::now(),
        });
        IN_EMIT.with(|f| f.set(false));
    }
}

/// Propios INFO+, ajenos WARN+, y el resultado de UPnP (librqbit lo loguea en debug, ADR-30).
fn wanted(m: &Metadata<'_>) -> bool {
    let t = m.target();
    if t.starts_with(crate::logger::DIAG_PREFIX) {
        return false;
    }
    let lvl = *m.level();
    (t.starts_with("streamonte") && lvl <= Level::INFO)
        || lvl <= Level::WARN
        || crate::logger::upnp_result(m)
}

/// Ventana de 1 s con [`MAX_PER_SEC`] lugares. `allow` devuelve cuántos se descartaron desde
/// el último que pasó (para avisarlo), o `None` si este se descarta.
struct Limiter {
    window: Instant,
    sent: u32,
    dropped: u32,
}

impl Limiter {
    fn new(now: Instant) -> Self {
        Self {
            window: now,
            sent: 0,
            dropped: 0,
        }
    }

    fn allow(&mut self, now: Instant) -> Option<u32> {
        if now.duration_since(self.window) >= Duration::from_secs(1) {
            self.window = now;
            self.sent = 0;
        }
        if self.sent >= MAX_PER_SEC {
            self.dropped += 1;
            return None;
        }
        self.sent += 1;
        Some(std::mem::take(&mut self.dropped))
    }
}

/// Mensaje + hasta 4 campos (`k=v`), ya sin secretos.
#[derive(Default)]
struct Fields {
    message: String,
    extra: Vec<(&'static str, String)>,
}

impl Fields {
    fn text(&self) -> String {
        let mut s = redact(&self.message);
        for (k, v) in self.extra.iter().take(4) {
            let _ = write!(s, " · {k}={}", redact(v));
        }
        if s.chars().count() > MAX_LEN {
            s = s.chars().take(MAX_LEN).collect::<String>() + "…";
        }
        s
    }
}

impl Visit for Fields {
    fn record_str(&mut self, f: &Field, v: &str) {
        self.push(f, v.to_string());
    }
    fn record_debug(&mut self, f: &Field, v: &dyn std::fmt::Debug) {
        self.push(f, format!("{v:?}"));
    }
}

impl Fields {
    fn push(&mut self, f: &Field, v: String) {
        let name = f.name();
        if name == "message" {
            self.message = v;
        } else if is_secret_name(name) {
            self.extra.push((name, "****".into()));
        } else {
            let v: String = v.trim_matches('"').chars().take(80).collect();
            self.extra.push((name, v));
        }
    }
}

const SECRET_WORDS: &[&str] = &[
    "key", "token", "secret", "password", "passwd", "auth", "cookie",
];

fn is_secret_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    SECRET_WORDS.iter().any(|w| n.contains(w))
}

/// Saca secretos de un texto: URLs (path/query con configuración), `clave=valor` y `Bearer x`.
pub fn redact(text: &str) -> String {
    let mut out = Vec::new();
    let mut mask_next = false;
    for word in text.split(' ') {
        if mask_next {
            out.push("****".to_string());
            mask_next = false;
            continue;
        }
        let lower = word.to_ascii_lowercase();
        if let Some(i) = lower.find("http://").or_else(|| lower.find("https://")) {
            let end = word[i..]
                .find(['"', '\'', ')', ',', ']'])
                .map_or(word.len(), |e| i + e);
            out.push(format!(
                "{}{}{}",
                &word[..i],
                crate::http::redact(&word[i..end]),
                &word[end..]
            ));
            continue;
        }
        if lower == "bearer" {
            mask_next = true;
            out.push(word.to_string());
            continue;
        }
        // `api_key=abc`, `token:abc`, `password=…` (también dentro de `a=1&apikey=2`).
        let masked: Vec<String> = word
            .split('&')
            .map(|part| match part.find(['=', ':']) {
                Some(i) if is_secret_name(&part[..i]) && i + 1 < part.len() => {
                    format!("{}****", &part[..=i])
                }
                _ => part.to_string(),
            })
            .collect();
        out.push(masked.join("&"));
    }
    out.join(" ")
}

/// Área de la burbuja según el módulo que loguea.
fn area(target: &str) -> &'static str {
    let has = |s: &str| target.contains(s);
    if has("upnp") {
        "red"
    } else if has("analyzer") || has("trackers") || has("ranking") {
        "analisis"
    } else if has("subtitles") {
        "subtitulos"
    } else if has("catalog") {
        "catalogo"
    } else if has("playback") || has("player") || has("preload") || has("mpv") {
        "reproduccion"
    } else if has("librqbit") || has("engine") || has("webtorrent") {
        "motor"
    } else if has("cleanup") || has("storage") {
        "limpieza"
    } else if has("clipboard") {
        "portapapeles"
    } else {
        "general"
    }
}

/// Las dependencias loguean en inglés: los casos comunes, en castellano.
fn friendly(area: &str, msg: &str) -> String {
    let lower = msg.to_ascii_lowercase();
    if area == "red" {
        return if lower.contains("success") || lower.contains("forwarded") {
            format!("Puerto abierto en el router con UPnP ({msg})")
        } else if lower.contains("fail") || lower.contains("error") {
            format!("No se pudo abrir el puerto con UPnP: el router no respondió ({msg})")
        } else {
            format!("UPnP: {msg}")
        };
    }
    msg.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limite_por_segundo_y_aviso_de_lo_omitido() {
        let t0 = Instant::now();
        let mut lim = Limiter::new(t0);
        for _ in 0..MAX_PER_SEC {
            assert_eq!(lim.allow(t0), Some(0));
        }
        assert_eq!(lim.allow(t0), None, "el 9º del mismo segundo se descarta");
        assert_eq!(lim.allow(t0 + Duration::from_millis(500)), None);
        // Otro segundo: pasa y avisa que se omitieron 2.
        assert_eq!(lim.allow(t0 + Duration::from_secs(1)), Some(2));
        assert_eq!(lim.allow(t0 + Duration::from_secs(1)), Some(0));
    }

    #[test]
    fn nunca_manda_secretos() {
        assert_eq!(
            redact("addon https://torrentio.strem.fun/realdebrid=SECRETO/manifest.json respondió"),
            "addon https://torrentio.strem.fun/****/manifest.json respondió"
        );
        let r = redact("pido https://api.example.com/subs?apikey=ABC123&q=dune listo");
        assert!(!r.contains("ABC123"), "{r}");
        assert_eq!(
            redact("api_key=ABC token:XYZ normal=1"),
            "api_key=**** token:**** normal=1"
        );
        assert_eq!(redact("a=1&apikey=2"), "a=1&apikey=****");
        assert_eq!(
            redact("Authorization: Bearer abc.def"),
            "Authorization: Bearer ****"
        );
        assert_eq!(redact("medido 78 Mbps"), "medido 78 Mbps");
        assert!(is_secret_name("api_key") && is_secret_name("Token") && !is_secret_name("peers"));
    }

    #[test]
    fn areas_por_modulo() {
        assert_eq!(area("streamonte_core::analyzer"), "analisis");
        assert_eq!(area("librqbit_upnp"), "red");
        assert_eq!(area("librqbit::session"), "motor");
        assert_eq!(area("streamonte_core::playback"), "reproduccion");
        assert_eq!(
            area("streamonte_core::subtitles::opensubtitles"),
            "subtitulos"
        );
    }
}
