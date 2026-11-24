# web — SvelteKit 2, Svelte 5, TS
Web de Streamonte (celu/tele): catálogo → torrents en caché de TorBox → link https + subs en español. Comparte reglas y UI con el desktop.

## Para X → andá a Y
- Páginas y endpoints → `src/routes/CLAUDE.md`. Cliente (componentes, `webApi`) → `src/lib/CLAUDE.md`. Servidor (TMDB, TorBox, subs) → `src/lib/server/CLAUDE.md`.
- Candado, cookies, idioma → `src/hooks.server.ts`. CSS → `src/app.css` (importa `packages/ui/css`).
- Tablas Neon (`eventos`, `intentos`) → `db/schema.sql`. Adapter Vercel/node, alias `$ui` → `vite.config.ts`.

## Deploy
Proyecto `streamonte-web` linkeado en la RAÍZ del monorepo (Root Directory=`web`); `vercel` se corre desde la raíz, no desde `web/`. Receta con preview + `promote`: `scripts/CLAUDE.md`. `.vercelignore` sube `web/`, `packages/` y lo mínimo del workspace (raíz + `ui/package.json`).

## Env vars
Solo nombres, nunca valores ni prefijo público: `cut -d= -f1 web/.env.local`. Sin `DATABASE_URL` no hay tracking; sin `APP_PASSWORD` no hay candado.

## Trampas
- Node 24, type stripping: imports con `.ts`, sin `enum`/`namespace`/parameter properties, `import type` explícito.
- `.data/` local gitignoreado (en Vercel va a `/tmp`).

## Cómo se prueba
`pnpm test` (`node --test`) y `pnpm check` en `web/`; todo: `sh scripts/check.sh`.
