# playback/ — reproducciones: motor + precarga + mpv, pausadas guardadas
Un motor propio por reproducción; al cerrar mpv / cambiar de video / cerrar la app la descarga queda pausada y guardada, y se retoma.

## Para X → andá a Y
- Estados, `start`, `stop_all`, `teardown` → `../playback.rs`.
- Pasos de una reproducción (motor → metadata → precarga → mpv → cierre) → `flow.rs`.
- Pausadas guardadas / retomar → `kept.rs`.

## Relación
Usa `engine`, `preload`, `player`, `subtitles`. Lo llama `AppCore::play`; avisa con `playback-updated`.

## Trampas
- El estado solo cambia vía `Slot::transition`/`set_state`; no escribir `row.state`.
- `slot_to_kept` entra a `kept` ANTES de salir de `slots`, para que `wait_gone` la vea pausada.
- `start` y `start_stream` serializan con `shared.starting`.
- `teardown` solo guarda con `file_index` + magnet y sin pedido de borrar; si no, borra.
- Retomar: mpv arranca `RESUME_REWIND_SECS` antes. Sin respuesta al "¿seguir bajando?" → pausa. `stop_all(true)` borra también las pausadas.
