# Protocolo núcleo ↔ sidecar de motor (JSON-RPC 2.0 por stdio)

> **Estado: PROPUESTO en F0 — requiere aprobación.** Aplica al sidecar `webtorrent` (Node).
> rqbit usa su propia API HTTP (ver `crates/core/src/engine/rqbit.rs`).

## Transporte
- El núcleo lanza el sidecar como **proceso hijo directo** (sin shell → `&` en magnets no es problema, lección 8).
- **stdin**: peticiones del núcleo. **stdout**: respuestas y notificaciones. Una línea JSON UTF-8 por mensaje.
- **stderr**: texto libre → log `diag::engine`.
- Si stdin se cierra, el sidecar borra sus carpetas y termina (la app murió → no quedan huérfanos, NFR-11).

## Arranque
Argumentos: `--max-conns <n>`. Primera línea por stdout:
```json
{"jsonrpc":"2.0","method":"ready","params":{"version":"0.1.0","httpPort":51234}}
```
El servidor HTTP escucha **solo en 127.0.0.1** (NFR-16).

## Métodos (núcleo → sidecar) — espejo de `TorrentEngine`
| Método | params | result |
|---|---|---|
| `add` | `{source:{magnet}\|{torrentFile}, trackers[], downloadDir, onlyFile?, startDeselected}` | `{handle}` |
| `metadata` | `{handle}` (responde cuando hay metadatos) | `{infoHash, name, files[{index,name,size,offset}], pieceLength, pieceCount, torrentFileBase64}` |
| `prioritizeRanges` | `{handle, fileIndex, ranges[{start,end}], mode:"exclusive"\|"high"}` | `null` |
| `selectFile` | `{handle, fileIndex}` | `null` |
| `streamUrl` | `{handle, fileIndex}` | `{url}` |
| `stats` | `{handle}` | `{downloadedBytes, downloadSpeedBps, uploadSpeedBps, peers, progress, paused, ranges[{range,piecesDone,piecesTotal,peersWithMissing}]}` |
| `pause` / `resume` | `{handle}` | `null` |
| `remove` | `{handle, deleteData}` | `null` (cuando ya no hay tráfico y la carpeta se borró) |
| `shutdown` | `{}` | `null`, luego el proceso sale |

## Notificaciones (sidecar → núcleo)
| method | params |
|---|---|
| `metadata` | `{handle, ...metadata}` |
| `rangeReady` | `{handle, fileIndex, range:{start,end}}` |
| `log` | `{handle?, line}` |
| `error` | `{handle?, message}` |

## Errores
JSON-RPC estándar; `error.data.userMessage` opcional en lenguaje claro.

## Requisitos de implementación (lecciones)
1. Almacenamiento pieza-por-archivo (reusar `tstream-piecestore.mjs` de v1) — lección 1.
2. `startDeselected` + `prioritizeRanges(exclusive)` real: leer los rangos con streams y no seleccionar el archivo hasta `selectFile` — lección 3.
3. `trackers` también como `announce` — lección 4.
