# web — SvelteKit 2, Svelte 5, TS
Web de Streamonte (celu/tele): catálogo → torrents en caché de TorBox → link https + subs en español. Comparte reglas y UI con el desktop.

## Para X → andá a Y
- Páginas y endpoints → `src/routes/CLAUDE.md`. Cliente (componentes, `webApi`) → `src/lib/CLAUDE.md`. Servidor (TMDB, TorBox, subs) → `src/lib/server/CLAUDE.md`.
- Candado, cookies, idioma → `src/hooks.server.ts`. CSS → `src/app.css` (importa `packages/ui/css`).
- Tablas Neon (`eventos`, `intentos`, `vistos`, `apodos`) → `db/schema.sql`. Adapter Vercel/node, alias `$ui` → `vite.config.ts`.

## Deploy
Proyecto `streamonte-web` linkeado en la RAÍZ del monorepo (Root Directory=`web`); `vercel deploy --prod` se corre desde la raíz, no desde `web/` (hay un `.vercel` viejo ahí). Preview + `promote` solo si se pide: `scripts/CLAUDE.md`. `.vercelignore` sube `web/`, `packages/` y lo mínimo del workspace (raíz + `ui/package.json`).

## Env vars
Solo nombres, nunca valores ni prefijo público: `cut -d= -f1 web/.env.local`. `DATABASE_URL`: `src/lib/server/CLAUDE.md`. Sin `APP_PASSWORD` no hay candado.
- `ADMIN_PASSWORD` (panel `admin/`). `TMDB_KEY`, `TORBOX_KEY` y `OPENSUBTITLES_*` pisan lo guardado en Ajustes (`server/keys.ts`).
- `APODO_SECRET`: firma la cookie de sesión del apodo (`apodo`). Obligatorio en Vercel (sin él no se puede entrar con apodo); en local, uno al azar por proceso. Cambiarlo cierra todas las sesiones y vuelve ilegibles los pares cifrados: Ajustes no puede mostrar los 2 animales hasta que el par se rehaga (el dueño acierta el código o el admin lo resetea); los códigos siguen valiendo.

## Trampas
- Node 24, type stripping: imports con `.ts`, sin `enum`/`namespace`/parameter properties, `import type` explícito.
- `.data/` local gitignoreado (en Vercel va a `/tmp`).

## Cómo se prueba
`pnpm test` (`node --test`) y `pnpm check` en `web/`; todo: `sh scripts/check.sh`.
