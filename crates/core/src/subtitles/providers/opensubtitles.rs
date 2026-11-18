//! OpenSubtitles.com (Q-01), el "Premium" del dropdown (2026-11-18): API REST v1 con la key del
//! usuario y pocas descargas por día. Buscar no gasta; cada `POST /download` gasta 1, por eso se
//! baja de a uno y solo cuando el usuario lo elige. La cuota se controla ANTES de cada descarga con
//! un único [`QuotaGate`] para toda la app (ADR-12) y se conoce recién con la primera descarga.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use async_trait::async_trait;
use chrono::{DateTime, NaiveTime, Utc};
use serde_json::Value;

use super::cache::{cached, save};
use super::http::{get_bytes, http, HttpError};
use super::{body_detail, err, http_err, release_match, SubtitleProvider, OPENSUBTITLES};
use crate::config::SubtitleLanguage;
use crate::subtitles::{MatchKind, Quota, SpanishVariant, SubtitleCandidate, VideoIdentity};
use crate::{CoreError, Result};

const OS_API: &str = "https://api.opensubtitles.com/api/v1";
/// Cuota de la cuenta gratuita (Q-01), solo si el servidor no la dijo; la real llega en cada
/// descarga (`requests` + `remaining`).
const OS_PER_DAY: u32 = 20;

/// Cuota de descargas de la cuenta de OpenSubtitles. Es UNA para todo el proceso (como el
/// cliente HTTP): el proveedor se arma en cada búsqueda, la cuota es de la cuenta.
/// Se actualiza con cada respuesta de `POST /download` (incluido el 406 = agotada) y se
/// consulta antes de pedir, de a un pedido por vez.
#[derive(Default)]
pub(super) struct QuotaGate(tokio::sync::Mutex<QuotaState>);

#[derive(Default, Clone, Copy)]
struct QuotaState {
    /// `None` = no se sabe todavía (nadie descargó desde que abrió la app, o ya se renovó).
    remaining: Option<u32>,
    per_day: u32,
    resets_at: Option<DateTime<Utc>>,
}

fn global_quota() -> &'static QuotaGate {
    static GATE: OnceLock<QuotaGate> = OnceLock::new();
    GATE.get_or_init(QuotaGate::default)
}

impl QuotaState {
    /// Pasada la hora de renovación, la cuota vuelve a "no se sabe" (se puede pedir).
    fn current(self, now: DateTime<Utc>) -> Self {
        if self.resets_at.is_some_and(|t| now >= t) {
            Self::default()
        } else {
            self
        }
    }

    /// `body` de `POST /download` (éxito o 406): `remaining`, `requests`, `reset_time_utc`.
    fn update(&mut self, body: &[u8], exhausted: bool, now: DateTime<Utc>) {
        let json: Value = serde_json::from_slice(body).unwrap_or_default();
        let remaining = if exhausted {
            0
        } else {
            match json["remaining"].as_i64() {
                Some(r) => r.max(0) as u32,
                None => return,
            }
        };
        let used = json["requests"].as_u64().unwrap_or(0) as u32;
        // Lo que dice el servidor (usadas + restantes); agotada sin datos: lo último conocido.
        self.per_day = match (exhausted, used) {
            (false, _) => used + remaining,
            (true, used) if used > 0 => used,
            (true, _) if self.per_day > 0 => self.per_day,
            (true, _) => OS_PER_DAY,
        };
        self.remaining = Some(remaining);
        let reset = json["reset_time_utc"]
            .as_str()
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
            .map(|t| t.with_timezone(&Utc));
        // Sin hora del servidor y agotada: se reintenta el próximo día UTC.
        self.resets_at = reset.or_else(|| (remaining == 0).then(|| next_utc_day(now)));
    }
}

fn next_utc_day(now: DateTime<Utc>) -> DateTime<Utc> {
    let day = now.date_naive().succ_opt().unwrap_or(now.date_naive());
    day.and_time(NaiveTime::MIN).and_utc()
}

