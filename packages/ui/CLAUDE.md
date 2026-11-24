# packages/ui — código compartido web ↔ desktop (TS estricto, sin `any`)
Alias `$ui` → `src/` (web: `web/vite.config.ts`; desktop: `ui/vite.config.ts`). Sin node_modules propio (usa los de `ui/`).

## Para X → andá a Y (`packages/ui/src/`)
- Contrato con las apps: `types.ts` (tipos de vista) + `api.ts` (`Api`) + `context.ts` (`getApi`/`setApi`).
- Regla de latino, badges de audio → `latino.ts`, `audio.ts`; ranking/calidad (`TYPICAL_MBPS`) → `rank.ts`; match de subs → `sub-match.ts`.
- Formatos (`humanBytes`, `mbps`) → `format.ts`; temporadas → `season.ts`; magnet → `magnet-hash.ts`.
- Por área (cada una con CLAUDE.md): `catalog/` · `options/` · `flow/` · `title/` · `subs/` · `magnet/` · `components/` · `i18n/`.
- CSS → `css/` (`packages/CLAUDE.md`).

## Convenciones
- Imports internos relativos con `.ts`. Lo que prueba `node --test` se importa por ruta relativa, no `$ui`.
- Sin `$app` ni Tauri acá. Texto nuevo → `i18n/en.ts`.
- Una regla de dominio vive en UN archivo; las apps no la copian.

## Cómo se prueba
- Tests junto al código: `*.test.ts`. `cd packages/ui && pnpm test && pnpm check`; todo: `sh scripts/check.sh`.
- `packages/ui/test/` (Api falsa + fixtures) y los `*.flow.test.ts` de `options/`, `subs/`, `magnet/` prueban flujos sin navegador (WP-H). `sh scripts/test-touched.sh` corre solo los tests de lo tocado (~1,4 s).
