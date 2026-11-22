# streamonte/web — web (SvelteKit 2, Svelte 5 runes, TS)
Versión web de Streamonte (celu/tele): catálogo TMDB+IMDb → torrents en caché de TorBox → link https + subs en español para copiar a un reproductor (Web Video Caster, Just Player, SenPlayer). Comparte reglas y CSS con el desktop Rust.

## Mapa (`/Users/monti/Documents/Dev/streamonte/web/`)
- `src/hooks.server.ts:64 handle` — cookie `dev`, idiomas del pedido (`langStore`), candado `APP_PASSWORD` (cookie `code`, 3 dígitos), Accept-CH.
- `src/routes/` — páginas y API → `src/routes/CLAUDE.md`
- `src/lib/` — cliente (tipos, ranking, i18n, componentes) → `src/lib/CLAUDE.md`
- `src/lib/server/` — TMDB, IMDb, TorBox, subs, DB → `src/lib/server/CLAUDE.md`
- `src/app.css` — importa `/Users/monti/Documents/Dev/streamonte/packages/ui/css/{tokens,base,components}.css` + estilos propios (.topbar…) → `/Users/monti/Documents/Dev/streamonte/packages/CLAUDE.md`
- `db/schema.sql` — tablas Neon `eventos` (uso) e `intentos` (límite de códigos). Idempotente.
- `.data/` — cachés locales gitignoreadas: `keys.json`, `tmdb-fichas.json`, `title.ratings.tsv.gz`, `title.episode.tsv.gz`, `imdb-temporadas.tsv`, `premium/`. En Vercel van a `/tmp` (efímero).
- `vite.config.ts:11` — adapter: Vercel si `process.env.VERCEL`, si no node. `version.pollInterval` 5 min (aviso "hay versión nueva").
- `package.json` — alias `#lib` → `src/lib/index.ts`, `#lib/*` → `src/lib/*`.
- `TS-MIGRATION.md` — reglas de la migración JS→TS.

## Cómo correr
- `npm run dev` (`vite dev --host`) · `npm run build` · `npm run preview`
- `npm run check` = `svelte-kit sync && svelte-check` (tipos)
- `npm test` = `node --test "src/**/*.test.{js,ts}"`. Node 24 (`.nvmrc`) con type stripping nativo: imports siempre con extensión `.ts` (`'#lib/server/x.ts'`, `'./x.ts'`), sin `enum`/`namespace`/parameter properties, `import type` explícito.
- Todo el repo: `/Users/monti/Documents/Dev/streamonte/scripts/check.sh` (corre `check` + `test` de web). CI: `/Users/monti/Documents/Dev/streamonte/.github/workflows/ci.yml` job `web`.

## Deploy (Vercel)
- Proyecto `streamonte-web`, linkeado en la RAÍZ del monorepo (`/Users/monti/Documents/Dev/streamonte/.vercel/project.json`) con Root Directory=`web`. (`web/.vercel/` también existe, con otro `project.json`: no es el link de referencia.)
- `/Users/monti/Documents/Dev/streamonte/.vercelignore` sube solo `web/` y `packages/` (la web importa el CSS de packages), sin `node_modules`/`.svelte-kit`/`.vercel`/`.env*`.
- Prod: `vercel deploy --prod --yes` desde la RAÍZ del monorepo (`.vercel/` raíz → proyecto streamonte-web, Root Directory=web; desde `web/` falla). "push" de la web incluye deploy. Vercel setea `VERCEL=1` → adapter-vercel y cachés en `/tmp`.
- Los tests no corren en Vercel.

## Env vars (solo NOMBRES; chequear con `cut -d= -f1 web/.env.local`, nunca imprimir valores)
- `APP_PASSWORD` — candado de 3 dígitos (`hooks.server.ts:74`); sin ella, sin candado.
- `ADMIN_PASSWORD` — panel `/admin` (`routes/admin/+page.server.ts:10`).
- `DATABASE_URL` — Neon (`lib/server/track.ts:8 sql`); sin ella no hay tracking ni límite de intentos.
- `TMDB_KEY`, `TORBOX_KEY`, `OPENSUBTITLES_KEY`, `OPENSUBTITLES_USER`, `OPENSUBTITLES_PASS` — pisan a `.data/keys.json` (`lib/server/keys.ts:15`). En local se cargan desde `/ajustes`.
- `VERCEL` (la pone Vercel), `VERCEL_OIDC_TOKEN` (la pone `vercel env pull`; no se usa en código).
- `.env.local` es local y gitignoreado; nunca prefijo público (`VITE_`/`PUBLIC_`).

## Flujo (resumen)
home `/` → `/api/catalog` → `tmdb.discover` (+ IMDb ratings) → ficha `/t/[kind]/[id]` → `<Torrents>` → `/api/torrents` (NDJSON) → `/api/link` → `torbox.link` → copiar link (+ `/api/subs`).

## Reglas / trampas
- Los textos de UI/errores en español SON la clave de i18n (`lib/i18n/en.ts`); lo que falte sale en español.
- Respuestas de `/api/*` van por `route()` (`lib/server/http.ts:19`): errores `{message}`, nunca con URL (puede llevar keys).
- Keys de TMDB/TorBox/OpenSubtitles solo en servidor; el navegador solo ve si están cargadas (`/api/keys` GET).
- Desktop ↔ web deben dar lo mismo: `packages/golden/*.json` (ver `/Users/monti/Documents/Dev/streamonte/packages/CLAUDE.md`). Rust es la fuente de verdad.
- Sin dependencias nuevas sin preguntar (única: `@neondatabase/serverless`).

## Tests / chequeos
`*.test.ts` junto al código: `lib/server/{golden,imdb,magnet,mkv,subs,tmdb,torbox,torrents}.test.ts`, `lib/{audio,cinema,torrent-rank}.test.ts`, `lib/i18n/i18n.test.ts`. Sin tests nuevos salvo pedido.