impl QuotaGate {
    /// Lo que informó la cuenta (`/infos/user`).
    async fn set(&self, q: &AccountQuota) {
        let mut s = self.0.lock().await;
        s.remaining = Some(q.remaining);
        s.per_day = q.per_day;
        s.resets_at = q.resets_at;
    }

    async fn snapshot(&self, now: DateTime<Utc>) -> Option<Quota> {
        let s = self.0.lock().await.current(now);
        s.remaining.map(|remaining| Quota {
            remaining,
            per_day: s.per_day,
            resets_at: s.resets_at,
        })
    }

    /// Hace `request` (el pedido que gasta cuota) solo si queda cuota. Con el candado tomado
    /// durante el pedido, N descargas en paralelo con 1 restante no pasan todas el control.
    async fn spend(
        &self,
        now: DateTime<Utc>,
        request: impl Future<Output = std::result::Result<Vec<u8>, HttpError>>,
    ) -> Result<Vec<u8>> {
        let mut state = self.0.lock().await;
        *state = state.current(now);
        if state.remaining == Some(0) {
            let when = state.resets_at.map_or(String::new(), |t| {
                format!(
                    ": se renueva {}",
                    t.with_timezone(&chrono::Local).format("%d/%m %H:%M")
                )
            });
            return Err(err(OPENSUBTITLES, format!("cuota diaria agotada{when}")));
        }
        let result = request.await;
        match &result {
            Ok(body) => state.update(body, false, now),
            Err(HttpError::Status { status: 406, body }) => state.update(body, true, now),
            Err(_) => {} // sin respuesta del servidor: no se sabe si contó
        }
        result.map_err(os_http_err)
    }
}

/// Sesión con la cuenta del usuario (`POST /login`): token y servidor para bajar (los VIP tienen
/// otro). Una para todo el proceso; un login fallido no se reintenta hasta que cambien los datos.
#[derive(Clone)]
struct Session {
    token: String,
    base: String,
    until: DateTime<Utc>,
}

fn sessions() -> &'static tokio::sync::Mutex<Option<std::result::Result<Session, String>>> {
    static S: OnceLock<tokio::sync::Mutex<Option<std::result::Result<Session, String>>>> =
        OnceLock::new();
    S.get_or_init(Default::default)
}

/// Olvida la sesión (y un login fallido): al guardar otros datos de la cuenta.
pub fn forget_opensubtitles_login() {
    match sessions().try_lock() {
        Ok(mut s) => *s = None,
        // Un login en curso: se olvida apenas termine.
        Err(_) => {
            if let Ok(rt) = tokio::runtime::Handle::try_current() {
                rt.spawn(async { *sessions().lock().await = None });
            }
        }
    }
}

/// Un token dura 24 h; se renueva un rato antes.
const SESSION_HOURS: i64 = 23;

pub struct OpenSubtitlesProvider {
    key: Option<String>,
    quota: &'static QuotaGate,
}

/// Cuota que informa la cuenta (`GET /infos/user`).
pub struct AccountQuota {
    pub remaining: u32,
    pub per_day: u32,
    pub resets_at: Option<DateTime<Utc>>,
}

