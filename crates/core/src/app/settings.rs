//! Ajustes: configuración, claves, limpieza, caché de datos y logs.

use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct TempUsage {
    pub bytes: u64,
    pub folder: String,
}

/// ¿Hay API key guardada para este proveedor de subtítulos? (Ajustes, F4).
#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyStatus {
    pub service: String,
    pub configured: bool,
}

impl AppCore {
    // ----- Limpieza (FR-18–20) -----
    /// Cuánto liberaría "Limpiar temporales" (para la confirmación, FR-19).
    pub fn temp_usage(&self) -> Result<TempUsage> {
        Ok(TempUsage {
            bytes: self.cleanup.temp_size(&self.playback.active_dirs())?,
            folder: self.paths.downloads_dir().display().to_string(),
        })
    }

    /// "Limpiar temporales" (FR-19): nunca toca reproducciones activas ni el historial. Lo
    /// analizado de los magnets de la lista SÍ se borra (decidido), salvo lo que se esté midiendo.
    pub fn clean_temp(&self) -> Result<CleanupReport> {
        self.cleanup.clean(&self.playback.active_dirs())
    }

    /// Velocidad de internet de la red actual: la guardada (salvo `force`) o la mide, con progreso
    /// en `CoreEvent::SpeedTest`.
    pub async fn speed_test(&self, force: bool) -> Result<crate::speedtest::SpeedResult> {
        self.speed_test.run(force, self.events.as_ref()).await
    }

    /// Lo que ocupa la caché de datos (fichas, puntajes, datasets de IMDb).
    pub fn data_cache_size(&self) -> u64 {
        self.data_cache.size()
    }

    /// "Borrar datos guardados": todo lo de la caché de datos. Devuelve los bytes liberados.
    /// Lo ya cargado en esta sesión sigue en memoria hasta cerrar la app.
    pub fn clear_data_cache(&self) -> Result<u64> {
        self.data_cache.clear()
    }

    pub fn open_downloads_folder(&self) -> Result<()> {
        crate::cleanup::open_in_file_manager(&self.paths.downloads_dir())
    }

    // ----- Logs (panel de actividad, 2026-11-15) -----
    /// Últimas `max` líneas del log general (el detallado, con niveles), del archivo más nuevo.
    pub fn logs_tail(&self, max: usize) -> Result<Vec<String>> {
        let Some(file) = newest_log(&self.paths.log_dir) else {
            return Ok(Vec::new());
        };
        let text = std::fs::read_to_string(&file).map_err(|source| CoreError::Io {
            path: file.clone(),
            source,
        })?;
        let lines: Vec<&str> = text.lines().collect();
        Ok(lines[lines.len().saturating_sub(max)..]
            .iter()
            .map(|l| l.to_string())
            .collect())
    }

