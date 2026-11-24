//! Subtítulos: dropdown del catálogo, Premium, guardar copias y subtítulos de la reproducción.

use super::*;

/// Un subtítulo del dropdown del catálogo (2026-11-18): bajado ("Encontrados para vos") o
/// resultado de Premium sin bajar (`path` vacío).
#[derive(Debug, Clone, Serialize)]
pub struct SubtitleFound {
    /// `proveedor:id`: para elegirlo ([`AppCore::catalog_subtitle_use`]).
    pub key: String,
    /// Nombre en pantalla del proveedor.
    pub provider: String,
    pub language: crate::config::SubtitleLanguage,
    pub release_name: String,
    /// Para distinguir dos del mismo release (p. ej. uno para sordos).
    pub downloads: u32,
    /// Archivo ya bajado (en la caché de la app): para "Descargar" desde el panel.
    pub path: String,
    /// Cuánto calza con el video: `exact` / `release` / `fps` / `none`.
    pub level: crate::subtitles::MatchKind,
    pub latino: bool,
    /// Grupo del release (o el proveedor si no se sabe) y "fuente resolución" (o "sin release").
    pub head: String,
    pub spec: String,
}

impl SubtitleFound {
    fn new(cand: &crate::subtitles::SubtitleCandidate, path: Option<&std::path::Path>) -> Self {
        let release = crate::release::parse_release_name(&cand.release_name);
        let tags = crate::catalog::normalize::release_tags(&cand.release_name, &release);
        let provider = crate::subtitles::providers::display_name(cand.provider).to_string();
        let spec: Vec<String> = [tags.source, tags.resolution]
            .into_iter()
            .flatten()
            .collect();
        SubtitleFound {
            key: cand.key(),
            language: cand.language,
            release_name: cand.release_name.clone(),
            downloads: cand.downloads,
            path: path.map(|p| p.display().to_string()).unwrap_or_default(),
            level: cand.match_kind,
            latino: cand.variant == crate::subtitles::SpanishVariant::Latino,
            head: release.release_group.unwrap_or_else(|| provider.clone()),
            spec: if spec.is_empty() {
                "sin release".into()
            } else {
                spec.join(" ")
            },
            provider,
        }
    }
}

/// Subtítulos de una opción para el dropdown: lo encontrado y lo elegido / probado en ella.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogSubtitles {
    pub found: Vec<SubtitleFound>,
    pub picks: SubtitlePicks,
    /// Se saben los fps y la duración de la opción (se leyeron sus pistas): sin eso ninguno puede
    /// calzar por "mismos fps y duración", y la UI lo dice.
    pub timing_known: bool,
}

/// Lo elegido para la opción (clave) y los que eligió antes y cambió (no sincronizaron).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SubtitlePicks {
    pub chosen: Option<String>,
    pub tried: Vec<String>,
}

/// Cuota de OpenSubtitles.com (Premium). `remaining`/`per_day` = `None`: todavía no se sabe
/// (se conoce con la primera descarga desde que abrió la app).
#[derive(Debug, Clone, Serialize)]
pub struct PremiumQuota {
    pub has_key: bool,
    /// Hay usuario y contraseña de OpenSubtitles.com: la cuota se sabe desde el arranque.
    pub has_login: bool,
    /// El login falló (mensaje para el usuario); no se reintenta hasta cambiar los datos.
    pub login_error: Option<String>,
    pub remaining: Option<u32>,
    pub per_day: Option<u32>,
    /// Hora local en que vuelve ("21:00"), si el servidor la dijo.
    pub resets_at: Option<String>,
}

/// El Premium elegido para bajar: lo que la UI ya mostró del resultado de la búsqueda.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PremiumPick {
    /// `file_id` de OpenSubtitles.com.
    pub id: u64,
    pub release_name: String,
    pub latino: bool,
    pub level: crate::subtitles::MatchKind,
}

/// Un subtítulo para copiar a Descargas: el archivo de la caché y con qué nombre (sin extensión).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SubtitleSave {
    pub path: String,
    pub name: String,
}

