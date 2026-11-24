# web/src/lib — cliente de la web (navegador + SSR)
Tipos, `Api` de la web, caché de navegador, i18n y componentes propios. Lo compartido está en `packages/ui/src/`.

## Para X → andá a Y
- Cómo la web implementa `Api` → `webApi.ts` (fetch `/api/*`) y `web-adapt.ts` (respuesta → vista, puro). Forma de las respuestas → `types.ts`.
- Lista de opciones y pasos (buscar, link, subs) → `Torrents.svelte` (usa `$ui/options`, `$ui/subs`); tutorial de Web Video Caster → `CastVideo.svelte`.
- Caché localStorage con TTL → `saved.ts`. Catálogo → `catalog.svelte.ts`. Idioma → `i18n.svelte.ts`, `langs.ts`. Apodo/tracking → `nick.ts` (validador), `apodo.svelte.ts` + `ApodoCode.svelte` (apodo + código de animales), `track.ts`.
- Código de admin → `AdminCode.svelte`.

## Relación
Usa `$ui` (rank, audio, latino, formatos, i18n). Lo usan `routes/`. No importa de `server/` salvo `import type`.

## Trampas
- Si cambia el formato de una respuesta cacheada, subir su versión en `saved.ts`.

## Cómo se prueba
`web-adapt.test.ts`, `i18n/i18n.test.ts`; ranking/audio/formato en `packages/ui/src/*.test.ts`.
