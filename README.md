# Streamonte

App de escritorio (Tauri v2) para reproducir magnets por streaming en mpv, con análisis del swarm,
limpieza automática y subtítulos. Spec: `C:\Users\Monti\bin\tstream-v2-spec\` (00→08).
La v1 (`C:\Users\Monti\bin`) queda congelada como referencia.

## Estado: F1 — motor + reproducción + benchmark (en curso)

F0 validado por el usuario (2026-11-13).

### Root-fix (2026-11-15; falta validar en la app) — detalle en `docs/plans/root-fix-app.md`

- **Una fila por episodio:** fila, reproducción, pausada, "Retomar" y subtítulo recordado se
  identifican por `VideoKey` (`<hash>` · `<hash>:s3e2` · `<hash>:f12`), no solo por hash. El
  análisis de velocidad sigue por torrent y vale para todas sus filas.
- **Descargas pausadas y análisis** viven en la caché de la app (`<cache>/downloads`), no en la
  carpeta temporal del sistema (que el SO purga). Al abrir se mueven una vez desde la ubicación vieja.
- **Config con un solo escritor** (`AppCore::update_config`); la UI cambia de a un ajuste. El
  factor de calibración vive solo en `calibration.json`.
- **Protocolo del sidecar 0.3.0:** `shutdown`/cierre de stdin ya no borran datos; sin
  `onlyFile`/`startDeselected`/`mode` ni notificación `metadata`.
- Logs de diagnóstico rotan por día (`diag-*.<fecha>.log`, 7 archivos); el de mpv IPC pasó a `diag-mpv-ipc`.

### Conexiones entrantes y DHT persistente (ADR-30, 2026-11-14; falta medirlo en la red del usuario)

- El motor de cada **reproducción** (rqbit) escucha conexiones entrantes en TCP: prueba los puertos
  `engine.listen_ports` (por defecto 41850–41859) y si están ocupados usa uno al azar; pide el
  reenvío al router por **UPnP** (`engine.upnp`, sin NAT-PMP/PCP). A los trackers se les anuncia el
  puerto real (antes, sin escucha, librqbit anunciaba un 4240 falso). uTP: `engine.utp`, apagado
  (librqbit lo marca inestable). Los motores del **analizador** no escuchan ni guardan DHT.
- La tabla del DHT se guarda en `%LOCALAPPDATA%\streamonte\cache\dht.json` (la escribe un solo
  motor a la vez) para no arrancar el DHT en frío.
- Si algo falla (puerto tomado, IPv6 apagado, `dht.json` inválido), el motor arranca como antes,
  sin entrantes ni persistencia, y lo dice en el log.
- **Apagarlo:** en `config.json`, `"engine": { "incoming": false }` (sin escucha ni UPnP) o
  `"upnp": false` (escucha sin pedir nada al router). Aplica desde la próxima reproducción; todavía
  no hay interruptor en Ajustes (es UI).
- **Fallas, todas inofensivas** (la reproducción sigue con salientes y el Detalle dice qué pasó):
  apagado en la config · puertos del rango ocupados (usa uno al azar) · no se pudo escuchar (motivo) ·
  UPnP sin respuesta o deshabilitado en el router (log general: `failed to run SSDP/UPNP discovery`,
  `failed to forward port` o `discovered 0 endpoints`) · firewall que bloquea o doble NAT: no se
  pueden detectar desde adentro, así que si a los 2 min hay 0 entrantes el Detalle lo avisa.
- **Mapeo UPnP al cerrar:** librqbit no borra el mapeo (no implementa `DeletePortMapping`), pero lo
  pide con un lease de 60 s y lo renueva cada 30 s: al cerrar la reproducción vence solo en ≤ 60 s.
- **Sin permisos de administrador:** puertos > 1024, nada de reglas de firewall ni servicios. El
  servidor HTTP del stream sigue solo en `127.0.0.1`; únicamente el puerto de torrents escucha en
  todas las interfaces.
- **Lo que pregunta cada sistema la primera vez que escucha:**
  - *Windows (cualquier PC):* el Firewall de Windows Defender muestra "Windows Defender Firewall
    bloqueó algunas características" para `streamonte.exe` (Streamonte; en desarrollo
    `target\debug\streamonte.exe`). Recomendado: marcar solo **Redes privadas** (casa) y Permitir
    acceso; en redes públicas (café, aeropuerto) mejor no. "Permitir" pide aprobación de
    administrador; si se cancela o se bloquea, la app funciona igual, solo con salientes.
    Cambiarlo después: *Seguridad de Windows → Firewall y protección de red → Permitir una
    aplicación a través del firewall*.
  - *macOS:* si el Firewall de aplicaciones está activado (Ajustes del Sistema → Red → Firewall),
    aparece "¿Quieres que la aplicación "Streamonte" acepte conexiones de red entrantes?":
    *Permitir* habilita las entrantes; *Denegar* deja la app funcionando solo con salientes. Con
    el firewall apagado (por defecto) no pregunta nada. Como la app no está firmada ni notarizada,
    Gatekeeper avisa al abrirla la primera vez (clic derecho → Abrir, o Ajustes → Privacidad y
    seguridad → "Abrir igualmente"); eso es independiente de la red.
- **Privacidad:** escuchar y UPnP exponen lo mismo que cualquier cliente de torrents (tu IP pública
  y un puerto, que el swarm ya ve con las conexiones salientes). No se envía nada nuevo a ningún
  lado: el UPnP solo habla con el router de tu red local.
- **Medir antes/después** (mismo magnet legal: Sintel, Big Buck Bunny o Tears of Steel):
  1. En `%APPDATA%\streamonte\data\config.json`, `"engine": { "incoming": false }` (= antes).
     Reproducir 2–3 min y mirar el log de **Detalle**: cada 10 s aparece
     `peers: N conectados (E entrantes, S salientes) · X MiB/s`.
  2. Cerrar la app, poner `"incoming": true` (= después) y repetir con el mismo magnet.
  3. Al arrancar cada reproducción el Detalle dice el puerto, si se pidió UPnP y si el DHT es
     persistente. El resultado del UPnP queda en el log general (`%LOCALAPPDATA%\streamonte\data\logs\streamonte.*.log`):
     buscar `successfully port forwarded` o `failed to forward port`.
  "Entrantes" = peers que alguna vez se conectaron ellos (librqbit no expone el sentido de la
  conexión actual). Sin UPnP ni reenvío manual, detrás de NAT las entrantes suelen ser 0.

### F4b — catálogo y addons, Entrega 1 (2026-11-14; falta probarlo en la app)

Pestaña **Buscar** (Ctrl+F): buscar en Cinemeta → ficha (serie: temporada → episodio) → torrents de los 5 addons, agrupados por resolución → "＋ Mis magnets" (se analizan y se reproducen desde *Mis magnets*). Spec 09 + Q-12/14/15/19/20/22/23/24 resueltas en 08.

- Núcleo `crates/core/src/catalog/`: `protocol` (tipos Stremio, esquema tolerante), `http` (conexión 4 s / total 10 s, 2 por host, 1 reintento solo red/5xx, 429 + `Retry-After`, tope 5 MB, URLs con config enmascaradas), `cinemeta` (búsqueda, ficha, episodios, regla japonés), `addons` (manifest, `types`/`idPrefixes`, validar al agregar, URL con config → almacén seguro), `normalize` (Torrentio/TorrentsDB, Peerflix, Comet + genérico; solo P2P; anime fuera), `aggregate` (fan-out progresivo, dedup por hash, orden de audio **Inglés > Latino > Español > Castellano > Multi**, sin CAM, scrape automático de seeders).
- `AppCore`: `catalog_search/meta/streams/stop_streams/analyze`, `catalog_addons/add_addon/remove_addon/set_addon_enabled/reset_addons`; eventos `catalog-streams`, `catalog-excluded`. Lo analizado o reproducido entra a *Mis magnets* con `origin` (video, IMDb, temporada/episodio, `fileIdx`); el analizador y la reproducción usan ese archivo (`FilePick`: `fileIdx` → `SxxExx`/`1x02` → el más grande).
- UI: `ui/src/catalog.js` + `ui/catalog.css` (no toca las tarjetas). CSP: `img-src https:` para pósters.
- Pruebas: T-20–T-23, T-25, T-26, T-30, T-40, FR-49 (`elige_el_archivo_del_episodio`) unitarias; T-31 `tests/catalog_mock.rs` (addon rápido, lento y caído con servidor local).
- Cómo probar (red real, en tu terminal): `cargo run -p streamonte` → Buscar → "sintel" o "night of the living dead" → ficha → "＋ Mis magnets" en 2 → en Mis magnets esperar el semáforo → ▶.
- Filtro por fecha de estreno (FR-37b, 2026-11-14): en Explorar, fila "Estreno" con *desde* / *hasta*, atajos "Últimos 30 días", "Este año", "Desde… hasta hoy" y "Limpiar". Cinemeta no filtra por fecha: `cinemeta::browse_released` recorre sus catálogos por año y filtra por `released` (comando `catalog_browse_released`, cursor `next`). Límite: solo títulos de esos catálogos (≈400 por año) y con fecha. Prueba `filtro_por_fecha_de_estreno`.
- Pendiente (Entrega 2): Explorar completo (FR-37, género), "dudoso" (FR-46), salud + circuit breaker (FR-51), caché en disco (FR-52), "visto"/último episodio (FR-50 completo), reordenar addons, "+N nuevos" sin saltos (FR-42), grupo propio en *Mis magnets* (Q-20). Después: i18n (FR-60), debrid (F8).

### Lo analizado sirve de precarga (FR-06d, 2026-11-14; falta probarlo en la app)

- El análisis (fase rápida y velocidad) baja en `downloads/<hash>-analisis/` y **no la borra**: el motor se apaga (nada sigue bajando ni compartiendo) y los datos quedan. Re-analizar sigue sobre la misma carpeta; la velocidad mide solo bytes nuevos de la red.
- ▶ sin descarga pausada **adopta** esa carpeta (renombrar, sin copiar): `.torrent` de la caché + piezas ya bajadas; el Detalle dice "reuso lo bajado al analizar (FR-06d)" y la precarga queda lista casi enseguida. No adopta mientras ese magnet se está midiendo.
- Retención: vive mientras el magnet está en la lista. Quitar / Limpiar lista / "Borrar todo" la borran; la limpieza al abrir/cerrar borra solo las de magnets que ya no están; "Limpiar temporales" también la cuenta como temporal.
- rqbit `shutdown` ya no borra datos (igual que el sidecar): borrar es `remove(delete_data)` o `cleanup.remove_dir`.
- **Fastresume (2026-11-14):** cada motor nuevo re-hasheaba el archivo entero de la carpeta conservada antes de dar "metadatos" (60 GB > 60 s → "tiempo agotado esperando metadatos" en la velocidad y al ▶, aunque el `.torrent` ya estaba en caché). Ahora librqbit corre con `fastresume` + persistencia en una carpeta propia de cada instancia (`%TEMP%\streamonte\rqbit-state\<pid>-<n>`, se borra al apagar) y el bitfield de piezas verificadas vive junto a los datos (`.streamonte-piezas.bitv`, enlace duro: sigue al día y viaja con la carpeta al adoptarla). Si los datos no coinciden, librqbit lo detecta con una muestra y hace el chequeo completo. Carpetas analizadas antes de este cambio pagan un último chequeo completo.
- Timeout de metadatos (`engine::wait_metadata`): el log dice qué faltaba — "verificando datos en disco X de Y GB (los metadatos ya estaban)", "0 peers encontrados por DHT" o "N peers por DHT, ninguno los dio".
- Motores del analizador vs. entrantes (NFR-33): no chocan; solo el de reproducción escucha, abre UPnP y guarda el DHT.
- Pruebas: `fr_06d_analisis_vive_mientras_el_magnet_esta_en_la_lista` (aceptación), `play_adopta_la_carpeta_del_analisis` y `bitfield_guardado_evita_reverificar_lo_bajado` (unitarias).

### Análisis por fila y portapapeles con selección (2026-11-14)

- FR-08c: ⏸/⏵/↻ por fila (`analyzer_pause_one` / `analyzer_resume_one`, evento `analyzer-queue`), casillas + "Analizar seleccionados", "Analizar todo", "Pausar todo"; columna *Estado* con la fase de cada fila; fila en análisis destacada; encabezados sutiles.
- FR-01c: "Leer portapapeles" abre un diálogo con los magnets del historial Win+V (fecha de copia vía `ClipboardHistoryItem.Timestamp`), todos marcados, elegir cuáles agregar (`clipboard_preview`, `library_add_selected`).

- FR-06c: idiomas de audio (`crates/core/src/audio.rs`): `player::probe_media` lee `track-list` junto con la duración; insignias LAT / EN / CAST… en la fila (punteadas = adivinado por el nombre).
- FR-29b (rev. 2026-11-14): filas del diseño aprobado `design/cards-v3.html` — título limpio + año/episodio (`LibraryEntry.release`, reusa `parse_release_name` y `catalog::normalize::parse`), nombre crudo con marquesina y copiar, "78 Mbps" + sello "3,9×" (revela "/ 20 Mbps"), botones **Análisis rápido** (`analyze {kind:'quick'}` → `AnalyzeScope::QuickOnly`) y **Medir velocidad**, detalle desplegable con % bajado (bytes reales en disco del análisis o de la reproducción pausada, el máximo; en vivo mientras se mide), calidad y el enjambre siempre visible; sin panel "Reproducciones": estado + Detener/Cancelar en la fila, carpeta/borrar/log en el menú contextual, actividad de fondo abajo a la derecha (`ui/src/activity.js`: una burbuja flotante sobre la barra de estado, con lo último que se está haciendo, que al tocarla abre hacia arriba el log en vivo de todo lo de fondo, fijar/vaciar; alimentada por los eventos y por el log del núcleo vía `crates/core/src/activity.rs` → `CoreEvent::Activity`, ≤ 8/s y sin secretos); al analizar, "preparando…" inmediato con la fase real (`SpeedProgress.phase`: conectando → metadatos → precargando → midiendo → duración), botones deshabilitados mientras tanto y rollback si falla; el analizador ignora pedidos repetidos; "Reiniciar análisis" (detalle y menú contextual, `analyzer_restart`) lo vuelve a pedir desde cero aunque esté trabado; al retomar una pausada se reusa lo bajado al medir si es más (`merge_analysis`); tooltips propios en toda la app (burbuja animada con flecha, título en negrita y teclas; nunca el nativo); tema claro/oscuro del sistema. Prueba: `analisis_rapido_no_mide_velocidad`, `titulo_limpio_y_calidad_de_los_nombres_del_diseno`.
- FR-09b: ▶ pregunta Latino / Inglés si hay varios audios en un selector anclado al botón Ver (`AudioPick` → `--aid` o `--alang`; subtítulos ocultos con audio en español; se recuerda en `.streamonte-kept.json`).
- FR-12c: al cerrar mpv sin terminar de bajar, la app pregunta "¿Seguir bajando de fondo o pausar?" (`ask-after-close`); "Seguir bajando" (`keep-downloading`) deja el motor bajando sin reproductor (`background`) hasta completar o pausar; sin respuesta en 2 min, pausa como antes.
- FR-22b: al analizar se bajan de fondo hasta 5 subtítulos por video: primero el idioma configurado (español: latino, después España/sin variante) y, si no llegan a 5, se completa con el otro (inglés). Fuentes: Wyzie + Subdivx + Gestdown + Subtitulamos (estas dos, solo series), sin gastar la cuota de OpenSubtitles. Una sola búsqueda por película/episodio (`VideoIdentity::video_id`: IMDb id del catálogo + SxxEyy, si no título + año/SxxEyy): otro torrent del mismo video reusa esa caché y solo copia los archivos junto a su video como `<video>.es.default.srt`, `<video>.es-b.srt`, `<video>.es-c.srt`, `<video>.en.srt`, `<video>.en-b.srt` (mpv los carga todos solo y elige el `.default`; `es-2`/`es-419` no los carga). Lógica compartida con la reproducción (`subtitles::session::fetch`).

### Ajustes pedidos tras validar F3 (2026-11-13)

| Pedido | Qué se hizo | Verificado |
|---|---|---|
| Nombre real al pegar (el `dn` de Torrentio es genérico) + análisis automático | FR-01b: metadatos en paralelo al pegar, `torrent_name`/`video_size` en la entrada; análisis `Pasted` automático (`analyzer.auto_on_paste`) | real: nombre a los 5 s, medido a los 40 s |
| Tarjeta en una fila: tamaño · ▲ seeders · ▼ leechers · velocidad · progreso · ▶ | FR-29b; detalle en clic derecho → "Ver análisis" (FR-30) | navegador con datos de prueba |
| "Dice que se va a cortar y no se corta" | Calibración: bytes recibidos, sin arranque, mediana de la meseta; duración estimada ≠ rojo; factor automático con reproducciones reales | BBB 14,5 → 27,2 MB/s; factor automático **sin verificar en vivo** (necesita ≥ 80 s mirando algo analizado) |
| Pausar sin borrar; un video a la vez; retomar tras reabrir | FR-12 cambiado + FR-12b: `.streamonte-kept.json`, `load_kept`, `--start` en mpv; "Borrar"/"Borrar todo" | `examples/keep_test.rs`: pausada en 19,9 s; reabrir → vuelven; retomar → 1ª imagen 0,5 s desde 0:36 |
| 5 subtítulos en español a la vez | FR-21–28 (agente): torrent → Wyzie → Subdivx → OpenSubtitles, ASS fusionado, teclas 1–5/0/S/Z/X/R, memoria | Sintel (subtítulo del torrent); externos necesitan API keys (⚙ Ajustes) · Subdivx bloqueado por Cloudflare |

### F3 — panel de reproducciones y limpieza (implementado 2026-11-13; falta la validación del usuario en la app)

Q-10 resuelta por el usuario: "dejarla" al cerrar = mpv sigue con lo que tiene en caché; la descarga se corta y se borra.

| Requisito | Cómo se demuestra | Resultado |
|---|---|---|
| FR-14 panel integrado (nombre · estado · progreso · velocidad · peers) | `ui/src/library-rows.js` con eventos `playback-updated` | implementado · **validar en la app** |
| FR-15 pausar/reanudar · detener · detener y borrar · carpeta · detalle (log en vivo) | botones por fila → `playback_action` / `playback_log` | implementado · **validar en la app** |
| FR-16 detener todo y limpiar (incluye huérfanos) | `AppCore::stop_all_and_clean` → `stop_all` + `clean_orphans` | ✔ |
| FR-17 al cerrar con reproducciones: preguntar | `on_window_event(CloseRequested)` → diálogo (Detener todo / Dejar el reproductor abierto / Cancelar) | implementado · **validar en la app** |
| FR-18 abrir carpeta de descargas | `open_in_file_manager` (Explorador / Finder) | ✔ |
| FR-19 limpiar temporales con confirmación y tamaño; nunca toca activas ni historial | `cleanup.temp_size/clean` · `fr_19_*` (acceptance + unit) | ✔ pruebas |
| FR-20 limpieza automática al abrir/cerrar | `clean_orphans` en `AppCore::start_with` (en segundo plano) y `on_close` | ✔ |
| T-05 matar el proceso → restos limpios al reabrir | real: `play.exe` matado con `Stop-Process -Force` → al abrir la app se borró la carpeta huérfana (123 MB) en 25 ms · `t_05_*` | ✔ |
| NFR-11 sin huérfanos · PIDs reciclados | dueño = app/motor vivos **y** iniciados antes del registro (`sysinfo`) · `pid_reciclado_no_engana` | ✔ |

### F2 — biblioteca y análisis (implementado 2026-11-13; falta la validación del usuario)

Módulos: `magnet` · `clipboard` · `library` · `trackers` · `analyzer` · `ranking` + comandos de biblioteca/análisis de
`AppCore`. Q-09 resuelta por el usuario: un elemento del historial Win+V cuenta como magnet solo si tiene **únicamente**
magnets. Cambios de interfaz (aditivos) y comportamiento del analizador anotados en el spec 04.

| Requisito | Cómo se demuestra | Resultado |
|---|---|---|
| FR-01 captura sin duplicados (hex/base32), texto con varios | `fr_01_*` (3 pruebas) · captura en vivo: `AddClipboardFormatListener` (Windows) / `changeCount` cada 500 ms (macOS) · `clipboard::tests::portapapeles_real` (manual, Windows real) | ✔ |
| FR-02 historial Win+V hasta el primer no-magnet; apagado → último copiado + aviso | `fr_02_*` (fuente falsa: historial, apagado, macOS) · WinRT `GetHistoryItemsAsync` | ✔ pruebas · en el equipo del usuario Win+V está apagado: se detecta y degrada (no se probó con el historial encendido) |
| FR-03 "Pegados ahora"/"Anteriores", persistente | `fr_03_*` · `library.json` guardado con debounce de 500 ms y al cerrar | ✔ |
| FR-04 quitar, limpiar, copiar magnet tal cual se copió | `AppCore::remove/clear_library/magnet_of` | ✔ (sin UI) |
| FR-05 scrape UDP en lote < 10 s | `fr_05_*` + `trackers::tests` (servidor falso BEP 15, 100 hashes = 2 paquetes, reenvío, tracker mudo) · real: 3 hashes en 6,4 s | ✔ |
| FR-06 velocidad real (~15 s) + duración real + borrar todo | corrida real abajo · `fr_06_sintel_velocidad_y_duracion_real` (red) | ✔ Sintel 14:48 |
| FR-07 necesita/margen/semáforo, duración estimada 2 h/45 min con "~", orden | `fr_07_*` + `ranking::tests` | ✔ |
| FR-08 pausar/reanudar sin perder lo medido, re-analizar uno, solo no medidos, reintentos | `analyzer::tests` (medidor falso) · pausa real en la corrida de abajo | ✔ |
| NFR-13 macOS | `cargo clippy --target aarch64-apple-darwin` del núcleo sin errores (no probado en una Mac) | parcial |

**Corrida real** (sesión del usuario, 2026-11-13, contenido legal; `--pause-at 1` pausa 5 s tras el primero):

```
cargo run -p streamonte-core --example analyze -- "<magnet>" ["<magnet>" ...] [--engine webtorrent|rqbit] [--pause-at N]
```

| Motor | Torrent | Seed/Leech | Peers | Duración | Velocidad | Necesita | Margen | Semáforo |
|---|---|---|---|---|---|---|---|---|
| rqbit | Sintel | 281/84 | 27 | **0:14:48** | 8,58 MB/s | 0,15 MB/s | 59,0 | verde |
| rqbit | Tears of Steel | 81/13 | 24 | 0:12:14 | 32,88 MB/s | 0,78 MB/s | 42,3 | verde |
| rqbit | Big Buck Bunny | 435/135 | 28 | 0:10:35 | 14,53 MB/s | 0,44 MB/s | 33,4 | verde |
| webtorrent | Sintel | 279/83 | 21 | **0:14:48** | 2,58 MB/s | 0,15 MB/s | 17,7 | verde |

3 torrents en 64 s (scrape 6,4 s + ~17 s por medición). La pausa cortó la medición de Sintel y al reanudar se midió de
nuevo; Big Buck Bunny (ya medido) quedó intacto. Al terminar: 0 carpetas de medición y 0 procesos `node`/`mpv` sueltos.

Pendiente de F2: validación del usuario; FR-02 con el historial Win+V encendido (en este equipo está apagado); la UI de
estas funciones es de F4. Los comandos de fases futuras (p. ej. limpiar temporales, F3) devuelven un error claro en
vez de cerrar la app.

### F1 — qué funciona (verificado en la sesión real, 2026-11-13, Sintel, contenido legal)

| Requisito | Resultado webtorrent (sidecar) | Resultado rqbit (embebido) |
|---|---|---|
| FR-10 / NFR-08 metadatos < 10 s (magnet solo hash + trackers de la config) | 2,7 s ✔ | 0,1 s (desde `.torrent` en caché, FR-13) |
| FR-11 precarga inicio + final (MP4), exclusiva (lección 3) | 14,8 s; prueba de humo: 8,4 MB bajados de 8 MB pedidos ✔ | 6,6 s |
| NFR-07 primera imagen < 20 s (archivo chico) | 18,1 s ✔ | 6,9 s ✔ (con caché) |
| FR-12 / T-04 cerrar mpv → motor detenido + carpeta borrada < 10 s | 1,1 s ✔ | 1,0 s ✔ |
| NFR-11 / O3 sin huérfanos | 0 procesos, 0 carpetas ✔ | 0 procesos, 0 carpetas ✔ |
| FR-13 reusar metadatos | `.torrent` guardado en caché tras la 1ª vez ✔ | usado en la 2ª ✔ |

**Benchmark 06-D con Sintel** (2026-11-13, 3 corridas por motor alternadas, caché borrada, ventana de 60 s en vez de 300 s
a pedido del usuario — informe: `benchmarks/bench-20261113-222843.md`):

| Motor | Metadatos (mediana) | 1ª imagen (mediana) | Cortes | Vel. máx. | Cierre + borrado | Fallas |
|---|---|---|---|---|---|---|
| **rqbit** (embebido) | 1,6 s | **8,8 s** | 0 | 196–260 Mbps | 1,0 s | 0/3 |
| webtorrent (sidecar) | 2,6 s | 21,9 s | 0 | 92–118 Mbps | 1,1 s | 0/3 |

Saltos 25/50/90 %: 0,0 s en ambos (Sintel ya estaba entero en ese minuto: no discrimina).

**Decisión (ADR-04, 2026-11-13): rqbit es el motor por defecto.** webtorrent queda como alternativa (único con web seeds).
Intento de T-01 con un `.mov` de 11 GB de NASA (Internet Archive, dominio público, índice al final): el magnet no
consigue metadatos (sin peers; archive.org sirve por web seeds, que librqbit no soporta — R-18). **T-01/T-02 pendientes**
con un swarm público real > 10 GB para verificar la lección 1 con rqbit.

```
cargo run -p streamonte-core --example play -- "<magnet>" [--vlc] [--diag] [--engine rqbit]
cargo run -p streamonte-core --release --example bench -- --case "Sintel=<magnet>" [--case "T01=<magnet>"] [--runs 3] [--watch-secs 300]
```

### F0 — fundaciones
`cargo fmt --check` ✔ · `cargo clippy --workspace -D warnings` ✔ · `cargo run -p streamonte` abre la ventana "Streamonte"
(logs en `%LOCALAPPDATA%\streamonte\data\logs`).

> Windows: Smart App Control bloquea los binarios recién compilados (os error 4551). Para desarrollar hay que tenerlo desactivado.

| Cubre | Cómo |
|---|---|
| NFR-01 Modular | Un módulo por responsabilidad, niveles de dependencia sin ciclos (`crates/core/src/lib.rs`). El núcleo no depende de Tauri; la UI solo ve `AppCore` + eventos. |
| NFR-02 Motor intercambiable | `trait TorrentEngine` (`engine/mod.rs`); `engine::create` es lo único que conoce webtorrent/rqbit. |
| NFR-03 Sin rutas fijas | `paths::AppPaths` (carpetas del SO) + `find_executable` (config → PATH → ubicaciones típicas). |
| NFR-04 Config tipada | `config::Config` con defaults documentados (trackers de v1, precarga 16/40 MB, plan B 45 s, 100 conexiones…). |
| NFR-05 Legible | Doc-comments con el "por qué" y referencias a FR/lecciones. |
| NFR-06 Sin workarounds de v1 | Sin .cmd/.ps1/BOM; procesos hijos directos sin shell. |
| NFR-15 Logs | `logger`: general siempre + diagnóstico **opcional** (precarga/mpv/motor), activable en caliente (Q-06). |
| NFR-17 Pruebas | `crates/core/tests/acceptance.rs`: un test por CA, marcado con su fase; CI Windows+macOS. |

Todas las funciones tienen firma y tipos definitivos; los cuerpos son `todo!("Fn")` con la fase en que se implementan.

## Estructura
```
streamonte/
├─ Cargo.toml                 workspace (perfil release liviano, NFR-14)
├─ crates/core/               NÚCLEO en Rust, sin Tauri (ADR-13)
│  ├─ src/
│  │  ├─ lib.rs               mapa de módulos y reglas de dependencia
│  │  ├─ error.rs events.rs   errores con mensaje claro (NFR-12) · eventos núcleo→UI
│  │  ├─ paths.rs config.rs logger.rs activity.rs fsutil.rs     (nivel 0)
│  │  ├─ magnet.rs video_key.rs release.rs audio.rs ranking.rs  (nivel 1, puros)
│  │  ├─ http.rs secrets.rs external.rs clipboard.rs library.rs trackers.rs player.rs cleanup.rs
│  │  ├─ engine/{mod,webtorrent,rqbit}.rs + engine/rqbit/{net,fastresume,http}.rs (nivel 2)
│  │  ├─ preload.rs · analyzer.rs + analyzer/{queue,live,pipeline,speed,subs,names}.rs
│  │  ├─ playback.rs + playback/{flow,kept,calibration}.rs
│  │  ├─ subtitles.rs + subtitles/{fetch,session,merge,secrets,providers/…}.rs
│  │  ├─ catalog/{http,cinemeta,addons,normalize,aggregate,protocol}.rs  (nivel 3)
│  │  └─ app.rs intake.rs     AppCore: única puerta para la UI · entrada de magnets
│  └─ tests/acceptance.rs     trazabilidad de CA
├─ src-tauri/                 cáscara: ventana, comandos 1:1 con AppCore, eventos
├─ ui/                        HTML/CSS/JS sin bundler; ui/src/api.js = espejo de los comandos
│                             app.js arranque + eventos · state/dom/format · library-rows ·
│                             dialogs · audio-picker · catalog · activity-feed · tooltip · marquee
├─ engines/webtorrent-sidecar/  sidecar Node (JSON-RPC por stdio) — esqueleto
├─ docs/engine-protocol.md    contrato núcleo ↔ sidecar (PROPUESTO)
└─ .github/workflows/ci.yml
```

## Requisitos para compilar
1. Rust (rustup, toolchain MSVC en Windows): https://rustup.rs
2. Git: https://git-scm.com/download/win
3. WebView2 (viene con Windows 11), Node ≥ 20 (ya instalado) para el sidecar webtorrent.
4. CLI de Tauri precompilada vía npm (más rápida que `cargo install tauri-cli`): `npx @tauri-apps/cli@2 <comando>`

```
cargo test -p streamonte-core      # pruebas del núcleo
cargo run -p streamonte            # app en desarrollo (UI estática en ui/, sin bundler)
npx @tauri-apps/cli@2 icon src-tauri/icons/app-icon.png   # regenerar íconos
```

Instalación automática en Windows (winget): `powershell -ExecutionPolicy Bypass -File .\scripts\install-toolchain.ps1`

## Release
1. Subir `version` en `src-tauri/tauri.conf.json` (y `[workspace.package] version` en `Cargo.toml`), p. ej. `0.2.0`.
2. Commit, después `git tag v0.2.0 && git push origin main v0.2.0`.
3. El workflow `release` crea un release borrador, compila Mac (dmg universal) y Windows (`-setup.exe`) en paralelo, escribe `latest.json` (lo consultan las apps instaladas al arrancar) y lo publica.

La clave de firma del updater vive fuera del repo (`/Users/monti/.tauri/tstream-v2.key`, sin contraseña) y en el secreto
`TAURI_SIGNING_PRIVATE_KEY`. Si se pierde, las apps instaladas no pueden actualizarse: hay que reinstalar a mano.

Requisito del usuario final: mpv instalado (la app lo busca en PATH y rutas típicas; si no, se elige en Ajustes).
El motor por defecto (rqbit) va embebido; el sidecar webtorrent (Node) no se incluye en el instalador.