impl AppCore {
    /// "Descargar" subtítulos del panel (2026-11-17): copia los elegidos a
    /// `Descargas/<título> (subtítulos)` y abre la carpeta. Las rutas vienen de la UI: solo se
    /// copian archivos de la caché de la app.
    pub fn save_subtitles(
        &self,
        title: &str,
        files: &[SubtitleSave],
    ) -> Result<std::path::PathBuf> {
        let base = directories::UserDirs::new()
            .and_then(|u| u.download_dir().map(|d| d.to_path_buf()))
            .ok_or(CoreError::Unsupported("carpeta de Descargas"))?;
        let safe = |s: &str| -> String {
            s.chars()
                .map(|c| {
                    if "/\\:*?\"<>|".contains(c) || c.is_control() {
                        '-'
                    } else {
                        c
                    }
                })
                .collect::<String>()
                .trim()
                .to_string()
        };
        let io = |path: &std::path::Path| {
            let path = path.to_path_buf();
            move |source| CoreError::Io { path, source }
        };
        let dest = base.join(format!("{} (subtítulos)", safe(title)));
        std::fs::create_dir_all(&dest).map_err(io(&dest))?;
        for f in files {
            let from = self.cached_file(&f.path)?;
            let ext = from.extension().and_then(|e| e.to_str()).unwrap_or("srt");
            let to = dest.join(format!("{}.{ext}", safe(&f.name)));
            std::fs::copy(&from, &to).map_err(io(&to))?;
        }
        crate::cleanup::open_in_file_manager(&dest)?;
        Ok(dest)
    }

