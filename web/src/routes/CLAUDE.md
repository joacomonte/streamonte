# web/src/routes — páginas y API (SvelteKit file routing)
Páginas `+page.svelte` que pegan a `/api/*` (`+server.ts` delgados: validan con `params.ts episode()` y llaman a `lib/server/`). Candado y cookies globales en `../hooks.server.ts:64`.

## Mapa (`/Users/monti/Documents/Dev/streamonte/web/src/routes/`)
- `+layout.server.ts:5 load` (langs, nick) · `+layout.svelte` — `i18n` antes del 1er render, Tour de bienvenida, aviso de versión, solo dev `/api/dev-stamp :83`.
- `+page.svelte` (home, delgada) — monta `$ui/catalog/Catalog.svelte` con `webCatalog()`: `header` (marca, ES/EN), `top` (`/api/keys` → `#keys-cta`), `onmagnet` → `/m/…`, `onlog` → `track`.
- `t/[kind]/[id]/` — `+page.ts:6 load` (`/api/title`, caché `saved.DAY`) · `+page.svelte` — monta `<TitleView> :69` (`$ui/title/`, `setApi(webApi)`; scores/episodios por `getApi()`), `<Torrents> :84` en su snippet `options`.
- `t/[kind]/[id]/[s]/[e]/` — `+page.ts:7 load` valida s/e · `+page.svelte` `<Torrents s e> :41` (solo `tv`).
- `m/[hash]/+page.svelte` — "Pegar magnet": `<MagnetView>` (`$ui/magnet/`) ← `getApi().magnet` → `/api/magnet` GET/POST; `<Torrents given> :26` vía `web-adapt.ts torrentOf`.
- `ajustes/+page.svelte` — idioma, apodo, keys `/api/keys :67-93`, borrar caché, `AdminCode`.
- `admin/+page.server.ts` — `:9 load` · `:14 attempt` · `:77 actions`; `+page.svelte` panel de uso.
- `api/*/+server.ts` (todas por `route()` salvo indicado): `catalog :10` · `genres :4` · `people :5` · `title/[kind]/[id] :4` · `season/[id]/[n] :4` · `scores/[imdb] :4` · `torrents :8` (NDJSON) · `link :5` · `tracks :7` · `subs :5` · `subs/[id] :5` · `premium :6` · `premium/quota :5` · `premium/[id]` POST `:5` / GET `:8` · `magnet` GET `:5` / POST `:13` · `keys` GET `:15` / POST `:16` · `nick :6` · `track :6` (sin `route`) · `dev-stamp :9`.
- `api/desktop/torbox/[...path]/+server.ts` — proxy para el desktop: `:10 ALLOWED`, `:40` nunca reenvía la key, `:48 GET` / `:49 POST`.

## Trampas
- `hooks.server.ts:97`: `/api/*` bloqueado → 429 (no 401: el desktop lo toma como código incorrecto y borra el guardado), o 401 si falta código. `:95` deja pasar `/api/track` sin código.
- `/api/desktop/torbox`: agregar ruta = tocar `ALLOWED` y `crates/core/src/catalog/torbox.rs`.
- `api/premium/[id]` POST gasta cuota diaria: solo con toque del usuario.
- `api/torrents` no usa `json()`: errores van dentro del stream.
- Admin: contraseña en cookie tal cual (`shortcut`); cada lectura cuenta como intento (`admin/+page.server.ts:14`).
- Auto-recarga tras deploy: `+layout.svelte` `beforeNavigate` (si `updated.current`) y `../hooks.client.ts` `handleError` (chunk que falló, 1 vez/10 s) hacen carga completa al destino en vez de mostrar 500.
- `/api/title` se cachea 1 día en localStorage (versión `title` en `lib/saved.ts:11`).

## Flujo
home → `/api/catalog` → `/t/…` → `/api/title` → `<Torrents>` → `/api/torrents` → `/api/link` (+`/api/tracks`) → `/api/subs`|`/api/premium`.

## Tests
Sin tests de rutas; la lógica se prueba en `lib/server/*.test.ts`.
