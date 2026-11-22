# web/src/lib/server — módulos solo-servidor
Todo lo que habla con TMDB, IMDb, addons de torrents, TorBox, OpenSubtitles y Neon. Nunca se importa desde el navegador (SvelteKit lo impide). Los endpoints (`/Users/monti/Documents/Dev/streamonte/web/src/routes/api/`) son delgados: validan y llaman acá.

## Mapa
- `http.ts:7 Fail(status,msg,vars)` error con texto de UI · `:19 route(fn)` envuelve endpoints (JSON, `{message}` traducido) · `:32 get(url,init,ms=12s)` fetch con timeout.
- `lang.ts:8 langStore` (AsyncLocalStorage, lo llena `hooks.server.ts`) · `:10 lang()` `:11 titlesLang()` `:12 tx(texto,vars)` traduce en el idioma del pedido.
- `params.ts:2 episode(url)` valida `imdb`(tt\d+), `s`, `e` (s y e juntos o ninguno).
- `keys.ts:17 keys()` keys (env `TMDB_KEY`… pisa a `.data/keys.json`) · `:24 setKeys()` escribe `keys.json` (0600) · `ENV` `:15`.
- `tmdb.ts` (API v3 `api.themoviedb.org`, imágenes `image.tmdb.org`):
  - `:42 tmdb()` fetch base · `:104 detail()` ficha mínima (imdb, lang, `excluded`) · `:119 fillDetails()` fichas faltantes, 8 en paralelo, a `.data/tmdb-fichas.json`
  - `:141 candidates()` discover (≤30 págs) · `:166 build()` cruza con IMDb, filtra/ordena · `:185 discover(f)` lista con caché 10 min
  - `:198 search(q,page)` · `:216 people(q)` sugerencias actor/director · `:239 personTitles(id,role)` · `:260 genres(kind)`
  - `:269 providersAr()` · `:279 peopleOf()` · `:287 showStatus()` · `:294 firstTrailer()` (los 4 con golden vs Rust)
  - `:303 title(kind,id)` ficha completa (imdb, temporadas, runtime, origLang) · `:347 namesOf(imdb)` títulos+año para `otherFilm` · `:362 season(id,n)` episodios · `:93 capped()` Map con tope · `:72 keep()` sin japonés · `:90 VOTES` pisos válidos
- `imdb.ts` (dataset `datasets.imdbws.com`): `:59 ratings()` tabla rating+votos (1 vez/día, `.data/title.ratings.tsv.gz`) · `:74 imdbOf(id)` · `:88 buildIndex()` serie→temporadas desde `title.episode` (~55 MB) · `:132 seasonScores(imdb)`.
- `torrents.ts` (addons Stremio `ADDONS :7`: Torrentio, Peerflix, Comet, TorrentsDB):
  - `:33 parse(stream,addon)` normaliza release (res, hdr, codec, source, audio latino/spain, `hint`) — con golden `release.json`
  - `:96 otherFilm()` descarta torrent de otra película · `:107 fileTorrent()` opción desde "Pegar magnet" · `:116 merge()` une por hash, descarta CAM
  - `:140 torrents(imdb,s,e,onProgress)` consulta addons en paralelo → `torbox.cached` → solo los que TorBox tiene, `bySize`
- `torbox.ts` (API `api.torbox.app`, plan Essential: sin streaming nativo, hay HLS vía createstream):
  - `:52 cached(hashes,s,e)` checkcached en lotes de 80 · `:85 link(t)` agrega torrent + `hls()` `:199` (m3u8, audios/subs nativos) o `download()` `:262` (respaldo, `ids`)
  - `:101 tracks()` lee pistas del MKV (`mkv.ts`) · `:122 spanishSubs()` · `:252 latinoByName()` · `:271 pick()` archivo/episodio/mayor · `:13 isSpanishSub()` (golden `sub_lang`) · `:47 episodeRe()`
  - Pegar magnet: `:136 checkFiles()` · `:143 mine()` · `:158 addMagnet()`
- `mkv.ts:41 parseTracks(buf)` EBML del primer MB · `:64 tracksOf(url)` Range 0–1 MB · `:83 isSpanish()`.
- `magnet.ts:16 parseName()` · `:30 identify(name)` título en TMDB · `:45 status(hash)` cached/downloading/ready/missing · `:60 download(hash,dn)`.
- `subs.ts` — gratis: OpenSubtitles.org XML-RPC (`:8`, UA `VLSub 0.11.1`): `:47 search()` · `:82 download(id)`. Premium OpenSubtitles.com (`:96`, key del usuario): `:140 premiumQuota()` · `:165 premiumSearch()` · `:186 premiumDownload(id)` (gasta 1) · `:221 premiumFile(id)` · `:227 utf8()`. Bajados en `.data/premium/` (`:98`).
- `track.ts:8 sql()` cliente Neon (null sin `DATABASE_URL`) · `:11 track(event,accion,dato,deviceId,zona)` inserta en `eventos`, borra >90 días 1 de cada 50.
- `intentos.ts:10 attempt(key,value,pass)` 5 fallos/15 min por IP en tabla `intentos`; sin DB solo compara.

## Flujo
- Explorar: `/api/catalog` → `discover` → `candidates` (TMDB discover) → `fillDetails` → `ratings()` (IMDb) → lista.
- Torrents: `/api/torrents` → `torrents` → 4 addons → `merge` → `cached` (TorBox) → NDJSON.
- Link: `/api/link` → `link` → `added()` `:166` → `hls()`/`download()` → url https.
- Subs: `/api/subs` → `subs.search` (OS.org) · `/api/premium*` → `premium*` (OS.com).

## Conexiones
Desktop Rust equivalente: `crates/core/src/catalog/{top,tmdb,torbox,normalize,audio}.rs`, `crates/core/src/subtitles/`. Cliente: tipos en `lib/types.ts`, `Torrents.svelte`.

## Reglas / trampas
- `DIR`: `.data` local, `/tmp/.data` si `VERCEL` (`tmdb.ts:80`, `imdb.ts:11`, `subs.ts:98`): cada cold start re-baja IMDb (~60 MB) y fichas; premium vuelve a gastar. `keys.ts:4` siempre `.data` (en Vercel van por env).
- `torbox.ts:262 download()`: el link de descarga lleva la key adentro → no cachear ni loguear; por eso `tracks` recibe `ids`.
- `/api/desktop/torbox` nunca reenvía la key (allowlist de 5 rutas) — ver routes/CLAUDE.md.
- `keep()` (`tmdb.ts:72`) y `detail().excluded` (`:113`) = `is_excluded` del desktop; cambiar uno obliga a cambiar el golden y Rust.
- Funciones con golden (`parse`, `detail`, `firstTrailer`, `peopleOf`, `providersAr`, `showStatus`, `isSpanishSub`) deben coincidir con Rust (`/Users/monti/Documents/Dev/streamonte/packages/golden/`).
- `subs.ts:10` UA `VLSub 0.11.1` es el único que acepta OS.org anónimo.
- Premium: solo `POST /api/premium/[id]` gasta cuota; buscar no.
- Comentarios en `schema.sql`/`track.ts` mencionan `.js` (archivos ya son `.ts`).

## Tests / chequeos
`golden.test.ts` (corre en tmp, `delete VERCEL`), `torrents.test.ts`, `torbox.test.ts`, `tmdb.test.ts`, `subs.test.ts`, `mkv.test.ts`, `magnet.test.ts`, `imdb.test.ts`. `npm test` desde `/Users/monti/Documents/Dev/streamonte/web/`.