    /// Cambiar el subtítulo mientras se ve (2026-11-18): lo carga en el mpv abierto sin reiniciar
    /// y queda elegido para esa opción. `key`: `embedded:<sid>` o `proveedor:id`; `path`: el
    /// archivo ya bajado (solo de la caché de la app).
    pub async fn playback_subtitle(
        &self,
        id: crate::playback::PlaybackId,
        key: &str,
        path: Option<&str>,
    ) -> Result<()> {
        use crate::playback::LiveSubtitle;
        let sid = key
            .strip_prefix(crate::subtitles::EMBEDDED)
            .and_then(|k| k.strip_prefix(':'))
            .and_then(|n| n.parse::<i64>().ok());
        let sub = match (sid, path) {
            (Some(sid), _) => LiveSubtitle::Track(sid),
            (None, Some(path)) => LiveSubtitle::File(self.cached_file(path)?),
            (None, None) => return Err(CoreError::NotFound(format!("subtítulo {key}"))),
        };
        let video = self.playback.load_subtitle(id, sub).await?;
        crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file()).choose(
            &video,
            key,
            crate::config::SubtitleLanguage::Es,
        )?;
        Ok(())
    }

    /// Un archivo que viene de la UI, solo si está en la caché de la app (subtítulos bajados).
    pub(super) fn cached_file(&self, path: &str) -> Result<std::path::PathBuf> {
        let io = |path: &std::path::Path| {
            let path = path.to_path_buf();
            move |source| CoreError::Io { path, source }
        };
        let root = self
            .paths
            .cache_dir
            .canonicalize()
            .map_err(io(&self.paths.cache_dir))?;
        let from = std::path::Path::new(path);
        let from = from.canonicalize().map_err(io(from))?;
        if !from.starts_with(&root) || !from.is_file() {
            return Err(CoreError::NotFound(format!("subtítulo {path}")));
        }
        Ok(from)
    }

    /// Subtítulos del video abierto en el catálogo (2026-11-15; dropdown 2026-11-18): busca y baja
    /// hasta 5 de las fuentes gratis en `language` (el otro idioma completa) sin necesitar el
    /// video, por IMDb + episodio y el release de la opción `hash`. Quedan en la caché de ESE
    /// video: al analizar o reproducir se reusan. OpenSubtitles.com no entra: es Premium.
    pub async fn catalog_subtitles(
        &self,
        video_id: &str,
        hash: &InfoHash,
        language: crate::config::SubtitleLanguage,
    ) -> Result<CatalogSubtitles> {
        // El log de la búsqueda también es el progreso que ve la UI ("bajando N", "bajado …").
        let progress = Arc::new(std::sync::Mutex::new((false, 0usize, 0usize)));
        let (events, vid) = (self.events.clone(), video_id.to_string());
        let emit = {
            let progress = progress.clone();
            move || {
                let (downloading, done, total) = *progress.lock().expect("progreso");
                events.emit(CoreEvent::CatalogSubtitlesProgress {
                    video_id: vid.clone(),
                    downloading,
                    done,
                    total,
                });
            }
        };
        emit();
        let log: crate::subtitles::session::LogFn =
            Arc::new(|line| tracing::info!(target: "streamonte_core::subtitles", "{line}"));
        let on_progress: crate::subtitles::session::ProgressFn = Arc::new(move |step| {
            {
                let mut p = progress.lock().expect("progreso");
                match step {
                    crate::subtitles::session::Progress::Downloading(n) => {
                        p.0 = true;
                        p.2 += n;
                    }
                    crate::subtitles::session::Progress::Done => p.1 += 1,
                }
            }
            emit();
        });
        let (identity, _, key) = self.subtitle_identity(video_id, hash).await?;
        let got = self
            .subtitle_files(video_id, hash, language, log, Some(on_progress))
            .await?;
        Ok(CatalogSubtitles {
            found: got
                .iter()
                .map(|(cand, path)| SubtitleFound::new(cand, Some(path)))
                .collect(),
            picks: self.subtitle_picks(&key),
            timing_known: identity.fps.is_some(),
        })
    }

    /// "Usar" un subtítulo del dropdown (encontrado, Premium ya bajado o uno que trae el video):
    /// queda elegido para esa opción y el reproductor lo pone al abrirla. El anterior cuenta como
    /// probado.
    pub async fn catalog_subtitle_use(
        &self,
        video_id: &str,
        hash: &InfoHash,
        key: &str,
    ) -> Result<SubtitlePicks> {
        let (_, _, video) = self.subtitle_identity(video_id, hash).await?;
        let memory = crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file());
        let c = memory.choose(&video, key, crate::config::SubtitleLanguage::Es)?;
        Ok(SubtitlePicks {
            chosen: Some(c.subtitle),
            tried: c.tried,
        })
    }

    /// Cuota de Premium, sin pedir nada (buscar no la gasta y no la informa).
    pub async fn premium_quota(&self) -> PremiumQuota {
        use crate::subtitles::providers::{OpenSubtitlesProvider, SubtitleProvider};
        let os = OpenSubtitlesProvider::from_store();
        // Con login, la cuenta la dice siempre; sin login, se sabe recién con una descarga.
        let has_login = crate::subtitles::secrets::opensubtitles_login().is_some();
        let login_error = match os.has_key() && has_login {
            true => os.account_quota().await.err().map(|e| e.user_message()),
            false => None,
        };
        let q = os.quota().await.ok().flatten();
        PremiumQuota {
            has_key: os.has_key(),
            has_login,
            login_error,
            remaining: q.map(|q| q.remaining),
            per_day: q.map(|q| q.per_day),
            resets_at: q
                .and_then(|q| q.resets_at)
                .map(|t| t.with_timezone(&chrono::Local).format("%H:%M").to_string()),
        }
    }

    /// Busca en Premium (OpenSubtitles.com), solo en español. No gasta cuota: no baja nada.
    pub async fn catalog_premium_search(
        &self,
        video_id: &str,
        hash: &InfoHash,
    ) -> Result<Vec<SubtitleFound>> {
        use crate::subtitles::providers::{OpenSubtitlesProvider, SubtitleProvider};
        let (identity, _, _) = self.subtitle_identity(video_id, hash).await?;
        let mut found = OpenSubtitlesProvider::from_store()
            .search(&identity, crate::config::SubtitleLanguage::Es)
            .await?;
        crate::subtitles::fit_by_timing(&identity, &mut found);
        Ok(crate::subtitles::top_candidates(found, usize::MAX)
            .iter()
            .map(|c| SubtitleFound::new(c, None))
            .collect())
    }

    /// "Usar · 1" de Premium: baja ESE subtítulo (gasta 1 de la cuota), lo suma a lo guardado
    /// con el video (el reproductor lo carga) y queda elegido. Nada más se baja.
    pub async fn catalog_premium_use(
        &self,
        video_id: &str,
        hash: &InfoHash,
        pick: PremiumPick,
    ) -> Result<CatalogSubtitles> {
        use crate::subtitles::providers::{OpenSubtitlesProvider, SubtitleProvider, OPENSUBTITLES};
        let es = crate::config::SubtitleLanguage::Es;
        let (identity, cache_dir, video) = self.subtitle_identity(video_id, hash).await?;
        let cand = crate::subtitles::SubtitleCandidate {
            provider: OPENSUBTITLES,
            provider_id: pick.id.to_string(),
            release_name: pick.release_name,
            language: es,
            match_kind: pick.level,
            downloads: 0,
            variant: if pick.latino {
                crate::subtitles::SpanishVariant::Latino
            } else {
                crate::subtitles::SpanishVariant::Unknown
            },
            url: String::new(),
            fps: None,
            last_secs: None,
        };
        std::fs::create_dir_all(&cache_dir).map_err(|source| CoreError::Io {
            path: cache_dir.clone(),
            source,
        })?;
        let path = OpenSubtitlesProvider::from_store()
            .download(&cand, &cache_dir)
            .await?;
        crate::subtitles::session::add_saved(&cache_dir, es, cand.clone(), path);
        let memory = crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file());
        memory.choose(&video, &cand.key(), es)?;
        // Lo guardado ya lo incluye: se relee sin buscar.
        let log: crate::subtitles::session::LogFn =
            Arc::new(|line| tracing::info!(target: "streamonte_core::subtitles", "{line}"));
        let got = self.subtitle_files(video_id, hash, es, log, None).await?;
        Ok(CatalogSubtitles {
            found: got
                .iter()
                .map(|(c, path)| SubtitleFound::new(c, Some(path)))
                .collect(),
            picks: self.subtitle_picks(&video),
            timing_known: identity.fps.is_some(),
        })
    }

    pub(super) fn subtitle_picks(&self, video: &crate::video_key::VideoKey) -> SubtitlePicks {
        crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file())
            .get(video)
            .ok()
            .flatten()
            .map(|c| SubtitlePicks {
                chosen: Some(c.subtitle).filter(|s| !s.is_empty()),
                tried: c.tried,
            })
            .unwrap_or_default()
    }

    /// Qué video es para los subtítulos (IMDb + episodio, el release de la opción `hash` y, si
    /// esa opción ya se analizó, su duración y fps reales), la carpeta donde se guardan los del
    /// catálogo y la clave con que se recuerda lo elegido (la misma que usa la reproducción).
    pub(super) async fn subtitle_identity(
        &self,
        video_id: &str,
        hash: &InfoHash,
    ) -> Result<(
        crate::subtitles::VideoIdentity,
        std::path::PathBuf,
        crate::video_key::VideoKey,
    )> {
        let video = VideoId::parse(video_id)?;
        let c = self
            .catalog
            .candidate(&video, hash)
            .ok_or_else(|| CoreError::Catalog {
                user: "Esa opción ya no está en la lista: actualizá las opciones.".into(),
                detail: format!("candidato {hash} no encontrado"),
            })?;
        let file = c
            .file_name
            .clone()
            .unwrap_or_else(|| c.release_name.clone());
        let mut identity = crate::subtitles::VideoIdentity::for_file(
            &file,
            &c.release_name,
            *hash,
            c.size_bytes.unwrap_or(0),
        );
        identity.imdb_id = Some(video.imdb_id().to_string());
        if let Some((s, e)) = video.episode() {
            identity.season = u16::try_from(s).ok();
            identity.episode = u16::try_from(e).ok();
        }
        let live = self
            .library
            .lock()
            .await
            .of_torrent(*hash)
            .find_map(|e| e.live.clone());
        identity.duration_secs = live.as_ref().and_then(|l| l.duration_secs);
        identity.fps = live.as_ref().and_then(|l| l.fps);
        let dir = self.paths.pending_subtitles_dir(&identity.video_id(), hash);
        // La misma clave que la fila que crea Reproducir (`library::entry_key`).
        let key = crate::video_key::VideoKey::new(*hash, video.episode(), c.file_idx);
        Ok((identity, dir, key))
    }

    /// Subtítulos de esa opción de la lista (2026-11-17, compartido por el dropdown y el ▶ de
    /// TorBox): los busca y baja de las fuentes gratis (lo ya bajado sale de la caché), mejor
    /// primero.
    pub(super) async fn subtitle_files(
        &self,
        video_id: &str,
        hash: &InfoHash,
        language: crate::config::SubtitleLanguage,
        log: crate::subtitles::session::LogFn,
        progress: Option<crate::subtitles::session::ProgressFn>,
    ) -> Result<Vec<(crate::subtitles::SubtitleCandidate, std::path::PathBuf)>> {
        let (identity, cache_dir, _) = self.subtitle_identity(video_id, hash).await?;
        Ok(
            crate::subtitles::session::fetch(crate::subtitles::session::Fetch {
                video: identity,
                video_url: None,
                torrent_files: Vec::new(),
                language,
                cache_dir,
                remembered: None,
                log,
                progress,
            })
            .await,
        )
    }
}
