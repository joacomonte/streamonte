//! Catálogo: búsqueda, fichas, opciones, enjambre y addons (F4b, spec 09).

use super::*;

/// Tests de conexión guardados en los datos guardados (2026-11-17): valen una hora.
const TESTS_KEY: &str = "tests-conexion.json";
const TEST_TTL_SECS: i64 = 3600;

/// Resultado de un test de conexión (conteo del enjambre) y cuándo se hizo.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SavedTest {
    pub count: crate::analyzer::swarm::SwarmCount,
    pub at: chrono::DateTime<chrono::Utc>,
}

impl AppCore {
    /// Abre la ficha de IMDb del título en el navegador (solo ids `tt…` válidos).
    pub fn open_imdb(&self, imdb_id: &str) -> Result<()> {
        if !crate::catalog::is_imdb_id(imdb_id) {
            return Err(CoreError::NotFound(format!("ficha {imdb_id}")));
        }
        crate::external::open_external(format!("https://www.imdb.com/title/{imdb_id}/"))
            .map_err(|_| CoreError::Unsupported("abrir el navegador"))
    }

    /// Póster de TMDB para un título cuyo póster de Cinemeta no existe (2026-11-15).
    pub async fn catalog_poster(&self, imdb_id: &str) -> Option<String> {
        let timeout = self.catalog_timeout().await;
        self.catalog.poster(imdb_id, timeout).await
    }

    /// "Contar seeders reales" de opciones del catálogo (2026-11-15): se conecta al enjambre de
    /// cada una y cuenta los que ve, sin bajar el video ni sumarlo a Mis magnets. `Quick` (≤ 30 s,
    /// todas) descarta; `Deep` (~2 min, las mejores) decide la salud. Varios conteos conviven;
    /// cerrar o cambiar de video los corta todos.
    pub async fn catalog_swarm(
        &self,
        hashes: &[InfoHash],
        depth: crate::analyzer::swarm::Depth,
    ) -> std::collections::HashMap<InfoHash, crate::analyzer::swarm::SwarmCount> {
        let deep = depth == crate::analyzer::swarm::Depth::Deep;
        let cancel = self.swarm_cancel.lock().expect("swarm").clone();
        let magnets = self.catalog.magnets_of(hashes);
        let cfg = self.config.read().await.clone();
        let found = crate::analyzer::swarm::count(
            &self.paths,
            &cfg,
            self.trackers.get(),
            magnets,
            depth,
            cancel.clone(),
            {
                let events = self.events.clone();
                move |hash, count, done| {
                    events.emit(if done {
                        CoreEvent::CatalogSwarmCounted { hash, count, deep }
                    } else {
                        CoreEvent::CatalogSwarmProgress { hash, count, deep }
                    })
                }
            },
        )
        .await;
        // Cortado por el usuario: lo que no llegó no es "nadie respondió" y no se guarda. La prueba
        // rápida no se guarda: es barata y se repite al volver a abrir.
        if deep && !cancel.is_cancelled() {
            self.save_tests(hashes, &found).await;
        }
        found
    }

    /// Tests de conexión guardados (2026-11-17) de esos torrents, de la última hora.
    pub fn catalog_swarm_saved(&self, hashes: &[InfoHash]) -> HashMap<InfoHash, SavedTest> {
        let saved = self.saved_tests();
        hashes
            .iter()
            .filter_map(|h| saved.get(&h.to_hex()).map(|t| (*h, *t)))
            .collect()
    }

    pub(super) fn saved_tests(&self) -> HashMap<String, SavedTest> {
        let now = chrono::Utc::now();
        let mut map: HashMap<String, SavedTest> = self
            .data_cache
            .get(TESTS_KEY)
            .map(|(m, _)| m)
            .unwrap_or_default();
        map.retain(|_, t| (now - t.at).num_seconds() < TEST_TTL_SECS);
        map
    }

