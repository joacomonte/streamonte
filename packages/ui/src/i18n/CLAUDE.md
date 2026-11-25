# i18n/ — textos es → en
El texto en español ES la clave: `t('texto en español')`.

## Para X → andá a Y
- Traducción nueva → `en.ts` (único diccionario; neutros en `NEUTRAL`, dentro de `i18n.test.ts`). Un texto sin traducción hace fallar `i18n.test.ts`.
- `t` y `translate` → `runtime.ts`, `translate.ts`. Idioma reactivo y persistencia → `store.svelte.ts` (`createLangStore`).

## Relación
Cada app aporta solo `{ load, save }`: `web/src/lib/i18n.svelte.ts` y `ui/src/i18n.ts` (el desktop guarda en la config del núcleo y recarga).

## Trampas
- `format.ts` y los modelos puros usan `runtime.ts`, no el store (`store.svelte.ts` no carga en node).
- Cambiar una clave es cambiar el texto español: buscar todos los usos con `rg`.

## Cómo se prueba
`i18n.test.ts` escanea `web/src`, `ui/src`, `packages/ui/src` y `ui/index.html`.
