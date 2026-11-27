# packages/ui — código compartido web ↔ desktop (TS estricto, sin `any`)
Alias `$ui` → `src/` (web: `web/vite.config.ts`; desktop: `ui/vite.config.ts`). devDeps propias (`typescript`, `svelte`, `svelte-check`) en el workspace pnpm de la raíz.

## Para X → andá a Y (`packages/ui/src/`)
- Contrato con las apps: `types.ts` (tipos de vista) + `api.ts` (`Api`, incluye `nick`) + `context.ts` (`getApi`/`setApi`). Método nuevo en `Api` → `web/src/lib/webApi.ts`, `ui/src/tauriApi.ts` y `test/fake-api.ts`.
- Latino y badges de audio → `latino.ts`, `audio.ts`; ranking/calidad (`TYPICAL_MBPS`) → `rank.ts`; match de subs → `sub-match.ts`.
- Formatos (`humanBytes`, `mbps`) → `format.ts`; temporadas → `season.ts`; magnet → `magnet-hash.ts`.
- Por área (cada una con CLAUDE.md, salvo `settings/`): `settings/` (Section, Idioma, KeyRow, KeyField + keys-form.svelte.ts, MissingKeys, keys.ts: lo común de Ajustes; las apps inyectan un KeysAdapter; `settings/board/`: tablero de fichas + ilustraciones SVG, estilos en `css/board.css`) · `catalog/` · `options/` · `flow/` · `title/` · `subs/` · `magnet/` · `components/` · `i18n/` · `animals/` (apodo y código de 2 animales).
- CSS → `css/` (abajo).

## CSS compartido (`css/`)
- `tokens.css` (`:root`, solo oscuro) · `base.css` · `components.css` (`.btn` `.chip` `.pill` `.badge` `.sheet` `.menu` `.fade-dark` `.nu-lift` `.nu-solid` `.nu-ring` `.nu-round`) · `settings.css` (`.st-*`) · `options.css` (`.cat-*`). Lo importan `web/src/app.css` y `ui/src/main.ts`.
- Botones: primario sólido ámbar de acento (variante B carbón, `.nu-solid`), secundarios neu (`.nu-lift`, `.nu-round` en `.nu-ring`) o ghost gris; nunca azul sólido (`--accent` de fondo) ni botones planos estándar. <!-- mem:streamonte#164 -->
- UI nueva: seguir `docs/estilo/README.md` (obligatorio: tokens `--nu-*`, radio `--nu-radius`, recetas; referencia visual `docs/estilo/ejemplo.html`).
- Baldosa/tarjeta con imagen de fondo: fade a oscuro (`--fade-dark`, `.fade-dark`), no tintes. CSS sin prefijo: cuidado con colisiones; el layout de cada pantalla, scoped. Sin test: `scripts/shot.mjs`.
- `packages/golden/` (vectores Rust ↔ web) → `packages/golden/CLAUDE.md`. Sin build propio.

## Convenciones
- Imports internos relativos con `.ts`. Lo que prueba `node --test` se importa por ruta relativa, no `$ui`.
- Sin `$app` ni Tauri acá. Texto nuevo → `i18n/` (`i18n/CLAUDE.md`).
- Una regla de dominio vive en UN archivo; las apps no la copian. Las que comparte Rust: golden (`packages/golden/CLAUDE.md`).

## Cómo se prueba
- Tests junto al código: `*.test.ts`. `cd packages/ui && pnpm test && pnpm check`; todo: `sh scripts/check.sh`.
- `packages/ui/test/` (Api falsa + fixtures) y los `*.flow.test.ts` de `options/`, `subs/`, `magnet/` prueban flujos sin navegador (WP-H). `sh scripts/test-touched.sh` corre solo los tests de lo tocado (~1,4 s).