    /// "Descargar logs": copia los logs (y lo que vio el usuario en el panel, `friendly`) a una
    /// carpeta nueva en Descargas y la muestra en el Finder / Explorador. Devuelve la carpeta.
    pub fn export_logs(&self, friendly: &str) -> Result<std::path::PathBuf> {
        let base = directories::UserDirs::new()
            .and_then(|u| u.download_dir().map(|d| d.to_path_buf()))
            .ok_or(CoreError::Unsupported("carpeta de Descargas"))?;
        let dest = base.join(format!(
            "streamonte-logs-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        let io = |path: &std::path::Path| {
            let path = path.to_path_buf();
            move |source| CoreError::Io { path, source }
        };
        std::fs::create_dir_all(&dest).map_err(io(&dest))?;
        let entries = std::fs::read_dir(&self.paths.log_dir).map_err(io(&self.paths.log_dir))?;
        for entry in entries.flatten() {
            let from = entry.path();
            // Los de diagnóstico vacíos no aportan nada.
            if from.is_file() && entry.metadata().is_ok_and(|m| m.len() > 0) {
                let to = dest.join(entry.file_name());
                std::fs::copy(&from, &to).map_err(io(&to))?;
            }
        }
        let activity = dest.join("actividad.txt");
        std::fs::write(&activity, friendly).map_err(io(&activity))?;
        crate::cleanup::open_in_file_manager(&dest)?;
        Ok(dest)
    }

    // ----- Configuración (NFR-04, Q-06) -----
    pub async fn config(&self) -> Config {
        self.config.read().await.clone()
    }

    /// ÚNICA escritura de la config: con el lock de escritura tomado aplica `change` a una copia,
    /// la guarda (atómico) y recién entonces la publica y la propaga (logger, semáforo). Dos
    /// cambios a la vez se ponen en fila y ninguno pisa al otro; si `change` falla o no se puede
    /// guardar, no cambia nada. Nada lento adentro: lo que va a la red se hace antes.
    pub async fn update_config<T>(
        &self,
        change: impl FnOnce(&mut Config) -> Result<T>,
    ) -> Result<T> {
        let mut current = self.config.write().await;
        let mut next = current.clone();
        let out = change(&mut next)?;
        self.config_store.save(&next)?;
        *current = next;
        crate::logger::apply(&current.logging)?;
        self.library
            .lock()
            .await
            .set_ranking(current.ranking.clone());
        Ok(out)
    }

    /// Ajustes → Red (ADR-30): entrantes / UPnP. Aplica desde la próxima reproducción.
    /// "Verificar" en Ajustes › Red: ¿el puerto de las reproducciones llega desde internet?
    pub async fn check_incoming(&self) -> crate::incoming::IncomingCheck {
        let engine = self.config.read().await.engine.clone();
        crate::incoming::check(&engine, &self.paths).await
    }

    /// Ecualizador del reproductor (Ajustes, 2026-11-17): rige desde la próxima reproducción.
    /// `intensity` en % (se recorta a 0–150).
    pub async fn set_equalizer(
        &self,
        equalizer: crate::config::Equalizer,
        intensity: u8,
    ) -> Result<()> {
        self.update_config(|c| {
            c.player.equalizer = equalizer;
            c.player.equalizer_intensity = intensity.min(crate::config::EQ_MAX_INTENSITY);
            Ok(())
        })
        .await
    }

    /// Idiomas de la app y de los títulos (Ajustes y bienvenida, 2026-11-20): lo de TMDB se pide en ellos.
    pub async fn set_language(&self, language: crate::config::LanguageConfig) -> Result<()> {
        self.update_config(|c| {
            c.language = language;
            Ok(())
        })
        .await
    }

    pub async fn set_network(
        &self,
        incoming: bool,
        upnp: bool,
        announce_early: bool,
    ) -> Result<()> {
        self.update_config(|c| {
            c.engine.incoming = incoming;
            c.engine.upnp = upnp;
            c.engine.announce_early = announce_early;
            Ok(())
        })
        .await
    }

    // ----- Subtítulos (FR-24, Q-01, Q-04, NFR-16) -----
    /// Guarda la API key de un proveedor ("opensubtitles" o "wyzie") en el almacén seguro del
    /// sistema; vacía = borrarla. Nunca va a `config.json` ni a los logs.
    /// API keys de servicios (Ajustes): subtítulos (Wyzie, OpenSubtitles) y pósters (TMDB).
    /// Se guardan en el almacén seguro; nunca se devuelven ni se loguean.
    pub fn set_api_key(&self, service: &str, key: &str) -> Result<()> {
        match service {
            crate::catalog::tmdb::TMDB => crate::catalog::tmdb::set_key(key),
            crate::catalog::torbox::TORBOX => crate::catalog::torbox::set_key(key),
            crate::catalog::latteam::LATTEAM => crate::catalog::latteam::set_key(key),
            provider => crate::subtitles::secrets::set_api_key(provider, key),
        }
    }

    /// Qué servicios tienen key (Ajustes), sin devolver nunca la key.
    pub fn api_keys(&self) -> Vec<ApiKeyStatus> {
        let subtitles = crate::subtitles::secrets::KEY_PROVIDERS
            .iter()
            .map(|p| ApiKeyStatus {
                service: (*p).to_string(),
                configured: crate::subtitles::secrets::has_api_key(p),
            });
        subtitles
            .chain([
                ApiKeyStatus {
                    service: crate::catalog::tmdb::TMDB.to_string(),
                    configured: crate::catalog::tmdb::has_key(),
                },
                ApiKeyStatus {
                    service: crate::catalog::torbox::TORBOX.to_string(),
                    configured: crate::catalog::torbox::has_key(),
                },
                ApiKeyStatus {
                    service: crate::catalog::latteam::LATTEAM.to_string(),
                    configured: crate::catalog::latteam::has_key(),
                },
            ])
            .collect()
    }

    /// Abre en el navegador la página para pedir la key de un servicio (solo URLs fijas, NFR-16).
    pub fn open_key_page(&self, service: &str) -> Result<()> {
        let url = match service {
            crate::catalog::tmdb::TMDB => Some(crate::catalog::tmdb::KEY_PAGE),
            crate::catalog::torbox::TORBOX => Some(crate::catalog::torbox::KEY_PAGE),
            crate::catalog::latteam::LATTEAM => Some(crate::catalog::latteam::KEY_PAGE),
            provider => crate::subtitles::secrets::key_page(provider),
        }
        .ok_or_else(|| CoreError::NotFound(format!("servicio {service}")))?;
        crate::external::open_external(url)
            .map_err(|_| CoreError::Unsupported("abrir el navegador"))
    }

    /// Usuario y contraseña de OpenSubtitles.com (Ajustes; vacíos = borrar). Al almacén seguro.
    pub fn set_opensubtitles_login(&self, username: &str, password: &str) -> Result<()> {
        crate::subtitles::secrets::set_opensubtitles_login(username, password)
    }

    /// Reproductores de este equipo (Ajustes → Reproductor, 2026-11-17).
    pub async fn players_status(&self) -> crate::player::PlayersStatus {
        crate::player::players_status(&self.config.read().await.player)
    }

    /// Espacio libre (bytes) del disco donde se guardan las descargas; `None` si no se pudo leer.
    pub fn downloads_free_bytes(&self) -> Option<u64> {
        let dir = self.paths.downloads_dir();
        let dir = dir.canonicalize().unwrap_or(dir);
        let disks = sysinfo::Disks::new_with_refreshed_list().ok()?;
        disks
            .iter()
            .filter(|d| dir.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len())
            .map(|d| d.available_space())
    }
}
