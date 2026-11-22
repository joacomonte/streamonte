# packages — código compartido desktop (Rust/Tauri) + web
Dos cosas sin build propio: CSS compartido y vectores de prueba. Absolutas en `/Users/monti/Documents/Dev/streamonte/packages/`. `/.vercelignore` las sube a Vercel junto con `web/`.

## Mapa
### `ui/css/` — CSS compartido (clases SIN prefijo)
- `tokens.css:3 :root` variables (claro por defecto; `:85 @media (prefers-color-scheme: dark)` redefine superficies/texto/estado): `--bg --surface(-2/-3) --sunk --text --muted --dim --border(-strong) --accent(-hover/-text/-fg) --green --yellow --amber --red --ok/--warn/--bad --fit-1..3 --shadow(-lg) --r-xs..--r-pill --tint-1..4 --sp-1..6 --fs-xs/sm/md --display --mono --ease --out --safe-top/bottom`. Unión de `ui/styles.css` (desktop) y `web/src/app.css`; si un nombre tenía dos valores, ganó el de la web (ej. `--display`).
- `base.css` — reset (`* box-sizing`, `:focus-visible`, `button/input/select font`), `.muted`, `.error`, `:13 prefers-reduced-motion`.
- `components.css` — `:4 .btn` (+`-primary -ghost -sm -pill -icon`) · `:46 .chip` (`.on`, `.n`, `.pick select`) · `:69 .pill` · `:84 .badge` (`.res .hdr .lat`) · `:99 .surface` · `:102 .list > .row` · `:108 .skel` (`-line -circle -poster`) · `:118 .spin` · `:130 .bar/.bar-fill` · `:134 .switch` · `:142 .sheet` (`<dialog>`: hoja en mobile, centrado ≥720px `:160`) · `:166 .menu` · `@keyframes` spin/skel/pulse/dim/sheet-up/sheet-pop/pop-in.
- Consumidor hoy: `web/src/app.css:2-4` (`@import '../../packages/ui/css/…'`). Desktop (`ui/index.html` → `ui/styles.css`) AÚN NO adoptó: adopción pendiente.

### `golden/*.json` — vectores compartidos Rust ↔ web
Formato: `[{ "in": …, "out": …, "nota"?: "…", "diverge"?: "web: …" }]`. Rust es la fuente de verdad.
- `release.json` (22) — nombre de release → res/hdr/codec/source/atmos. Rust: `crates/core/tests/it/golden.rs:15`. Web: `torrents.ts:33 parse`.
- `excluded.json` (12) — países/animación → excluido. Rust: `golden.rs:39 is_excluded`. Web: `tmdb.ts:104 detail().excluded`.
- `trailer.json` (14) — videos TMDB → clave YouTube. Rust: `crates/core/src/catalog/tmdb.rs:996`. Web: `tmdb.ts:294 firstTrailer`.
- `providers_ar.json` (14) — providers AR. Rust: `tmdb.rs:1008`. Web: `tmdb.ts:269 providersAr`.
- `people.json` (13) — director + 3 actores. Rust: `tmdb.rs:1018`. Web: `tmdb.ts:279 peopleOf`.
- `show_status.json` (15) — estado y próximo episodio. Rust: `crates/core/src/catalog/seasons.rs:459`. Web: `tmdb.ts:287 showStatus`.
- `sub_lang.json` (20) — nombre de archivo → ¿sub en español?. Rust: `crates/core/src/subtitles/providers/lang.rs:57`. Web: `torbox.ts:13 isSpanishSub`.

## Flujo
Cambio de regla en Rust → actualizar `golden/*.json` → `cargo nextest` (Rust lee con `include_str!`) y `npm test` en web (`web/src/lib/server/golden.test.ts` las lee de `../../../../packages/golden`). Un caso nuevo que la web no cumple: marcarlo `diverge` (se salta en web y se lista al final del test) y arreglarlo después.

## Conexiones
`web/src/lib/server/golden.test.ts:28 golden(name, run)` · Rust: los 6 archivos citados arriba · CSS: `web/src/app.css`.

## Reglas / trampas
- Los golden NO se editan para que pase la web: si Rust y web difieren, el JSON sigue a Rust y el caso lleva `diverge` (hoy 9 casos: people 2, providers_ar 1, release 1, show_status 1, sub_lang 1, trailer 3).
- Rutas relativas de `include_str!` dependen de la profundidad del archivo Rust: mover el .rs rompe el path.
- Los tests golden de web no corren en Vercel (`delete process.env.VERCEL` en `golden.test.ts:15`, y tests fuera del build).
- CSS: clases sin prefijo → cuidado con colisiones al sumar componentes; layout propio de cada pantalla va scoped en su componente, no acá.
- Tokens: el desktop usaba otros valores en algunos nombres; al adoptar, revisar `--display` y los que unió `tokens.css:1-2`.
- `.sheet` usa `<dialog>` nativo (`Sheet.svelte` en web lo envuelve).

## Tests / chequeos
`cd /Users/monti/Documents/Dev/streamonte/web && npm test` (golden web) · `cargo nextest run -p streamonte-core` (golden Rust; ver `/Users/monti/Documents/Dev/streamonte/scripts/check.sh`). CSS: sin test, `npm run check` de web no lo valida.
