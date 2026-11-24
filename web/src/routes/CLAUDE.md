# web/src/routes — páginas y API (file routing de SvelteKit)
Páginas `+page.svelte` que pegan a `/api/*`; los `+server.ts` son delgados: validan con `server/params.ts` y llaman a `lib/server/`.

## Para X → andá a Y
- Endpoint nuevo → `api/<x>/+server.ts` con `route()` (receta: `docs/recetas/comando-nuevo.md`). Lista: `rg --files web/src/routes/api`.
- Home → `+page.svelte` (monta el catálogo compartido). Ficha → `t/[kind]/[id]/`; episodio → `.../[s]/[e]/`. Magnet pegado → `m/[hash]/`.
- Ajustes (perfil, idioma, keys, datos) → `ajustes/+page.svelte`. Panel de uso → `admin/`.
- Apodo + código de animales → `api/nick/` (GET pregunta el modo, POST crea o prueba y pone la cookie `apodo`, DELETE la borra; `api/nick/animales` GET: los 2 animales solo al dueño). Alertas y reset del código → `admin/`.
- Layout, `setApi`, tour de bienvenida, aviso de versión → `+layout.svelte`, `+layout.server.ts`.
- Stub del TorBox del desktop ≤ v2.1.4 → `api/desktop/torbox/[...path]/` (responde 401 con `{error}`).

## Relación
Usa `lib/server/*` y `$ui/*`. Candado y cookies globales en `../hooks.server.ts`.

## Trampas
- `/api/*` bloqueado → 429 (no 401: el desktop lo toma como código incorrecto y borra el guardado); `/api/track` pasa sin código.
- `api/premium/[id]` POST gasta cuota diaria: solo con toque del usuario.
- `api/torrents` no usa `json()`: es NDJSON, los errores van dentro del stream.
- Admin: contraseña en cookie tal cual; cada lectura cuenta como intento.
- Tras un deploy, `+layout.svelte` y `hooks.client.ts` recargan completo en vez de mostrar 500.
- `/api/title` se cachea 1 día en localStorage (versión en `lib/saved.ts`).

## Cómo se prueba
Sin tests de rutas; la lógica en `lib/server/*.test.ts`. Foto de las respuestas: `node scripts/api-snapshot.mjs`.