impl OpenSubtitlesProvider {
    pub fn from_store() -> Self {
        Self {
            key: crate::subtitles::secrets::api_key(OPENSUBTITLES),
            quota: global_quota(),
        }
    }
    pub fn has_key(&self) -> bool {
        self.key.is_some()
    }
    /// Sesión con la cuenta: `Ok(None)` sin login guardado; `Err` si el login falló (mensaje
    /// para el usuario; no se reintenta hasta cambiar los datos).
    async fn session(&self) -> Result<Option<Session>> {
        let Some((user, pass)) = crate::subtitles::secrets::opensubtitles_login() else {
            return Ok(None);
        };
        let mut cached = sessions().lock().await;
        match &*cached {
            Some(Ok(s)) if s.until > Utc::now() => return Ok(Some(s.clone())),
            Some(Err(msg)) => return Err(err(OPENSUBTITLES, msg.clone())),
            _ => {}
        }
        let body = serde_json::json!({ "username": user, "password": pass });
        let req = http()
            .post(format!("{OS_API}/login"))
            .header("Api-Key", self.key()?)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string());
        let result = match get_bytes(req).await {
            Ok(bytes) => {
                let json: Value = serde_json::from_slice(&bytes).unwrap_or_default();
                match json["token"].as_str() {
                    Some(token) => Ok(Session {
                        token: token.to_string(),
                        base: json["base_url"]
                            .as_str()
                            .filter(|b| !b.is_empty())
                            .map_or_else(|| OS_API.to_string(), |b| format!("https://{b}/api/v1")),
                        until: Utc::now() + chrono::Duration::hours(SESSION_HOURS),
                    }),
                    None => Err("el login no devolvió sesión".to_string()),
                }
            }
            Err(HttpError::Status { status: 401, .. }) => {
                Err("usuario o contraseña de OpenSubtitles.com incorrectos".to_string())
            }
            // Sin red o el servidor no respondió: no se guarda (se reintenta la próxima vez).
            Err(e) => return Err(os_http_err(e)),
        };
        *cached = Some(result.clone());
        result.map(Some).map_err(|msg| err(OPENSUBTITLES, msg))
    }

    /// Cuota de la cuenta con login (`None` sin login). La deja también en la cuota de la app.
    pub async fn account_quota(&self) -> Result<Option<AccountQuota>> {
        let Some(session) = self.session().await? else {
            return Ok(None);
        };
        let req = http()
            .get(format!("{}/infos/user", session.base))
            .header("Api-Key", self.key()?)
            .header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", session.token),
            )
            .header(reqwest::header::ACCEPT, "application/json");
        let bytes = get_bytes(req).await.map_err(os_http_err)?;
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err(OPENSUBTITLES, format!("respuesta inválida: {e}")))?;
        let data = &json["data"];
        let (Some(per_day), Some(remaining)) = (
            data["allowed_downloads"].as_u64(),
            data["remaining_downloads"].as_i64(),
        ) else {
            return Ok(None);
        };
        let q = AccountQuota {
            remaining: remaining.max(0) as u32,
            per_day: per_day as u32,
            resets_at: data["reset_time_utc"]
                .as_str()
                .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                .map(|t| t.with_timezone(&Utc)),
        };
        self.quota.set(&q).await;
        Ok(Some(q))
    }

    fn key(&self) -> Result<&str> {
        self.key
            .as_deref()
            .ok_or_else(|| err(OPENSUBTITLES, "sin API key configurada: se omite"))
    }
}

/// Error HTTP de OpenSubtitles: el 406 es su "cuota diaria agotada".
fn os_http_err(e: HttpError) -> CoreError {
    match e {
        HttpError::Status { status: 406, body } => err(
            OPENSUBTITLES,
            format!("cuota diaria agotada (406) {}", body_detail(&body)),
        ),
        e => http_err(OPENSUBTITLES, e),
    }
}

/// Parser puro de `GET /subtitles`. Códigos: `ea` = Spanish (LA), `sp` = Spanish (EU), `es` = Spanish.
pub(super) fn parse_opensubtitles(
    json: &Value,
    video: &VideoIdentity,
    lang: SubtitleLanguage,
) -> Vec<SubtitleCandidate> {
    json["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let a = &item["attributes"];
            let code = a["language"].as_str().unwrap_or_default();
            let (language, variant) = match code {
                "ea" => (SubtitleLanguage::Es, SpanishVariant::Latino),
                "sp" => (SubtitleLanguage::Es, SpanishVariant::Spain),
                "es" => (SubtitleLanguage::Es, SpanishVariant::Unknown),
                "en" => (SubtitleLanguage::En, SpanishVariant::Unknown),
                _ => return None,
            };
            if language != lang {
                return None;
            }
            let file_id = a["files"].as_array()?.first()?["file_id"].as_u64()?;
            let release = a["release"].as_str().unwrap_or_default().to_string();
            let match_kind = if a["moviehash_match"].as_bool() == Some(true) {
                MatchKind::Exact
            } else {
                release_match(video, &release)
            };
            Some(SubtitleCandidate {
                provider: OPENSUBTITLES,
                provider_id: file_id.to_string(),
                release_name: release,
                language,
                match_kind,
                downloads: a["download_count"]
                    .as_u64()
                    .unwrap_or(0)
                    .min(u32::MAX as u64) as u32,
                variant,
                url: String::new(),
                fps: a["fps"].as_f64().filter(|f| *f > 0.0),
                last_secs: None,
            })
        })
        .collect()
}

