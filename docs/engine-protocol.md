# Protocolo núcleo ↔ sidecar de motor (JSON-RPC 2.0 por stdio)

> **Estado: PROPUESTO en F0 — requiere aprobación.** Aplica al sidecar `webtorrent` (Node).
> rqbit usa su propia API HTTP (ver `crates/core/src/engine/rqbit.rs`).

## Transporte
- El núcleo lanza el sidecar como **proceso hijo directo** (sin shell → `&` en magnets no es problema, lección 8).
- **stdin**: peticiones del núcleo. **stdout**: respuestas y notificaciones. Una línea JSON UTF-8 por mensaje.
- **stderr**: texto libre → log `diag::engine`.
- Si stdin se cierra, el sidecar detiene sus torrents **sin borrar datos** y termina (la app murió → no quedan procesos huérfanos, NFR-11). Las carpetas las borra `remove(deleteData)` o `cleanup` (FR-06d, igual que rqbit).

## Arranque
Argumentos: `--max-conns <n>`. Primera línea por stdout:
```json
{"jsonrpc":"2.0","method":"ready","params":{"version":"0.3.0","httpPort":51234}}
```
`version` = versión de este protocolo (`package.json` del sidecar). Si no coincide con la que espera el núcleo (`PROTOCOL_VERSION` en `webtorrent.rs`), el núcleo solo lo avisa en el log.
El servidor HTTP escucha **solo en 127.0.0.1** (NFR-16).

## Métodos (núcleo → sidecar) — espejo de `TorrentEngine`
| Método | params | result |
|---|---|---|
| `add` | `{source:{magnet}\|{torrentFile}, trackers[], downloadDir}` — arranca SIEMPRE sin nada seleccionado (lección 3) | `{handle}` |
| `metadata` | `{handle}` (responde cuando hay metadatos) | `{infoHash, name, files[{index,name,size,offset}], pieceLength, pieceCount, torrentFileBase64}` |
| `prioritizeRanges` | `{handle, fileIndex, ranges[{start,end}]}` — exclusivos: ninguna otra pieza hasta completarlos | `null` |
| `selectFile` | `{handle, fileIndex}` | `null` |
| `streamUrl` | `{handle, fileIndex}` | `{url}` |
| `stats` | `{handle}` | `{downloadedBytes, receivedBytes, downloadSpeedBps, uploadSpeedBps, peers, seeds, progress, paused, ranges[{range,piecesDone,piecesTotal,peersWithMissing}]}` — `receivedBytes`: recibido de la red, verificado o no; `seeds`: peers conectados con todas las piezas |
| `pause` / `resume` | `{handle}` | `null` |
| `remove` | `{handle, deleteData}` | `null` (cuando ya no hay tráfico y la carpeta se borró) |
| `shutdown` | `{}` | `null` cuando todo está detenido (sin borrar datos); el proceso sale después de entregar la respuesta |

## Notificaciones (sidecar → núcleo)
| method | params |
|---|---|
| `rangeReady` | `{handle, fileIndex, range:{start,end}}` |
| `log` | `{handle?, line}` |
| `error` | `{handle?, message}` — con `handle`, ese torrent quedó inutilizable (`metadata` & cía. responden error); sin `handle` tras una excepción no atrapada, el proceso sale con código 1 |

## Errores
JSON-RPC estándar; `error.data.userMessage` opcional en lenguaje claro (si viene, el núcleo lo usa como mensaje).

## Requisitos de implementación (lecciones)
1. Almacenamiento pieza-por-archivo (reusar `tstream-piecestore.mjs` de v1) — lección 1.
2. Arranque sin selección + `prioritizeRanges` exclusivo real: leer los rangos con streams y no seleccionar el archivo hasta `selectFile` — lección 3.
3. `trackers` también como `announce` — lección 4.
