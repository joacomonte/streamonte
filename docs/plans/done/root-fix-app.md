# root-fix — toda la app tstream-v2

Alcance: todo (crates/core, src-tauri, ui, engines/webtorrent-sidecar, examples, tests).
Base: commit b2b5d1a (único). Sin mem ni specs locales (spec original en C:\Users\Monti\bin\tstream-v2-spec\, no disponible).
Bugs confirmados: se corrigen directo; dudosos o con cambio de UX se preguntan.

## Estado
- [x] Fase 0 alcance
- [x] Fase 1 auditoría (7 agentes Opus) — 103 hallazgos, sin verificar aún
- [x] Fase 2
- [x] Fase 3
- [x] Fase 4 (sin probar en la app real)

## Particiones
1. playback.rs, player.rs, mpv_ipc.rs, preload.rs
2. analyzer.rs, ranking.rs, trackers.rs, magnet.rs
3. engine/ + engines/webtorrent-sidecar/
4. catalog/
5. subtitles.rs + subtitles/
6. app.rs, library.rs, cleanup.rs, config.rs, clipboard.rs, activity.rs, audio.rs, paths.rs, fsutil.rs, storage.rs, events.rs, error.rs, logger.rs, lib.rs, tests/, examples/
7. src-tauri/src + ui/

## Hallazgos
(pendiente)

### P1 playback/player/mpv/preload (recibido)
1 BUG N3 start no atómico (pause_active no espera teardown; take_kept antes de slot_to_kept; doble ▶ → 2 motores) playback.rs:256-345
2 BUG N1 engine.stats sin timeout en select! arm playback.rs:786,857
3 BUG N2 exit status mpv ignorado → AskAfterClose en crash playback.rs:784,811
4 BUG N1 claim() falla tras launch → mpv huérfano playback.rs:748
5 BUG N1 preload pending solo por eventos; usar stats preload.rs:159
6 BUG N2 calibration speed_factor en Config → lost update con set_config playback.rs:1145
7 BUG N2 Pause/ResumeDownload fuerzan estado playback.rs:425
8 BUG N1 KeepDownloading notify_one en cualquier estado playback.rs:440
9 BUG N1 socket mpv no se borra en macOS (SIGKILL) player.rs:322
10 N1 todo!("F5") ensure_app_profile sin callers player.rs:208
11 N1 probe_duration sin callers player.rs:219
12 DUP N2 spawn mpv duplicado player.rs:118/254
13 N2 mpv_ipc command sin timeout propio
14 RESP N3 split playback.rs + Slot::transition

### P5 subtitles (recibido)
1 BUG N1 SEC key Wyzie en error text de reqwest → logs/UI providers.rs:74,78,753,759 (usar without_url)
2 BUG N1 parse_srt split "\n\n" pierde cues merge.rs:112
3 BUG N1 extract_if_archive no limpia work en error/cancel providers.rs:244
4 BUG N1 save no atómico (analyzer y session comparten cache) providers.rs:194, session.rs:564
5 BUG N3 quota OpenSubtitles nunca aplica (provider recreado; 406 no setea 0) providers.rs:863-1007
6 DUP N2 HTTP propio sin límite tamaño/429; fetch_range no exige 206 providers.rs:43-87,165
7 PATCH N2 decisiones por string ("HTTP 404", nombre provider) providers.rs:657,106
8 BUG N2 memoria FR-28 sin idioma → sub ES en sesión EN subtitles.rs:453, session.rs:257,519
9 DUP N1 mapeo de idioma repetido (session/providers/analyzer)
10 RESP N2 parse_release_name fuera de subtitles + VideoIdentity::for_file (playback.rs:1357 / analyzer.rs:914)
11 DUP N2 detección Latino/Castellano doble (providers.rs:300 vs audio.rs:152)
12 DUP N1 formato de sub decidido en 4 lugares
13 RESP N2 secrets.rs genérico dentro de subtitles
14 N1 muerto: AutoSync/SyncReference (F7) — solo mencionar
15 ROBUST N1 JoinSet corta en primer panic; sub-delay pisa ajuste Z/X session.rs:434,469,372

