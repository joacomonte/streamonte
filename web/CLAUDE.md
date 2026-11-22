# streamonte/web — SvelteKit 2, Svelte 5 runes, TS
Web de Streamonte (celu/tele): catálogo TMDB+IMDb → torrents en caché de TorBox → link https + subs en español para copiar a un reproductor. Comparte reglas y CSS con el desktop Rust.

## Mapa (`/Users/monti/Documents/Dev/streamonte/web/`)
- `src/hooks.server.ts` — `:64 handle` cookie `dev`, idiomas (`langStore`), candado `APP_PASSWORD` `:74`.
- `src/routes/` → `src/routes/CLAUDE.md` · `src/lib/` → `src/lib/CLAUDE.md` · `src/lib/server/` → `src/lib/server/CLAUDE.md`
- `src/app.css` — importa el CSS de `/Users/monti/Documents/Dev/streamonte/packages/CLAUDE.md`.
- `db/schema.sql` — tablas Neon `eventos` e `intentos`, idempotente.
- `.data/` — cachés locales gitignoreadas (en Vercel van a `/tmp`).
- `vite.config.ts` — adapter Vercel si `process.env.VERCEL`, si no node; `version.pollInterval` 5 min.
- `package.json` — alias `#lib` → `src/lib/index.ts`, `#lib/*` → `src/lib/*`.

## Deploy (Vercel)
- Proyecto `streamonte-web`, linkeado en la RAÍZ del monorepo (`/Users/monti/Documents/Dev/streamonte/.vercel/project.json`, Root Directory=`web`). `web/.vercel/` tiene otro `project.json`: no es el link.
- Prod: `vercel deploy --prod --yes` desde la RAÍZ (desde `web/` falla). "push" de la web incluye deploy.
- `/Users/monti/Documents/Dev/streamonte/.vercelignore` sube solo `web/` y `packages/`. Los tests no corren en Vercel.

## Env vars (solo NOMBRES; `cut -d= -f1 web/.env.local`, nunca imprimir valores; nunca prefijo público)
`APP_PASSWORD` (candado; sin ella no hay) · `ADMIN_PASSWORD` (`/admin`) · `DATABASE_URL` (Neon; sin ella no hay tracking) · `TMDB_KEY`, `TORBOX_KEY`, `OPENSUBTITLES_KEY`, `OPENSUBTITLES_USER`, `OPENSUBTITLES_PASS` (pisan `.data/keys.json`) · `VERCEL`.

## Trampas
- Node 24 (`.nvmrc`), type stripping: imports con extensión `.ts`, sin `enum`/`namespace`/parameter properties, `import type` explícito.
- Textos de UI en español SON la clave de i18n (`lib/i18n/en.ts`).
- Desktop ↔ web deben dar lo mismo vía `packages/golden/*.json`; Rust es la fuente de verdad.
- Sin dependencias nuevas sin preguntar.

## Flujo
home `/` → `/api/catalog` → ficha `/t/[kind]/[id]` → `<Torrents>` → `/api/torrents` → `/api/link` → copiar (+ `/api/subs`).

## Tests
`npm test` (`node --test`), `npm run check`; todo el repo: `/Users/monti/Documents/Dev/streamonte/scripts/check.sh`.
