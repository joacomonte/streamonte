# Estilo visual de Streamonte (carbón neumórfico · variante B "Flotante")

Convención obligatoria para toda UI nueva, en desktop y web. Tokens en `/Users/monti/Documents/Dev/streamonte/packages/ui/css/tokens.css`; todo lo renderizado en `/Users/monti/Documents/Dev/streamonte/docs/estilo/ejemplo.html` (abrirlo en el navegador).

## Principios
- Carbón neutro, sin tinte azul: la página es `--bg` (#151618); paneles, diálogos y tiles son `--nu-bg` (#1c1d21). Solo tema oscuro. Referencia: `/Users/monti/Documents/Dev/streamonte/docs/mockups/carbon-neu/index.html?v=b`.
- **Flotante**: paneles, diálogos, menús y avisos flotan con `--nu-float` (sombra grande y difusa + luz muy tenue arriba-izquierda); tiles y cards con `--nu-raise`.
- **Elevado = elegible / recomendado / elegido** (`--nu-raise*`). **Hundido = el resto**: canales, inputs, contenedores, etiquetas (`--nu-well` + `--nu-press`).
- **Botón primario: sólido ámbar de acento** (`.nu-solid`, tokens `--nu-solid-*`): ámbar #f2a93b lleno, texto oscuro (#1d1406), radio de card (12 px), relieve solo por sombras. Uno por tarjeta/paso, para la acción principal (Usar, Ver T·E, Todos, Deshacer). Cuadrado = solo ícono (▶, ›).
- El ámbar también marca contenido (votos ★, cinta de años, ícono de tipo): ahí es texto o trazo, nunca relleno. El primario se distingue por la forma llena + texto oscuro; no cambiar esos colores de contenido.
- Secundario: neu elevado neutro (`.nu-lift`) o ghost gris (sin fondo, texto `--muted`). Controles redondos (volver, cerrar, flechas): `.nu-round` dentro de un aro hundido `.nu-ring` (`--nu-ring`).
- Nada de botones "normales" (fondo plano + borde), ni azul sólido (`--accent` de fondo), ni vidrio esmerilado en botones. Elegido/aplicado = filo de luz (`--nu-on-edge`), no borde azul.
- Azul solo como indicador: barras de progreso, spinner, eyebrow, anillo de `:focus-visible` (`--accent-fg`).
- Baldosa con imagen de fondo: fade a oscuro (`--fade-dark` / `.fade-dark`, o lateral de izquierda a derecha), nunca tintes de color.
- Tipografía: Plus Jakarta Sans (`--display`), títulos 700–800 con `letter-spacing: -0.02em`; números con `font-variant-numeric: tabular-nums`.
- Radio: controles, chips, inputs, filas y tiles usan `--nu-radius` (10 px, el de las cards de pósters de `Grid.svelte`); primario sólido `--nu-solid-radius` (12 px); paneles `calc(var(--nu-radius) + 14px)`. Nada de píldoras 999 px; un canal que envuelve hijos = `calc(var(--nu-radius) + <padding>)`. Etiquetas y contadores chicos: `--r-xs`. Botón ícono: círculo.
- Relieve solo con sombras difusas. Sin bordes ni esquinas iluminadas: nada de filo claro arriba ni borde de luz (la luz arriba-izquierda de `--nu-float`/`--nu-raise` es difusa, no un filo).
- Sombras grandes: los rieles con scroll horizontal necesitan padding vertical generoso (y margen negativo) para no cortarlas.
- Espaciado `--sp-*`, movimiento `--out` (entra) y `--ease`.

## Tokens `--nu-*`
| Token | Qué es | Cuándo |
|---|---|---|
| `--nu-bg` | Superficie carbón (#1c1d21) | Paneles, diálogos, hojas, fondo de tiles |
| `--nu-radius` | Radio de las cards (= `--r-md`, 10 px) | Botones, chips, pastillas, inputs, filas, tiles |
| `--nu-tile` | Cara apenas más clara, pareja (blanco 3 % → 1,2 %) | Encima de `--nu-bg` en paneles, tiles y elegidos |
| `--nu-float` | Sombra de lo que flota (caída larga + contacto + luz difusa) | Paneles, diálogos, menús, toasts |
| `--nu-raise` | Elevado (caída + contacto + luz difusa) | Tiles, filas, cards |
| `--nu-raise-sm` | Elevado chico | Segmento elegido, `.nu-lift`, `.nu-round`, chips, tarjeta recomendada |
| `--nu-raise-hover` | Elevado en hover | Hover de tiles/filas/controles (+ `translateY(-1px)`) |
| `--nu-well` | Fondo hundido (negro 24 %) | Inputs, canales de segmentados, pozos de íconos, aros |
| `--nu-press` | Sombra hundida | Pozos grandes, `:active` de un tile |
| `--nu-press-sm` | Hundido chico | Etiquetas, contadores, canal del segmentado, `:active` de controles |
| `--nu-well-focus` | Filo de luz interior | `:focus-within` de un input hundido |
| `--nu-on-edge` | Filo de luz 1,5 px | Tile/fila elegida o aplicada (va antes de `--nu-raise`) |
| `--nu-ring` | Aro hundido | Alrededor de un control redondo (`.nu-ring`) |
| `--nu-solid` / `-hover` | Ámbar del primario (#f2a93b / #f6b754) | Fondo de `.nu-solid` |
| `--nu-solid-fg` | Texto oscuro del primario | Siempre con `--nu-solid` |
| `--nu-solid-face` | Brillo de la cara (degradé blanco 14 % → 0) | Encima de `--nu-solid` |
| `--nu-solid-radius` / `-h` | Radio 12 px / alto del cuadrado 52 px | Primario sólido |
| `--nu-solid-shadow` / `-hover` / `-press` | Relieve del primario (caída + halo ámbar) | Reposo / hover / `:active` |
| `--fade-dark` | Fade a oscuro vertical | Texto sobre imagen |

Clases compartidas (`/Users/monti/Documents/Dev/streamonte/packages/ui/css/components.css`): `.nu-solid` (primario), `.nu-lift` (elevado neutro), `.nu-ring` + `.nu-round` (control redondo en aro). Si toda la tarjeta es el botón, el primario va como `<span class="nu-solid">` adentro: reacciona al hover/active de la tarjeta.

## Recetas (copiar y renombrar la clase)
```css
/* Botón primario: sólido ámbar (= .nu-solid de components.css) */
.primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border: 0; border-radius: var(--nu-solid-radius); background: var(--nu-solid-face), var(--nu-solid); color: var(--nu-solid-fg); font-weight: 750; box-shadow: var(--nu-solid-shadow); transition: transform 0.2s var(--out), box-shadow 0.2s var(--out); }
@media (hover: hover) { .primary:hover { --nu-solid: var(--nu-solid-hover); box-shadow: var(--nu-solid-shadow-hover); transform: translateY(-1px); } }
.primary:active { box-shadow: var(--nu-solid-press); transform: scale(0.96); }
/* Cuadrado solo ícono (▶ en una tarjeta): */
.primary.sq { width: var(--nu-solid-h); height: var(--nu-solid-h); padding: 0; }

/* Botón secundario: neu elevado neutro (= .nu-lift) */
.lift { height: 40px; padding: 0 14px; border: 0; border-radius: var(--nu-radius); background: var(--nu-tile), var(--nu-bg); box-shadow: var(--nu-raise-sm); color: #fff; }
@media (hover: hover) { .lift:hover { box-shadow: var(--nu-raise-hover); transform: translateY(-1px); } }
.lift:active { box-shadow: var(--nu-press-sm); transform: scale(0.98); }

/* Botón secundario: ghost gris */
.ghost { height: 36px; padding: 0 12px; border: 0; border-radius: var(--nu-radius); background: none; color: var(--muted); font-weight: 600; }
@media (hover: hover) { .ghost:hover { color: var(--text); background: rgb(255 255 255 / 0.05); } }

/* Botón ícono redondo en aro hundido (= .nu-ring + .nu-round): cerrar, volver, chevron */
.ring { display: inline-grid; place-items: center; padding: 4px; border-radius: 50%; background: var(--nu-well); box-shadow: var(--nu-ring); }
.round { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; background: var(--nu-tile), var(--nu-bg); box-shadow: var(--nu-raise-sm); color: var(--text); }
@media (hover: hover) { .round:hover { box-shadow: var(--nu-raise-hover); color: #fff; } }
.round:active { box-shadow: var(--nu-press-sm); transform: scale(0.95); }

/* Panel / diálogo que flota */
.panel { border-radius: calc(var(--nu-radius) + 14px); background: var(--nu-tile), var(--nu-bg); box-shadow: var(--nu-float); }

/* Tile elevado */
.tile { border-radius: var(--nu-radius); background: var(--nu-tile), var(--nu-bg); box-shadow: var(--nu-raise); transition: box-shadow 0.25s var(--out), transform 0.25s var(--out); }
@media (hover: hover) { .tile:hover { box-shadow: var(--nu-raise-hover); transform: translateY(-1px); } }
.tile:active { box-shadow: var(--nu-press); transform: scale(0.99); }
.tile.on { box-shadow: var(--nu-on-edge), var(--nu-raise); }

/* Pozo hundido (contenedor, ícono, etiqueta) */
.well { padding: 6px; border-radius: calc(var(--nu-radius) + 6px); background: var(--nu-well); box-shadow: var(--nu-press); }
.tag { padding: 2px 8px; border-radius: var(--r-xs); background: rgb(0 0 0 / 0.3); box-shadow: var(--nu-press-sm); color: rgb(255 255 255 / 0.78); font-size: 11px; font-weight: 700; }

/* Segmentado / chips: canal hundido, elegido elevado, resto ghost */
.seg { display: flex; gap: 4px; padding: 4px; border-radius: calc(var(--nu-radius) + 4px); background: var(--nu-well); box-shadow: var(--nu-press-sm); }
.seg button { height: 32px; padding: 0 12px; border: 0; border-radius: var(--nu-radius); background: none; color: var(--muted); font-weight: 650; }
.seg button[aria-checked='true'] { background: var(--nu-tile), var(--nu-bg); box-shadow: var(--nu-raise-sm); color: #fff; }

/* Input hundido (foco sutil, sin anillo azul) */
.field { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 16px; border-radius: var(--nu-radius); background: var(--nu-well); box-shadow: var(--nu-press); color: var(--muted); }
.field:focus-within { background: rgb(0 0 0 / 0.26); box-shadow: var(--nu-press), var(--nu-well-focus); color: var(--text); }
.field input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--text); font-size: 16px; }

/* Fila de lista: tile elevado con ícono, texto y chevron gris (o el primario sólido si es la acción) */
.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 0; border-radius: var(--nu-radius); background: var(--nu-tile), var(--nu-bg); box-shadow: var(--nu-raise); color: #fff; text-align: left; }

/* Card con imagen de fondo: imagen + fade a oscuro + brillo del tile */
.card { position: relative; isolation: isolate; overflow: hidden; border-radius: var(--nu-radius); background: var(--nu-bg); box-shadow: var(--nu-raise); }
.card .img { position: absolute; inset: 0; z-index: -2; background: center / cover; }
.card::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--nu-tile), linear-gradient(to right, rgb(12 12 14 / 0.94), rgb(12 12 14 / 0.84) 45%, rgb(12 12 14 / 0.4)); }

/* Estados comunes */
.x:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
.x:disabled { opacity: 0.4; box-shadow: none; cursor: default; }
```

## Ejemplos reales
- Primario sólido cuadrado (▶) en la barra de opciones, controles redondos en aro, Deshacer sólido: `/Users/monti/Documents/Dev/streamonte/packages/ui/src/catalog/RecentRow.svelte`.
- Tarjeta recomendada elevada con el primario sólido adentro (`.go.nu-solid`), resto en pozo: `/Users/monti/Documents/Dev/streamonte/packages/ui/src/subs/NativeSubs.svelte` (`.best`, `.rest`, `.tag`); "Buscar más" = secundario neu: `/Users/monti/Documents/Dev/streamonte/packages/ui/src/subs/SubsPicker.svelte`.
- Card elevada con abanico de pósters: `/Users/monti/Documents/Dev/streamonte/packages/ui/src/catalog/TrendingRow.svelte` (`.nc .box`).
- Input hundido con cruz en aro, segmentado de chips, filas tile con póster y chevron gris, desplegable que flota: `/Users/monti/Documents/Dev/streamonte/packages/ui/src/catalog/Search.svelte`.
- Diálogo que flota, tiles con imagen + fade, ícono en pozo, "Todos" sólido ámbar, cerrar redondo en aro: `/Users/monti/Documents/Dev/streamonte/packages/ui/src/catalog/GenrePicker.svelte`.
- Panel de filtros que flota con pastillas `.nu-lift`: `/Users/monti/Documents/Dev/streamonte/packages/ui/src/catalog/Catalog.svelte` (`.filters-panel`) + `/Users/monti/Documents/Dev/streamonte/packages/ui/css/components.css`.
- Selector del desktop (`.pk*`: panel que flota, ‹ en aro, tarjeta recomendada con primario sólido ▶/›, pasos hundidos con barra azul de progreso): `/Users/monti/Documents/Dev/streamonte/ui/styles.css` + `/Users/monti/Documents/Dev/streamonte/ui/src/audio-picker.ts`.

## Do / Don't
- Do: usar los tokens `--nu-*` y las clases `.nu-solid`, `.nu-lift`, `.nu-ring` + `.nu-round`; si falta una sombra, agregarla a `tokens.css` con un comentario de cuándo usarla.
- Do: un solo primario sólido ámbar por tarjeta/paso (la acción principal); lo demás neu o ghost.
- Do: paneles y diálogos con `--nu-float`; lo elegible/recomendado elevado; contenedores, inputs y lo demás hundido.
- Do: hover que eleva o ilumina (`--nu-raise-hover`, `--nu-solid-shadow-hover`); `:active` que hunde (`--nu-press*`, `--nu-solid-press`).
- Do: texto sobre imagen con fade a oscuro y blanco puro; dar `id` a todo elemento interactivo.
- Don't: ámbar lleno para algo que no sea la acción principal, ni cambiar el ámbar de contenido (★, cinta, ícono de tipo) a relleno.
- Don't: `background: var(--accent)` ni ningún azul lleno; bordes azules para marcar lo elegido.
- Don't: vidrio esmerilado (frosted) en botones; botones con fondo plano + borde (`.btn` viejo) ni pill blanca sólida para el activo.
- Don't: tintes azulados en superficies (el carbón es neutro); hover gris lavado (fondo claro plano) ni tintes de color sobre imágenes.
- Don't: bordes iluminados (filo claro arriba, borde degradado de luz) ni píldoras 999 px.
- Don't: sombras sueltas inventadas en el componente cuando existe el token.