### P7 src-tauri + ui (recibido)
1 BUG N1 comandos sync pesados en main thread (clean_temp, temp_usage, keyring, open_*) commands.rs:184-220
2 BUG N2 confirmDialog compartido: 2da llamada pisa la 1ra (ask-after-close doble, X doble) app.js:75, lib.rs:51
3 BUG N1 refreshLibrary sin seq → fila fantasma app.js:97
4 BUG N1 openMeta sin seq catalog.js:152
5 BUG/DUP N3 UI recalcula veredicto con 1.5/1 fijos ≠ core ranking.rs:131 app.js:519
6 BUG N1 atajos F5/Enter/Ctrl+V anunciados sin handler app.js:922 index.html:18
7 ROBUST N1 log en vivo sin tope + join cuadrático app.js:1464
8 ROBUST N1 rowCache borrado sin mqStop app.js:1443
9 PATCH N3 library-entry-updated incompleto → scheduleRefresh/ordered/??= app.js:1436
10 DUP N2/N3 rowAnalysis 8 kinds + 6 includes app.js:335-904
11 DUP N3 prioridad idiomas audio en UI + replace de label del core app.js:453,1148
12 DUP N2 format/dom helpers duplicados app/catalog
13 ROBUST N3 config read-modify-write entero desde UI app.js:1342 catalog.js:579
14 RESP N2 open_key_page lógica en shell; confirm-close fuera de CoreEvent
15 N1 typedefs viejos api.js, headers huérfanos, "Windows" en macOS, capability core:default

### P4 catalog (recibido)
1 BUG N1 SEC URL con key en FetchError::Network (reqwest Display) → log addons.rs:93 http.rs:122 (without_url)
2 BUG N3 find_excluded 40 metas sin cancelar ni tope → búsqueda siguiente timeout + anime no excluido mod.rs:219
3 BUG N1 dedup addon no ve entradas secretas → addon-2 duplicado mod.rs:310
4 DUP N2 idioma por nombre: audio::from_name vs normalize::languages con respuestas opuestas; collapse_spanish aggregate.rs:158
5 BUG N2 CAM falso por título ("Cam (2018)") o extensión .ts normalize.rs:195
6 BUG N2 CAM por stream no por hash; merge no determinista por addon_rank aggregate.rs:73,139
7 ROBUST N3 panic en addon → pending nunca 0 loop infinito; scrapes spawn sueltos; dedup sin sort aggregate.rs:226-346
8 BUG N2 start_streams aborta después de limpiar latest mod.rs:271
9 N1 timeouts 30s hardcoded inertes addons.rs:62,90
10 PATCH N2 spain_flag_is_generic por nombre addons.rs:97
11 BUG N1 redact pierde puerto; query ?key= no se trata como secreto http.rs:176
12 ROBUST N1 protocol no lenient en resources/adult protocol.rs:27
13 ROBUST N1 connect timeout no reintenta; Retry-After HTTP-date http.rs:118,133
14 RESP N2 normalize::parse gigante; library arma Stream falso → release_tags()
15 N1/N2 MediaKind redundante, fetch_error hardcode, description perdida, keyring sync en async

