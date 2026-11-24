# engine/rqbit/ — submódulos del motor librqbit embebido
Parte de `../rqbit.rs` (`RqbitEmbedded`); librqbit corre en proceso.

## Para X → andá a Y
- Sesión, puerto libre, DHT, log de peers → `net.rs`. Reanudar sin re-verificar piezas → `fastresume.rs`.
- Servidor HTTP con rangos para mpv → `http.rs`.
- `add`, `prioritize_ranges`, `select_file`, `remove`, `shutdown` → `../rqbit.rs`.

## Trampas
- `runtime_worker_threads = 40`: cada stream retiene 1 permiso de E/S (8 por defecto) y `hold_peers` otro; con 8 se traba.
- Solo `Drop`/`shutdown` cancelan la sesión; `shutdown` tarda ~1 s fijo (+ timeout 5 s). En tests, `drop(e)`.
- Seleccionado = los trackers ven `left > 0` y dan seeders.
- `state_dir` = `rqbit-state/<pid>-<n>`; si la app muere queda en %TEMP%.
- librqbit borra su bitfield al quitar el torrent: fastresume lo copia junto a los datos.
