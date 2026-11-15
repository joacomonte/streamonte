# root-fix de todo lo sin commitear (2026-11-15)

Alcance: diff contra HEAD b8f50ae (UI Buscar, subtítulos por video, embudo + salud, carga en
background, remoción de Mis magnets). Usuario AFK: sin preguntas. Nivel elegido por default:
N1 + N2 chico, sin cambios de comportamiento ni de contratos externos.

## Hallazgos elegidos
- [x] U1 Mbps necesarios (tamaño ÷ duración) calculado en 3 lugares → `neededMbps(c)`.
- [x] U2 `depthUsed` siempre 'long' → se borra; `analyzedDepth` lo deriva.
- [x] U4 `SORTS` con una sola clave → `bySeeds`.
- [x] U5 Prioridad de seeders (contado > medido > trackers > fuente) repetida → `knownSeeds(c)`.
- [x] U7 Scrape de trackers + guardado en `trackerCounted` repetido 4 veces → `scrapeTrackers`.
- [x] U8 Filtro "resolución + solo HDR" repetido 4 veces → `inScope(c, res)`.
- [x] U11 `onlyHdr` + localStorage repetido 3 veces → `setOnlyHdr`.
- [x] U13 `f.subs` siempre 'es' → se borra.
- [x] U3 Comentarios viejos (botón 🔍, "Contar seeders", doc duplicada de subs, health-calib).
- [x] C1 playback: "baja sin reproductor" decidido en 2 lugares → `Slot::without_player`.
- [x] C2 Comandos Tauri que solo usaba Mis magnets → se quitan del shell (el núcleo queda).

## Fuera (a propósito)
- Partir `catalog.js` (1400 líneas) en módulos: N2 grande sin tests de UI; pendiente.
- Comandos ya sin uso antes de este trabajo (`library_read_clipboard`, `library_add_text`,
  `library_clear`, `active_playbacks`): se mencionan, no se tocan.