### P6 core app/library/cleanup/config (recibido)
1 BUG N3 config read-modify-write sin exclusión (set_config, catalog_add_addon con fetch, record_calibration 2do ConfigStore) app.rs:455,691 playback.rs:1176 → update_config(|c|)
2 BUG N1 diag logs rolling::never sin tope logger.rs:74
3 BUG N1 macOS clipboard lee texto cada 500ms aunque changeCount no cambie clipboard.rs:495
4 BUG N3 DECISIÓN pausadas/análisis en $TMPDIR (macOS/Windows purgan) paths.rs:28,88 — choque spec04 vs FR-12
5 DUP/BUG N2 dirs protegidos decididos en 4 lugares; Limpiar temporales borra análisis (FR-06d?) app.rs:144,348,408,437 — confirmar intención
6 BUG N1 dir_size usa len() (sparse) → usar allocated_bytes cleanup.rs:324
7 ROBUST N1 write_json_atomic sin fsync + tmp fijo fsutil.rs:44
8 ROBUST N2 IO bloqueante: temp_usage/clean_temp sync, clean_orphans en worker, library save con mutex + warn cada 500ms
9 BUG N1 TOCTOU candidate_dirs cleanup.rs:206
10 DUP N2 clipboard dos APIs historial clipboard.rs:47-202
11 PATCH N2 library::release_info Stream falso; viola capas library.rs:379 (=P4#14)
12 PATCH N2 campos "no persistidos" se serializan library.rs:85
13 N1 muerto: storage.rs todo!, CoreError::NotImplemented, Cleanup::scan/Leftover, is_dirty, flush_library, api.readClipboard, tests vacíos
14 DUP N2 rutas fuera de paths.rs (calibration, rqbit); speed_factor en Config (=P1#6)
15 RESP N2 app.rs → intake.rs, update_config, protected_dirs

### P2 analyzer/ranking/trackers/magnet (recibido)
1 BUG N1 measure: reserve_dir antes de engine::create? → reserva perdida para siempre analyzer.rs:1089
2 BUG N1 quick() reserva todos los dirs antes del semáforo analyzer.rs:1146
3 BUG N1 scrape: timeout/error de chunk descarta chunks ya respondidos trackers.rs:65,110
4 BUG N2 ResumeOne en ventana Hold→held se pierde analyzer.rs:400-434,717,755
5 BUG N2 contadores done/total inconsistentes analyzer.rs:304,458,418,776
6 DUP N2 quick_one/measure_with/fetch_names mismos pasos con timeouts distintos; torrent_cache_file x4
7 ROBUST N1 save_torrent_cache no atómico + cache envenenado engine/mod.rs:177
8 BUG N1 magnet_spans incluye ")" "," final → magnet perdido magnet.rs:192,94
9 BUG N1 subs usan biggest_file en vez de live.file_name analyzer.rs:923
10 BUG N1 prev no se resetea al cambiar a downloaded_bytes analyzer.rs:1571
11 DUP N2 3 reglas "es episodio" ranking.rs:59 subtitles.rs:165 engine/mod.rs:119
12 N1 validar RankingConfig (minutes=0 → inf) ranking.rs:150
13 N1 default no-op Measurer::quick muerto analyzer.rs:198
14 N1 Probing manda 0 como desconocido → barra retrocede analyzer.rs:110,1399
15 RESP N3 estado por hash en 7 colecciones → jobs map; split analyzer/

### P3 engine + sidecar (recibido)
1 BUG N3 sidecar shutdown/stdin-close borra datos (≠ rqbit, ≠ README FR-06d) main.mjs:217,254
2 BUG N3 RqbitEmbedded sin Drop → sesión filtrada + 2 escritores dht.json rqbit.rs:65,268
3 BUG N2 remove durante checking no borra de la sesión rqbit.rs:726
4 BUG N2 pause/resume/stats bloquean hasta metadata rqbit.rs:691,618,591
5 PATCH N2 EngineEvent::Metadata sin consumidor
6 PATCH N2 only_file/start_deselected/PriorityMode/kind() sin uso
7 ROBUST N2 webtorrent client sin flag closed; pending leak; expect json webtorrent.rs:87,124
8 DUP N1 is_video copiado 5 veces; choose_file ≈ pick_file
9 DUP N2 rqbit temp dirs hardcoded; rqbit-state huérfano rqbit.rs:181
10 BUG N1 Range start>end underflow; accept loop spin rqbit.rs:839,777
11 N1 engine-protocol.md desincronizado; version sin chequeo; userMessage ignorado
12 ROBUST N2 sidecar: error → whenReady cuelga; uncaughtException sigue
13 ROBUST N1 range tasks spawn antes del lock rqbit.rs:540
14 RESP N2 split rqbit.rs

## Decisiones (Joaquín, 2026-11-15)
- Nivel: N3 por etapas (E1 bugs+N1 → E2 N2 → E3 N3).
- Pausadas y análisis: mover de temp a cache_dir/downloads + migración de una vez.
- "Limpiar temporales": SIGUE borrando análisis (solo protege activas). Unificar regla igual, sin cambiar semántica.
- Atajos F5/Enter/Ctrl+V: implementarlos (F5 con preventDefault).
- Tests: baseline suite actual; tests nuevos solo para bugs con lógica no trivial.
- Implementación: agentes Opus por partición, yo integro/compilo entre etapas.
- Motor por defecto: rqbit.
- BUG reportado por Joaquín: elegir cap N de un pack reproduce otro cap / dice "Retomar" sin haber dado play. Causa: identidad = solo info_hash (library entries, active_id_for, take_kept, KeptRecord.file_index gana a la elección; catalog_add pisa origin). Decisión: UNA FILA POR EPISODIO; identidad (hash + archivo/episodio) en biblioteca, reproducción, pausadas y Retomar; análisis de velocidad compartido por torrent. Etapa E1b (un solo agente, después de E1).

## E1 resultados
- P5 subtitles: 9/9 FIXED (without_url, parse_srt por líneas, RemoveOnDrop, write_atomic, idioma en SubtitleChoice, 206 + MAX_BODY 20MB, format_ext único, JoinSet sin cortar, delay_adjusted). Cambio: Subdivx decodifica con to_utf8. Verificar en integración: rqbit responde 206 a Range. rustfmt NO instalado.
- P7 shell+UI: 9/9 (commands async+spawn_blocking; confirm queue + closeAsking en UI, sin flag en lib.rs; librarySeq/removalSeq; metaSeq; atajos F5/Enter/Ctrl+V; log 500; mqStop; typedefs; capability core:event allow-listen/unlisten — VERIFICAR en runtime).
- P1 playback/player: 10/10 (STATS_TIMEOUT, exit status → Failed, claim falla mata mpv, preload drop_completed, act guard estados, notify solo AskAfterClose, socket unlink + quit IPC, borrados todo!/probe_duration, mpv_ipc COMMAND_TIMEOUT 5s). Cambio: Detener puede tardar hasta ~4s. spawn_mpv → E2. mpv_profile_dir sin usos (paths.rs:85).
- P3 engine: 11 (10 FIXED, #10 PARTIAL). Sidecar no borra en shutdown; Drop RqbitEmbedded + lease en Inner; remove en checking; resolved() no bloqueante; webtorrent closed/PendingGuard; parse_range 416; versión 0.2.0; is_video pub.
  OUTSIDE: fallback .torrent cache inválido → magnet en playback.rs:620, analyzer.rs:1246,1351. is_video en bench.rs:330, subtitles.rs:148/272, normalize.rs:411 (E2).
- P4 catalog: 12 (11 FIXED, #7 PARTIAL). OUTSIDE: app.rs catalog_add pasar VideoId a candidate(); catalog_search pasar token a find_excluded. Nota: normalize_url con ?key= agrega /manifest.json después de query (bug, no tocado).
- P2 analyzer: 9/9 FIXED (+3 tests). Config validation ya asignada a P6.
- P6 core: 10/10 + decisiones (downloads → cache_dir + migración; protected_dirs único; remove_dir_when_free; save_library fuera del lock; diag-mpv-ipc rename; fix_invalid ranking).
  OUTSIDE: rqbit.rs:181 → AppPaths::rqbit_temp_dir (ojo hardlink cross-volume temp↔cache); analyzer cancel_one(hash); README storage.rs/diag/cache.
- E1b HECHO: VideoKey (crates/core/src/video_key.rs) `<hex>` / `<hex>:s3e2` / `<hex>:f12`; library por clave; start atómico (lock starting + espera teardown ≤20s); kept migrado; FR-28 por clave; add_cached_or_magnet; candidate(video, hash); find_excluded con token. 146 tests OK.
  Efectos: análisis por hash copia file_name/duración del ep medido a todas las filas; película con fileIdx = fila distinta del mismo magnet pegado; downloaded_bytes igual en filas del pack.
- Yo: normalize_url con ?key= (addons.rs) + test.

## E2a (splits, en paralelo)
A playback/ + player spawn_mpv · B analyzer/ · C rqbit/ · D subtitles providers/ + session · F ui app.js → módulos + format/dom
## E2b (después, cross-module)
release.rs + audio::from_release + is_video + release_tags + library DTO · crate::http + crate::secrets · engine dead surface + AppPaths para rqbit · app.rs → intake.rs + clipboard API + open_key_page/ConfirmClose
- E2a B analyzer: split en analyzer/{queue,live,pipeline,speed,subs,names}.rs; helpers compartidos; timeouts nombrados. Cambio: quick loguea mpv/duración. OUTSIDE (E2b): AppPaths::torrent_cache_file; OwnerRecord::now compartido.
- E2a C rqbit: split rqbit/{net,fastresume,http}.rs; peer_watch task propia. OUTSIDE (E2b): tabla ext→container+MIME única en preload.rs para mime_of.
- E2a D subtitles: providers/{http,cache,archive,lang,imdb,torrent,wyzie,subdivx,opensubtitles}.rs + fetch.rs; HttpError tipado. Yo: error_label restaura "Wyzie/Subdivx/OpenSubtitles" en mensajes. OUTSIDE (E2b): SubtitleLanguage::{iso1,iso2,name_es} en config.rs; mover SubtitleProvider trait + TORRENT_PROVIDER a providers.rs.
- E2a A playback: playback/{flow,kept,calibration}.rs; Slot::transition/set_state único escritor de state; player spawn_player/new_ipc_path/remove_ipc_socket.
- E2a F UI: app.js 136 líneas + state/dom/format/row-analysis/library-rows/analysis-toolbar/marquee/tooltip/audio-picker/dialogs/activity-feed. Cambio visible: catálogo "1,5×". LIGHT_HELP muerto (preexistente, mencionar).
## E2b lanzado: G1 reglas de dominio · G2 infraestructura. Library DTO → E3 (junto con evento de fila completa).
- E2b G1 dominio HECHO: release.rs (parser + season_episodes único); audio::from_release/spanish_variant/collapse_spanish; normalize::release_tags; CONTAINERS en preload; SubtitleLanguage iso*; trait en providers.rs.
  TODO mío post-G2: "4x4 (2019)" ahora estima episodio → exigir episodio ≥2 dígitos en forma NxM; flow.rs:430 usar release:: y borrar shim subtitles::parse_release_name; engine names_episode → release::season_episodes; lib.rs doc niveles; tabla CONTAINERS a nivel bajo (rqbit/http llama preload).
- E2b G2 infra HECHO: crate http.rs/secrets.rs/external.rs/intake.rs; engine sin only_file/start_deselected/PriorityMode/kind/Metadata event; protocolo 0.3.0; create(config, paths); torrent_cache_file; OwnerRecord::now; clipboard history() único; CoreEvent::ConfirmClose. Cambios: subs reintenta 429; Content-Length temprano.
- Yo post-E2b: NxM exige episodio ≥2 dígitos ("4x4 (2019)" = película, test); VideoIdentity::for_file (playback+analyzer, sin shim); names_episode → release::season_episodes; bench torrent_cache_file; lib.rs doc niveles. 155 tests OK, 0 warnings.

## E3 (N3)
A config dueño único (update_config, calibración fuera de Config, UI cambios puntuales) · B analyzer jobs map + cancel_one · D cuota OpenSubtitles app-wide · C (después de A) fila completa en evento + DTO + veredicto/audio desde core
- E3 D cuota HECHO: QuotaGate global (OnceLock) en opensubtitles.rs; spend() serializa POST /download; 406 → 0 hasta reset; búsqueda OS omitida si 0. En memoria (no persiste). Cambio: downloads OS de a uno; mensaje "se renueva dd/mm HH:MM".
- E3 B analyzer HECHO: jobs map + order; Stop::{Requeue,Cancel,Hold,Restart}; counters derivados; cancel_one + remove() espera ≤5s. Cambios: quitar fila en cola baja el total; resume de quick-only vuelve a scrape+quick.
- E3 A config HECHO: update_config único escritor; set_config borrado → config_set_network / catalog_set_exclude_japanese; Calibration dueño de calibration.json (seed una vez desde config viejo); ranking recibe speed_factor. Test config_updates.rs.
- E3 C HECHO: LibraryEntry (disco) vs LibraryRowView (vista) por Library::view; eventos con fila completa + sort_key; UI sin scheduleRefresh/ordered; veredicto desde RankScore (umbrales, calibración, capped_by_estimate) + provisional en Measuring; audio::play_options. Catálogo: orden por resolución/seeders es decisión del usuario (2026-11-14), no se tocó.
- Yo final: filas nuevas de un torrent ya medido heredan live/scrape/status (test). README actualizado (sección Root-fix, estructura). Smoke: app arranca limpia; UI harness con filas reales: E1/E2/torrent entero, ▶ E2 manda `:s3e2`, sin errores de consola. 169 tests ×3 OK, 0 warnings.

## Estado: E1, E1b, E2, E3 HECHOS. Pendiente: validar en la app real (reproducir, pack de temporada, Ajustes, catálogo), Windows sin compilar, rustfmt/clippy no instalados, sin commit.

## Ajuste 2026-11-15: ventana + panel lateral del catálogo
- Ventana maximizada al abrir (tauri.conf.json `maximized: true`).
- Catálogo: tocar peli/serie abre panel a la derecha (grilla sigue visible). Peli → opciones directo (sin ficha ni título). Serie → migas Serie › Temporada › Episodio → opciones. Esc / ✕ cierra.
- Opciones: orden peso desc → seeders desc (único lugar: `byOption` en catalog.js); badges solo idioma de audio (LAT/EN/MULTI) + HDR / Dolby Vision; resto en tooltip.
- Analizar = catalog_analyze (agrega + metadatos + velocidad) y va a Mis magnets. Reproducir = catalog_add (nuevo comando, devuelve la fila) + mismo play() de Mis magnets (elige audio), sin cambiar de pestaña.
- Borrado: ficha de página completa, checkboxes/"Enviar marcados", grupos por resolución (y su localStorage), badges de fuente/formato de audio/subs/PACK.
