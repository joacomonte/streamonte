# Dropdown de subtítulos — diseño elegido

Referencia visual: `/Users/monti/Documents/Dev/streamonte/docs/mockups/subs-dropdown/ronda-4.html` (selector "Indicador" = palabra con color). Las rondas 1–3 son historia descartada.

## Estructura (de arriba a abajo)
1. **Vienen con el video** (encabezado de grupo). Subs ES nativos del archivo. Sin palabra de nivel (el grupo ya lo dice). Si no hay: una línea tenue en itálica "Este video no trae en español".
2. **Encontrados para vos** (encabezado de grupo). Una sola lista, sin agrupar por proveedor, en este orden:
   Exacto (mismo archivo) → mismo release (grupo + fuente) → mismos fps y duración → resto (latinos primero, después más descargados).
   - **Si el video trae subs ES nativos, esta búsqueda es a pedido**: en su lugar va un botón punteado "Buscar más subtítulos · Por si los del video no te sirven" → spinner "Buscando en Wyzie, Subdivx y OpenSubtitles.org…" → lista.
   - Si no trae nativos, se busca solo (como hoy).
3. **Premium** (opensubtitles.com, cuota diaria): una fila plegada al final, separada por una línea. **Solo aparece después de que se hizo la búsqueda del punto 2.**
   - Título: "Buscar en Premium" · subtítulo "Último recurso · quedan N de M descargas hoy".
   - Si ya probó ≥2 sin suerte, la fila se resalta en ámbar: "¿Ninguno anduvo? Buscá en Premium" · "Probaste N y no sincronizaron · quedan N de M descargas hoy".
   - Al abrirla busca (buscar es gratis); cada resultado tiene botón propio con costo: desktop "Usar · 1", mobile "Copiar · 1" (el "1" en ámbar). Nada se baja solo.
   - Estados: sin key ("Necesita tu API key de opensubtitles.com" + botón Ajustes), buscando, bajando uno (spinner en el botón), vacío ("Tampoco hay en español para S04E06. No se gastó ninguna descarga."), error (+ Reintentar, "No se gastó ninguna descarga"), sin cuota (botones deshabilitados, "usaste las 5 de hoy · vuelven 21:00"), cuota desconocida ("no sé cuántas descargas quedan hoy").

## Fila
- Una sola línea, sin nombre largo del release (queda solo en `title`/tooltip).
- `**Grupo**` (13px, 650) + `fuente resolución` (12.5px, muted) + `LAT` (badge con borde, si es latino) + `· proveedor` (11.5px, muted, se trunca).
- Nativos: `**Latinoamérica**/**España**` + `SRT`/`forzados` + `· pista N`.
- Probado y fallido: grupo y spec tachados + "probado" chico.
- Seleccionado: check azul a la izquierda + fondo acento 16%.
- **Nivel de match a la derecha, palabra chica (11px) con color** — tooltip con el porqué técnico:
  | Nivel | Palabra | Oscuro | Claro |
  |---|---|---|---|
  | Exacto (mismo archivo) | perfecto | `#4ade80` | `#12733a` |
  | Mismo release | muy probable | `#b5d86a` | `#3d7a55` |
  | Mismos fps + duración | probable | `#d9a85b` | `#76681c` |
  | Resto | (nada) | — | — |
  No usar ámbar (`--amber`) para el nivel: queda reservado para "cuesta cuota" en Premium.

## Acciones
- **Desktop**: click en la fila = usar ese subtítulo. Ícono "Bajar a la Mac" aparece al hover/focus a la derecha.
- **Mobile** (hoja desde abajo, mismos grupos): acción principal **copiar** (ícono 40×40 azul con fondo acento), secundaria **bajar** (ícono gris). La palabra de nivel va en una segunda línea debajo del grupo (al lado cortaba la resolución); el proveedor se oculta. Toast "Copiado".
- **Mobile**: botón "Cómo funciona" (pill con ícono ?) arriba a la derecha de la hoja. Tutorial a completar después; por ahora placeholder.

## Supuestos (no confirmados)
- "Copiar" = copiar el subtítulo al portapapeles.
- Cuota de ejemplo 5/día con reset 21:00 (usar lo que devuelva la API).
- Todo interactivo lleva `id`.