    /// Guarda el resultado de cada torrent pedido; sin resultado = nadie respondió.
    pub(super) async fn save_tests(
        &self,
        hashes: &[InfoHash],
        found: &HashMap<InfoHash, crate::analyzer::swarm::SwarmCount>,
    ) {
        let _guard = self.tests_file.lock().await;
        let at = chrono::Utc::now();
        let mut map = self.saved_tests();
        for h in hashes {
            let count = found
                .get(h)
                .copied()
                .unwrap_or(crate::analyzer::swarm::SwarmCount {
                    seeds: 0,
                    peers: 0,
                    reached: false,
                    known: 0,
                    incoming: 0,
                });
            map.insert(h.to_hex(), SavedTest { count, at });
        }
        self.data_cache.put(TESTS_KEY, &map);
    }

    /// Censo DHT de opciones del catálogo (2026-11-16): direcciones únicas por hash, sin conectarse
    /// (~12 s). Comparte el corte con `catalog_swarm`.
    pub async fn catalog_census(
        &self,
        hashes: &[InfoHash],
    ) -> std::collections::HashMap<InfoHash, u32> {
        let cancel = self.swarm_cancel.lock().expect("swarm").clone();
        let cfg = self.config.read().await.clone();
        crate::analyzer::swarm::census(&self.paths, &cfg, hashes.to_vec(), cancel).await
    }

    /// FR-36: búsqueda en Cinemeta (películas y series a la vez). Una búsqueda nueva cancela la
    /// anterior (`Cancelled`, la UI la ignora).
    pub async fn catalog_search(&self, query: &str) -> Result<Vec<MetaPreview>> {
        let timeout = self.catalog_timeout().await;
        self.catalog.search(query, timeout).await
    }

    /// Actores y directores que coinciden con lo que se escribe en el buscador (vacío sin key de TMDB).
    pub async fn catalog_people(&self, query: &str) -> Result<Vec<crate::catalog::people::Person>> {
        let timeout = self.catalog_timeout().await;
        let titles = self.languages().await.titles;
        self.catalog.people(query, titles, timeout).await
    }

    /// Lo que actuó o dirigió la persona elegida en las sugerencias (necesita la key de TMDB).
    pub async fn catalog_person_titles(
        &self,
        id: u64,
        role: crate::catalog::people::Role,
    ) -> Result<Vec<MetaPreview>> {
        let timeout = self.catalog_timeout().await;
        let titles = self.languages().await.titles;
        self.catalog.person_titles(id, role, titles, timeout).await
    }

    /// Puntaje promedio por temporada de una serie (IMDb) y su estado.
    pub async fn catalog_season_ratings(
        &self,
        imdb_id: &str,
        quick: bool,
    ) -> Result<crate::catalog::seasons::SeasonRatings> {
        let timeout = self.catalog_timeout().await;
        self.catalog.season_ratings(imdb_id, quick, timeout).await
    }

    /// Puntaje de IMDb de cada capítulo de una temporada.
    pub async fn catalog_episode_ratings(
        &self,
        imdb_id: &str,
        season: u32,
    ) -> Result<Vec<crate::catalog::episode_ratings::EpisodeScore>> {
        let timeout = self.catalog_timeout().await;
        self.catalog.episode_ratings(imdb_id, season, timeout).await
    }

    /// Los bytes de un póster (la UI lee su color predominante).
    pub async fn catalog_image(&self, url: &str) -> Result<Vec<u8>> {
        let timeout = self.catalog_timeout().await;
        self.catalog.image(url, timeout).await
    }

    /// Premios de un título (IMDb): totales y el detalle de los grandes.
    pub async fn catalog_awards(
        &self,
        imdb_id: &str,
    ) -> Result<crate::catalog::awards::TitleAwards> {
        let timeout = self.catalog_timeout().await;
        self.catalog.awards(imdb_id, timeout).await
    }

