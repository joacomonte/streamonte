# web — SvelteKit 2, Svelte 5, TS
Web de Streamonte (celu/tele): catálogo → torrents en caché de TorBox → link https + subs en español. Comparte reglas y UI con el desktop.

## Para X → andá a Y
- Páginas y endpoints → `src/routes/CLAUDE.md`. Cliente (componentes, `webApi`) → `src/lib/CLAUDE.md`. Servidor (TMDB, TorBox, subs) → `src/lib/server/CLAUDE.md`.
- Candado, cookies, idioma → `src/hooks.server.ts`. CSS → `src/app.css` (importa `packages/ui/css`).
- Tablas Neon (`eventos`, `intentos`) → `db/schema.sql`. Adapter Vercel/node, alias `$ui` → `vite.config.ts`.

## Deploy
Proyecto `streamonte-web` linkeado en la RAÍZ del monorepo (Root Directory=`web`); `vercel` se corre desde la raíz, no desde `web/`. Receta con preview + `promote`: `scripts/CLAUDE.md`. `.vercelignore` sube solo `web/` y `packages/`.

## Env vars (solo NOMBRES; nunca imprimir valores ni prefijo público)
`APP_PASSWORD` (candado) · `ADMIN_PASSWORD` (`/admin`) · `DATABASE_URL` (Neon; sin ella no hay tracking) · `TMDB_KEY` `TORBOX_KEY` `OPENSUBTITLES_KEY` `OPENSUBTITLES_USER` `OPENSUBTITLES_PASS` (pisan `.data/keys.json`) · `VERCEL`. Local: `web/.env.local`.

## Trampas
- Node 24, type stripping: imports con `.ts`, sin `enum`/`namespace`/parameter properties, `import type` explícito.
- Textos en español = clave de i18n (`packages/ui/src/i18n/en.ts`).
- Desktop y web dan lo mismo vía `packages/golden`; Rust manda.
- `.data/` local gitignoreado (en Vercel va a `/tmp`).

## Cómo se prueba
`pnpm test` (`node --test`) y `pnpm check` en `web/`; todo: `sh scripts/check.sh`.
