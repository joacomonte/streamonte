# web/src/lib/server — módulos solo-servidor
TMDB, IMDb, addons de torrents, TorBox, OpenSubtitles y Neon. Los endpoints de `/Users/monti/Documents/Dev/streamonte/web/src/routes/api/` son delgados y llaman acá.

## Mapa
- `http.ts` — `:7 Fail` · `:19 route` · `:33 get` (timeout 12 s; `HTTP_FIXTURES` → `:42 fixture` graba/responde TMDB, addons y OS.org). `lang.ts` — `:8 langStore` · `:12 tx`. `params.ts:2 episode`.
- `keys.ts` — `:15 ENV` · `:17 keys` · `:24 setKeys`.
- `tmdb.ts` — `:42 tmdb` · `:72 keep` · `:80 DIR` · `:90 VOTES` · `:104 detail` · `:119 fillDetails` · `:141 candidates` · `:166 build` · `:185 discover` · `:198 search` · `:216 people` · `:239 personTitles` · `:260 genres` · `:269 providersAr` · `:279 peopleOf` · `:287 showStatus` · `:294 firstTrailer` · `:303 title` · `:347 namesOf` · `:362 season`.
- `imdb.ts` — `:59 ratings` · `:74 imdbOf` · `:88 buildIndex` · `:132 seasonScores`.
- `torrents.ts` — `:7 ADDONS` · `:33 parse` · `:96 otherFilm` · `:107 fileTorrent` · `:116 merge` · `:140 torrents`.
- `torbox.ts` — `:13 isSpanishSub` · `:52 cached` · `:85 link` · `:101 tracks` · `:122 spanishSubs` · `:136 checkFiles` · `:143 mine` · `:158 addMagnet` · `:166 added` · `:199 hls` · `:252 latinoByName` · `:262 download` · `:271 pick`.
- `mkv.ts` — `:41 parseTracks` · `:64 tracksOf` · `:83 isSpanish`. `magnet.ts` — `:16 parseName` · `:30 identify` · `:45 status` · `:60 download`.
- `subs.ts` — OS.org: `:47 search` · `:82 download`; OS.com premium: `:140 premiumQuota` · `:165 premiumSearch` · `:186 premiumDownload` · `:221 premiumFile`.
- `track.ts` — `:8 sql` (null sin `DATABASE_URL`) · `:11 track`. `intentos.ts:10 attempt` (5 fallos/15 min por IP).

## Trampas
- `DIR`: `.data` local, `/tmp/.data` con `VERCEL` (`tmdb.ts:80`, `imdb.ts:11`, `subs.ts:98`): cada cold start re-baja IMDb (~60 MB); `keys.ts:4` siempre `.data`.
- `torbox.ts:262 download`: el link lleva la key → no cachear ni loguear; por eso `tracks` recibe `ids`.
- `keep()` (`tmdb.ts:72`) y `detail().excluded` (`:113`) = `is_excluded` del desktop; cambiar uno obliga a golden y Rust.
- Funciones con golden (`parse`, `detail`, `firstTrailer`, `peopleOf`, `providersAr`, `showStatus`, `isSpanishSub`) deben coincidir con Rust (`/Users/monti/Documents/Dev/streamonte/packages/golden/`).
- `subs.ts:10` UA `VLSub 0.11.1` es el único que acepta OS.org anónimo.
- Solo `POST /api/premium/[id]` gasta cuota premium.

## Flujo
`/api/torrents` → `torrents` → 4 addons → `merge` → `cached` (TorBox) → NDJSON; `/api/link` → `link` → `added` → `hls`/`download` → url https.

## Tests
`golden`, `torrents`, `torbox`, `tmdb`, `subs`, `mkv`, `magnet`, `imdb` `.test.ts`; `golden.test.ts:15` hace `delete VERCEL`.