    /// Explorar sin key de TMDB: en tendencia ahora.
    pub async fn catalog_trending(&self, kind: MediaKind, skip: u32) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        self.catalog.trending(kind, skip, timeout).await
    }

    /// Explorar con los filtros de IMDb (votos, idiomas); necesita la key de TMDB.
    #[allow(clippy::too_many_arguments)]
    pub async fn catalog_browse_top(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        from: &str,
        to: Option<&str>,
        min_votes: u32,
        languages: Vec<String>,
    ) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        let titles = self.languages().await.titles;
        self.catalog
            .browse_top(kind, sort, from, to, min_votes, languages, titles, timeout)
            .await
    }

    /// Explorar con un género elegido: búsqueda por subgéneros de IMDb (sin key de TMDB).
    #[allow(clippy::too_many_arguments)]
    pub async fn catalog_browse_interests(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        from: &str,
        to: Option<&str>,
        min_votes: u32,
        languages: Vec<String>,
        interests: Vec<String>,
    ) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        let titles = self.languages().await.titles;
        self.catalog
            .browse_interests(
                kind, sort, from, to, min_votes, languages, interests, titles, timeout,
            )
            .await
    }

    /// Ejemplos populares de cada subgénero de IMDb (tarjetas del filtro de géneros).
    pub async fn catalog_interest_examples(
        &self,
        kind: MediaKind,
        ids: Vec<String>,
    ) -> Result<std::collections::HashMap<String, Vec<crate::catalog::interests::Example>>> {
        let timeout = self.catalog_timeout().await;
        self.catalog.interest_examples(kind, ids, timeout).await
    }

    /// Títulos y sinopsis de los episodios de una temporada en los idiomas elegidos (vacío sin key de TMDB).
    pub async fn catalog_episodes(
        &self,
        imdb_id: &str,
        season: u32,
    ) -> Vec<crate::catalog::tmdb::EpisodeText> {
        let timeout = self.catalog_timeout().await;
        let langs = self.languages().await;
        self.catalog.episodes(imdb_id, season, langs, timeout).await
    }

    /// Datos de TMDB para el panel (2026-11-17); sin key, `has_key = false`.
    pub async fn catalog_details(
        &self,
        kind: MediaKind,
        imdb_id: &str,
    ) -> crate::catalog::tmdb::DetailsView {
        let timeout = self.catalog_timeout().await;
        let langs = self.languages().await;
        self.catalog.details(kind, imdb_id, langs, timeout).await
    }

    /// Similares de TMDB del título, al abrir "Similares" en el panel (2026-11-17).
    pub async fn catalog_similar(
        &self,
        kind: MediaKind,
        imdb_id: &str,
    ) -> Vec<crate::catalog::tmdb::Similar> {
        let timeout = self.catalog_timeout().await;
        let titles = self.languages().await.titles;
        self.catalog.similar(kind, imdb_id, titles, timeout).await
    }

    /// FR-38/39: ficha de película o serie (con episodios).
    pub async fn catalog_meta(&self, kind: MediaKind, id: &str) -> Result<Meta> {
        let timeout = self.catalog_timeout().await;
        self.catalog.meta(kind, id, timeout).await
    }

    /// FR-42: pide streams a todos los addons habilitados; llegan por `CatalogStreams`.
    /// Cambiar de video cancela la consulta anterior. Los seeders reales llegan solos (scrape).
    /// Las pruebas de conexión del video anterior siguen (2026-11-17): la UI pregunta si cortarlas
    /// ([`Self::catalog_stop_swarm`]).
    pub async fn catalog_streams(&self, kind: MediaKind, video_id: &str) -> Result<()> {
        let cfg = self.config.read().await.clone();
        let events = self.events.clone();
        self.catalog
            .streams(&cfg, self.trackers.get(), kind, video_id, move |update| {
                events.emit(CoreEvent::CatalogStreams { update });
            })
    }

    /// "Detener" el análisis profundo (2026-11-16): corta los conteos de enjambre en curso; la
    /// consulta de fuentes sigue.
    pub fn catalog_stop_swarm(&self) {
        std::mem::take(&mut *self.swarm_cancel.lock().expect("swarm")).cancel();
    }

    /// Cerrar la ficha / volver a buscar: corta la consulta en curso. Las pruebas de conexión no
    /// (2026-11-17): la UI pregunta si seguir de fondo.
    pub fn catalog_stop_streams(&self) {
        self.catalog.stop_streams();
    }

    /// Candidatos → filas de la biblioteca con `origin` (spec 09 §8.1), sin analizar ("Reproducir"
    /// desde el catálogo las agrega así y las reproduce con [`Self::play`]). No pasa por el
    /// análisis automático "al pegar": desde el catálogo solo se mide lo que el usuario elige.
    pub async fn catalog_add(
        &self,
        kind: MediaKind,
        video_id: &str,
        hashes: &[InfoHash],
    ) -> Result<Vec<LibraryRowView>> {
        let video = VideoId::parse(video_id)?;
        let timeout = self.catalog_timeout().await;
        let meta = self.catalog.meta(kind, video.imdb_id(), timeout).await.ok();
        let trackers = self.config.read().await.all_trackers(&self.trackers.get());
        let mut library = self.library.lock().await;
        let mut added = Vec::new();
        for hash in hashes {
            let pick = self.catalog.pick(&video, hash, meta.as_ref(), &trackers)?;
            // Una fila por episodio: agregar S3E2 no pisa la fila de S3E1 del mismo pack.
            let key = library.add_from_catalog(
                &pick.magnet,
                &pick.magnet.to_uri(),
                pick.origin,
                pick.size_bytes,
            );
            library.emit_rows(&[key], self.events.as_ref());
            if let Some(entry) = library.get(&key) {
                added.push(library.view(entry));
            }
        }
        Ok(added)
    }

    /// Ajustes → Fuentes (FR-41).
    pub async fn catalog_addons(&self) -> Vec<AddonView> {
        self.config
            .read()
            .await
            .catalog
            .addons
            .iter()
            .map(AddonView::from)
            .collect()
    }

    /// "Agregar addon": valida el manifest; URL con configuración → almacén seguro (NFR-22).
    /// El manifest se pide (hasta 10 s) SIN el lock de la config: mientras tanto otros ajustes
    /// se guardan normalmente y el alta solo agrega su fila a la config de ese momento.
    pub async fn catalog_add_addon(&self, url: &str) -> Result<AddonView> {
        let _one_at_a_time = self.adding_addon.lock().await;
        let existing = self.config.read().await.catalog.addons.clone();
        let entry = self.catalog.new_addon(url, &existing).await?;
        let view = AddonView::from(&entry);
        self.update_config(|c| {
            c.catalog.addons.push(entry);
            Ok(())
        })
        .await?;
        Ok(view)
    }

    pub async fn catalog_remove_addon(&self, id: &str) -> Result<()> {
        let own = self
            .config
            .read()
            .await
            .catalog
            .addons
            .iter()
            .any(|a| a.id == id && a.kind != crate::config::SourceKind::Stremio);
        if own {
            return Err(CoreError::Catalog {
                user: "Esta fuente viene con la app: no se quita, apagala.".into(),
                detail: format!("fuente propia {id}"),
            });
        }
        let entry = self
            .update_config(|c| {
                let pos = c.catalog.addons.iter().position(|a| a.id == id);
                let pos = pos.ok_or_else(|| CoreError::NotFound(format!("addon {id}")))?;
                Ok(c.catalog.addons.remove(pos))
            })
            .await?;
        // Después de guardar: si no se pudo, la URL secreta sigue en el almacén.
        self.catalog.forget_addon(&entry);
        Ok(())
    }

    pub async fn catalog_set_addon_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.update_config(|c| {
            let entry = c.catalog.addons.iter_mut().find(|a| a.id == id);
            entry
                .ok_or_else(|| CoreError::NotFound(format!("addon {id}")))?
                .enabled = enabled;
            Ok(())
        })
        .await
    }

    /// "Restaurar lista por defecto" (spec 09 §9).
    pub async fn catalog_reset_addons(&self) -> Result<Vec<AddonView>> {
        let old = self
            .update_config(|c| {
                Ok(std::mem::replace(
                    &mut c.catalog.addons,
                    crate::config::default_addons(),
                ))
            })
            .await?;
        for entry in &old {
            self.catalog.forget_addon(entry);
        }
        Ok(self.catalog_addons().await)
    }

    pub(super) async fn catalog_timeout(&self) -> Duration {
        Duration::from_millis(self.config.read().await.catalog.timeout_ms)
    }

    pub(super) async fn languages(&self) -> crate::config::LanguageConfig {
        self.config.read().await.language
    }
}