#[async_trait]
impl SubtitleProvider for OpenSubtitlesProvider {
    fn id(&self) -> &'static str {
        OPENSUBTITLES
    }
    async fn quota(&self) -> Result<Option<Quota>> {
        Ok(self.quota.snapshot(Utc::now()).await)
    }
    async fn search(
        &self,
        video: &VideoIdentity,
        lang: SubtitleLanguage,
    ) -> Result<Vec<SubtitleCandidate>> {
        let key = self.key()?;
        // Español: todas las variantes que distingue OpenSubtitles (ver `parse_opensubtitles`).
        let languages = if lang == SubtitleLanguage::En {
            "en"
        } else {
            "ea,es,sp"
        };
        let mut query: Vec<(&str, String)> = vec![("languages", languages.into())];
        if let Some(h) = video.movie_hash {
            query.push(("moviehash", format!("{h:016x}")));
        }
        match (&video.imdb_id, &video.title) {
            (Some(imdb), _) => query.push(("imdb_id", imdb.trim_start_matches("tt").into())),
            (None, Some(t)) => query.push(("query", t.clone())),
            (None, None) => {}
        }
        if let Some(y) = video.year {
            query.push(("year", y.to_string()));
        }
        if let (Some(s), Some(e)) = (video.season, video.episode) {
            query.push(("season_number", s.to_string()));
            query.push(("episode_number", e.to_string()));
        }
        let req = http()
            .get(format!("{OS_API}/subtitles"))
            .header("Api-Key", key)
            .header(reqwest::header::ACCEPT, "application/json")
            .query(&query);
        let bytes = get_bytes(req).await.map_err(os_http_err)?;
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err(OPENSUBTITLES, format!("respuesta inválida: {e}")))?;
        Ok(parse_opensubtitles(&json, video, lang))
    }
    async fn download(&self, cand: &SubtitleCandidate, cache_dir: &Path) -> Result<PathBuf> {
        if let Some(p) = cached(cache_dir, cand) {
            return Ok(p); // de la caché: no gasta cuota
        }
        let key = self.key()?;
        // Con login, con la cuota (y el servidor) de la cuenta; si el login falló, con la key sola.
        let session = self.session().await.ok().flatten();
        let body = serde_json::json!({ "file_id": cand.provider_id.parse::<u64>().unwrap_or(0) });
        let mut req = http()
            .post(format!(
                "{}/download",
                session.as_ref().map_or(OS_API, |s| s.base.as_str())
            ))
            .header("Api-Key", key)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string());
        if let Some(s) = &session {
            req = req.header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", s.token),
            );
        }
        let bytes = self.quota.spend(Utc::now(), get_bytes(req)).await?;
        let json: Value = serde_json::from_slice(&bytes)
            .map_err(|e| err(OPENSUBTITLES, format!("respuesta inválida: {e}")))?;
        let link = json["link"]
            .as_str()
            .ok_or_else(|| err(OPENSUBTITLES, "la descarga no trajo link"))?;
        let bytes = get_bytes(http().get(link)).await.map_err(os_http_err)?;
        save(cache_dir, cand, &bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::providers::tests::{fixture, video};

    #[test]
    fn opensubtitles_parser() {
        let c = parse_opensubtitles(
            &fixture("opensubtitles-search.json"),
            &video(),
            SubtitleLanguage::Es,
        );
        assert_eq!(c.len(), 3, "sin el inglés");
        assert_eq!(c[0].provider_id, "7001");
        assert_eq!(
            (c[0].variant, c[0].match_kind),
            (SpanishVariant::Latino, MatchKind::Exact)
        );
        assert_eq!(
            // Mismo nombre que el archivo del video: exacto.
            (c[1].variant, c[1].match_kind),
            (SpanishVariant::Spain, MatchKind::Exact)
        );
        assert_eq!(c[2].variant, SpanishVariant::Unknown);
    }

    fn at(t: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(t).unwrap().with_timezone(&Utc)
    }

    fn ok(body: &str) -> std::result::Result<Vec<u8>, HttpError> {
        Ok(body.as_bytes().to_vec())
    }

    /// Una cuota con 1 restante y N descargas en paralelo: solo una llega a pedir.
    #[tokio::test]
    async fn con_una_restante_solo_pasa_una_de_n_en_paralelo() {
        let gate = std::sync::Arc::new(QuotaGate::default());
        let now = at("2026-11-15T10:00:00Z");
        gate.spend(now, async { ok(r#"{"requests":19,"remaining":1}"#) })
            .await
            .unwrap();
        let asked = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut set = tokio::task::JoinSet::new();
        for _ in 0..5 {
            let (gate, asked) = (gate.clone(), asked.clone());
            set.spawn(async move {
                gate.spend(now, async move {
                    asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    tokio::task::yield_now().await;
                    ok(r#"{"requests":20,"remaining":0}"#)
                })
                .await
                .is_ok()
            });
        }
        let passed = set.join_all().await.into_iter().filter(|p| *p).count();
        assert_eq!(
            (passed, asked.load(std::sync::atomic::Ordering::SeqCst)),
            (1, 1)
        );
    }

    /// 406 → no se vuelve a pedir hasta la renovación (la del servidor o el próximo día UTC).
    #[tokio::test]
    async fn el_406_corta_hasta_la_renovacion() {
        let gate = QuotaGate::default();
        let now = at("2026-11-15T10:00:00Z");
        let exhausted = |body: &'static str| async move {
            Err(HttpError::Status {
                status: 406,
                body: body.as_bytes().to_vec(),
            })
        };
        assert!(gate.spend(now, exhausted("{}")).await.is_err());
        let q = gate.snapshot(now).await.unwrap();
        assert_eq!((q.remaining, q.per_day), (0, OS_PER_DAY));
        // Si llegara a pedir, el error sería "HTTP 500", no "agotada".
        let server = async {
            Err(HttpError::Status {
                status: 500,
                body: Vec::new(),
            })
        };
        let e = gate
            .spend(at("2026-11-15T23:59:59Z"), server)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("agotada: se renueva"), "{e}");
        // Sin hora del servidor: el próximo día UTC se puede de nuevo.
        let next_day = at("2026-11-16T00:00:00Z");
        assert!(gate.snapshot(next_day).await.is_none());
        gate.spend(next_day, async { ok(r#"{"requests":1,"remaining":19}"#) })
            .await
            .unwrap();
        assert_eq!(gate.snapshot(next_day).await.unwrap().remaining, 19);

        // Con `reset_time_utc` manda la hora del servidor.
        let body = r#"{"requests":21,"remaining":-1,"reset_time_utc":"2026-11-16T13:03:16.000Z"}"#;
        assert!(gate.spend(next_day, exhausted(body)).await.is_err());
        assert!(gate.snapshot(at("2026-11-16T13:03:15Z")).await.is_some());
        assert!(gate.snapshot(at("2026-11-16T13:03:16Z")).await.is_none());
    }

    #[tokio::test]
    async fn sin_respuesta_del_servidor_no_toca_la_cuota() {
        let gate = QuotaGate::default();
        let now = at("2026-11-15T10:00:00Z");
        let too_large = async { Err(HttpError::TooLarge { max: 1 }) };
        assert!(gate.spend(now, too_large).await.is_err());
        assert!(gate.snapshot(now).await.is_none());
    }
}
