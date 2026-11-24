//! TorBox: opciones por TorBox, pistas, links y descargas.

use super::*;

impl AppCore {
    /// Cuáles de esas opciones (de la lista vigente) ya están en la caché de TorBox (2026-11-17).
    /// `None` = sin key de TorBox (o código) o no respondió. Error: el código de la web rechazado.
    pub async fn catalog_torbox(
        &self,
        video_id: &str,
        hashes: &[InfoHash],
    ) -> Result<Option<crate::catalog::torbox::Cached>> {
        let timeout = self.catalog_timeout().await;
        self.catalog.torbox_cached(video_id, hashes, timeout).await
    }

    /// ▶ desde TorBox (2026-11-17): abre el reproductor con el link directo de TorBox (sin P2P ni
    /// motor). No queda en "Descargas": es un video en línea.
    pub async fn play_torbox(
        &self,
        video_id: &str,
        hash: InfoHash,
        player: Option<crate::config::PlayerKind>,
        audio: Option<crate::audio::AudioPick>,
    ) -> Result<crate::playback::PlaybackId> {
        use crate::config::PlayerKind;
        let timeout = self
            .catalog_timeout()
            .await
            .max(std::time::Duration::from_secs(20));
        let (url, title) = self.catalog.torbox_stream(hash, timeout).await?;
        let cfg = self.config.read().await.clone();
        let kind = crate::player::resolve_player(player, &cfg.player);
        // Lo elegido en el paso de subtítulos de Reproducir (por opción, como la reproducción
        // por torrent): una pista del video se elige con `--sid`; un archivo va solo (mpv muestra
        // el único `--sub-file`). Sin elegir: los ya bajados, mejor primero.
        let (_, _, key) = self.subtitle_identity(video_id, &hash).await?;
        let chosen = crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file())
            .get(&key)
            .ok()
            .flatten()
            .map(|c| c.subtitle)
            .filter(|s| !s.is_empty() && s != crate::subtitles::CHOICE_ALL);
        let mut extra_args = Vec::new();
        let embedded = chosen.as_deref().and_then(|c| {
            c.strip_prefix(crate::subtitles::EMBEDDED)?
                .strip_prefix(':')
        });
        let subtitle_files = if let Some(sid) = embedded {
            extra_args.push(format!("--sid={sid}"));
            Vec::new()
        } else {
            let log: crate::subtitles::session::LogFn =
                Arc::new(|line| tracing::info!(target: "streamonte_core::subtitles", "{line}"));
            let got = self
                .subtitle_files(video_id, &hash, cfg.subtitles.language, log, None)
                .await
                .inspect_err(|e| tracing::warn!("subtítulos de la reproducción: {e}"))
                .unwrap_or_default();
            match got.iter().find(|(c, _)| Some(c.key()) == chosen) {
                Some((_, path)) => vec![path.clone()],
                None => got.into_iter().map(|(_, path)| path).collect(),
            }
        };
        // Audio elegido (como en la reproducción por torrent: solo mpv entiende estos argumentos).
        if let Some(a) = audio.filter(|_| kind == PlayerKind::Mpv) {
            extra_args.extend(a.mpv_args());
        }
        // La misma "reproducción en curso" que la del motor: fila, Detener y cambiar subtítulo.
        self.playback
            .start_stream(crate::playback::StreamRequest {
                key,
                name: title,
                url,
                player: kind,
                subtitle_files,
                extra_args,
            })
            .await
    }

    /// Pistas de una opción que se va a ver por TorBox (2026-11-18): mpv sin ventana lee audio,
    /// subtítulos, fps y duración del mismo link https que va a abrir (el video ya está en sus
    /// servidores; contar el enjambre no hace falta). Quedan en la fila como las del análisis, así
    /// el paso de audio y el de subtítulos de Reproducir las usan; los `sid` son los mismos que
    /// verá mpv al reproducir ese link. Como "Verificar salud", la opción pasa a la biblioteca si no
    /// estaba: lo leído es del torrent y se guarda en su fila (sin fila se perdía, 2026-11-18).
    pub async fn catalog_torbox_tracks(
        &self,
        kind: MediaKind,
        video_id: &str,
        hash: InfoHash,
    ) -> Result<()> {
        // Un REMUX de 50+ GB tarda en dar el primer byte desde TorBox: 30 s cortaba lecturas que iban a andar.
        const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
        let timeout = self
            .catalog_timeout()
            .await
            .max(std::time::Duration::from_secs(20));
        let started = std::time::Instant::now();
        tracing::info!("pistas por TorBox ({hash}): empieza");
        // El encabezado del MKV (el primer MB, segundos; como la web); si no es MKV y hay link (key propia), mpv.
        let (header, url, title) = self
            .catalog
            .torbox_header_tracks(hash, timeout)
            .await
            .inspect_err(|e| {
                tracing::warn!(
                    "pistas por TorBox ({hash}): falló en {:.1}s: {e}",
                    started.elapsed().as_secs_f32()
                )
            })?;
        tracing::info!(
            "pistas por TorBox ({hash}): encabezado {} en {:.1}s",
            header.as_ref().map_or("sin leer".to_string(), |t| format!(
                "con {} pistas",
                t.len()
            )),
            started.elapsed().as_secs_f32()
        );
        let probe = match (header, url) {
            (Some(tracks), _) => crate::catalog::mkv::probe_of(&tracks),
            (None, Some(url)) => {
                let mpv_path = self.config.read().await.player.mpv_path.clone();
                let mpv = crate::paths::find_executable(
                    crate::paths::Executable::Mpv,
                    mpv_path.as_deref(),
                )
                .ok_or_else(|| CoreError::Player("no hay mpv para leer las pistas".into()))?;
                let p = crate::player::probe_media(&mpv, &url, PROBE_TIMEOUT)
                    .await
                    .inspect_err(|e| tracing::warn!("leer pistas por TorBox ({hash}): {e}"))?;
                (Some(p.duration_secs), p.audio, p.subs, p.fps)
            }
            (None, None) => {
                tracing::warn!(
                    "leer pistas por TorBox ({hash}): la web no pudo leer el encabezado"
                );
                return Err(CoreError::Catalog {
                    user: "No pude leer las pistas de este video.".into(),
                    detail: "pistas por la web: sin encabezado MKV".into(),
                });
            }
        };
        if !self.library.lock().await.has_torrent(&hash) {
            self.catalog_add(kind, video_id, &[hash]).await?;
        }
        let video = VideoId::parse(video_id)?;
        let candidate = self.catalog.candidate(&video, &hash);
        let mut library = self.library.lock().await;
        let keys = library.record_probe(&hash, &probe, &title, candidate.as_ref());
        library.emit_rows(&keys, self.events.as_ref());
        Ok(())
    }

    /// Link de una opción para copiar: magnet o, por TorBox, el de castear (HLS con el audio original o latino).
    pub async fn catalog_link(
        &self,
        hash: InfoHash,
        torbox: bool,
        orig: Option<String>,
        latino: bool,
    ) -> Result<String> {
        if torbox {
            let timeout = self
                .catalog_timeout()
                .await
                .max(std::time::Duration::from_secs(20));
            return self
                .catalog
                .torbox_cast(hash, orig.as_deref(), latino, timeout)
                .await;
        }
        self.catalog
            .magnets_of(&[hash])
            .into_iter()
            .next()
            .map(|m| m.to_uri())
            .ok_or_else(|| CoreError::NotFound("esa opción ya no está en la lista".into()))
    }

    /// "Pegar magnet" con TorBox (2026-11-20): si lo tiene en caché, se baja o ya está en la cuenta, con
    /// sus videos; `who` también reconoce la película o serie por el nombre (`dn`) en TMDB.
    pub async fn torbox_magnet(
        &self,
        hash: InfoHash,
        name: &str,
        who: bool,
    ) -> Result<(
        crate::catalog::torbox::MagnetStatus,
        Option<crate::catalog::tmdb::Identified>,
    )> {
        let timeout = self.catalog_timeout().await;
        let status =
            crate::catalog::torbox::magnet_status(&self.catalog.http, hash, timeout).await?;
        let titles = self.languages().await.titles;
        let named = status
            .name
            .as_deref()
            .filter(|n| !n.is_empty())
            .unwrap_or(name);
        let ident = if who {
            self.catalog.identify(named, titles, timeout).await
        } else {
            None
        };
        Ok((status, ident))
    }

    /// "Bajarlo en TorBox": lo agrega a la cuenta aunque no esté en caché; devuelve el estado nuevo.
    pub async fn torbox_magnet_download(
        &self,
        hash: InfoHash,
        name: &str,
    ) -> Result<crate::catalog::torbox::MagnetStatus> {
        let timeout = self.catalog_timeout().await;
        let mut magnet = format!("magnet:?xt=urn:btih:{}", hash.to_hex());
        if !name.is_empty() {
            magnet.push_str(&format!(
                "&dn={}",
                crate::catalog::protocol::encode_extra(name)
            ));
        }
        crate::catalog::torbox::magnet_download(&self.catalog.http, &magnet, timeout).await?;
        crate::catalog::torbox::magnet_status(&self.catalog.http, hash, timeout).await
    }
}
