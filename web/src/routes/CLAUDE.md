# web/src/routes — páginas y API (SvelteKit file routing)
Páginas Svelte (`+page.svelte`) que pegan a `/api/*` (`+server.ts`, delgados: validan con `params.ts episode()` y llaman a `lib/server/`). Rutas bajo `/Users/monti/Documents/Dev/streamonte/web/src/routes/`. Candado de acceso y cookies globales en `../hooks.server.ts:64`.

## Páginas
- `+layout.server.ts:5 load` → `langs` (de `locals`) y `nick` (cookie).
- `+layout.svelte` — importa `app.css`; fija `i18n` antes del 1er render; `track('entrar')`; bienvenida `<Tour>` 1ª vez (`welcomeSteps`/`nickStep`); aviso "hay versión nueva" (`updated`); solo dev: recarga al volver si cambió el código (`/api/dev-stamp` `:83`).
- `+page.svelte` (home, 1306 líneas) — Explorar: filtros (tipo/orden/fechas con scrub/votos/idioma/géneros), grilla infinita vía `cat`/`loadMore` (`catalog.svelte.ts` → `/api/catalog`), búsqueda + sugerencias `/api/people` `:339`, persona → `/api/catalog?person=`; `track('filtro'|'buscar'|'actor'|'director')`; `/api/keys` `:55` para avisar si faltan keys.
- `t/[kind]/[id]/+page.ts:6 load` → `/api/title/…` (caché `saved.DAY`) · `+page.svelte` — ficha: póster/datos/elenco/dónde ver; película → `<Torrents>` `:189`; serie → temporadas (`SeasonChart`, `/api/scores/[imdb]` `:55`) y episodios (`/api/season/…` `:95`, `?s=N`); `onlyCinema` aviso.
- `t/[kind]/[id]/[s]/[e]/+page.ts:7 load` → título + temporada, valida s/e · `+page.svelte` — capítulo → `<Torrents s e>` `:41`. Solo `kind=tv`.
- `m/[hash]/+page.svelte` — "Pegar magnet": `/api/magnet` GET `:20` (estado/avance, `who=1` identifica en TMDB) y POST `:42` (bajar en TorBox); `<Torrents given=… >` `:103` con los videos del torrent. Hash 40 hex.
- `ajustes/+page.svelte` — idioma (`LangPicker`), apodo (`saveNick`), keys (`/api/keys` GET/POST `:67-93`), borrar caché (`wipe`), entrada a admin (`AdminCode`).
- `admin/+page.server.ts` — `:9 load` (cookie `admin` + `attempt('admin:ip')`; consultas a `eventos` vía `sql()`: resumen, días, usuarios, equipos, eventos) · `:77 actions` login (cookie httpOnly `admin`) y borrar usuario/dispositivo (`DELETE FROM eventos`) · `+page.svelte` — panel de uso.

## API (todas por `route()` salvo indicado)
- `api/catalog/+server.ts:10 GET` → `tmdb.discover` | `personTitles` | `search` (query saneada: kind, sort, from/to, votes∈`VOTES`, lang, genres, page≤30).
- `api/genres :4` → `tmdb.genres` · `api/people :5` → `tmdb.people` · `api/title/[kind]/[id] :4` → `tmdb.title` · `api/season/[id]/[n] :4` → `tmdb.season` · `api/scores/[imdb] :4` → `imdb.seasonScores`.
- `api/torrents :8 GET` → `torrents.torrents` con progreso; respuesta NDJSON (`{stage,done,total}`…`{result}`/`{error}`), `no-store`.
- `api/link :5` → `torbox.link` (hash 40 hex, name, file, s/e, orig) · `api/tracks :7` → `torbox.tracks` (con `tid`/`fid` evita re-agregar).
- `api/subs :5` → `subs.search` (OS.org; `hash`+`size` = match exacto) · `api/subs/[id] :5` → `subs.download` (.srt con BOM / `ext=ass`) · `api/subs/[id]/[file]` re-exporta el anterior (URL termina en `.srt` para Web Video Caster).
- `api/premium :6 GET` → `premiumSearch`+`premiumQuota` (no gasta) · `api/premium/quota :5` → `premiumQuota` · `api/premium/[id] :5 POST` → `premiumDownload` (GASTA 1) / `:8 GET` → `premiumFile` (sirve lo bajado) · `…/[id]/[file]` re-exporta GET.
- `api/magnet :5 GET` → `magnet.status` (+`identify`) · `:13 POST` → `magnet.download`.
- `api/keys :15 GET` (qué keys hay, sin valores) · `:16 POST` → `keys.setKeys`.
- `api/nick :6 POST` → cookie `nick` + `UPDATE eventos SET apodo` de ese dispositivo.
- `api/track :6 POST` (sin `route`) → `track.track` (`a`,`d`,`dev`,`z`); `hooks.server.ts:95` lo deja pasar sin código (lo manda `play.html` desde otro navegador).
- `api/desktop/torbox/[...path] :48 GET/:49 POST` — proxy para el desktop ("Usar TorBox de Streamonte"): allowlist `ALLOWED :10` (checkcached, mylist, requestdl, createstream GET; createtorrent POST); pone la key del servidor, `no-store`, nunca la reenvía (`:40`).
- `api/dev-stamp :9` — solo dev, mtime de `src/`.

## Flujo
- Ver algo: home → `/api/catalog` → ficha `/t/…` → `/api/title` → `<Torrents>` → `/api/torrents` → `/api/link` (+`/api/tracks`) → `/api/subs`|`/api/premium` → copiar al portapapeles.
- Magnet: `/m/[hash]` → `/api/magnet` → (POST bajar) → `<Torrents given>` → mismo camino de link/subs.
- Desktop Rust → `/api/desktop/torbox/*` (con cookie `code`) → TorBox.

## Reglas / trampas
- `hooks.server.ts:97`: `/api/*` bloqueado devuelve 429 (no 401: el desktop toma 401 como código incorrecto y borra el guardado) o 401 si falta código.
- Admin: contraseña en cookie tal cual (`shortcut`), cada lectura cuenta como intento (`+page.server.ts:14`).
- `/api/desktop/torbox`: agregar ruta = tocar `ALLOWED` y el cliente Rust (`crates/core/src/catalog/torbox.rs`).
- `api/premium/[id]` POST solo con toque del usuario (gasta cuota diaria).
- `api/torrents` no usa `json()`: errores van dentro del stream.
- Páginas de ficha cachean `/api/title` 1 día en localStorage (`saved.DAY`, versión `title` en `saved.ts:11`).

## Tests / chequeos
Sin tests de rutas; la lógica se prueba en `lib/server/*.test.ts`. `npm run check` valida los `$types`.
