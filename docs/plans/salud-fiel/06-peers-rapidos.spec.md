# Idea 6 — Peers rápidos en vez de seeders (spec)

Contexto y reglas: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md.
Fuente librqbit: `L=/Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f` (abajo, `$L/...`).

## Veredicto
Viable **solo como capa sobre una medición que baje datos** (idea 3 o `measure_with` actual). Sin bajar,
librqbit 9.1.0 no da nada por peer que sirva para la salud (ni velocidad, ni choke, ni `upload_only`, ni
seeder por peer). Lo que suma sobre "medir el total": **cuántos peers sirven de verdad y cuánto depende
del mejor** (concentración), y un log por peer para calibrar. No reemplaza al throughput total; lo matiza.

## 1. Qué expone librqbit 9.1.0 por peer (verificado)
| Dato | ¿Expuesto? | Dónde |
|---|---|---|
| Snapshot por peer | Sí: `ManagedTorrent::live()?.per_peer_stats_snapshot(filter)` → `HashMap<String /*addr*/, PeerStats>` | `$L/librqbit-9.1.0/src/torrent_state/live/mod.rs:756` |
| `PeerStats { counters, state, conn_kind, client_name }` | Sí | `$L/librqbit-9.1.0/src/torrent_state/live/peer/stats/snapshot.rs:26-32` |
| `counters.fetched_bytes` (acumulado, por dirección, sobrevive reconexiones) | Sí | `.../peer/stats/snapshot.rs:11-24`; se suma en cada chunk recibido (incluye chunks tardíos cancelados) en `.../torrent_state/live/mod.rs:1795-1798` |
| `incoming_connections`, `connections`, `errors`, `downloaded_and_checked_pieces`, `total_piece_download_ms` | Sí | `.../peer/stats/snapshot.rs:11-24` |
| **Velocidad por peer** | **No** (solo la total `download_speed`). Derivable: Δ`fetched_bytes` / Δt entre dos snapshots | — |
| Filtro | `PeerStatsFilter { state: Live (default) \| All }`. **`PeerStatsFilterState` no es nombrable** desde fuera: `torrent_state` es privado y `http_api_types` exige la feature `http-api` (Streamonte usa `default-features = false`, `/Users/monti/Documents/Dev/streamonte/crates/core/Cargo.toml:27`). Solo se puede usar `Default::default()` = solo vivos | `.../peer/stats/snapshot.rs:80-99`; `$L/librqbit-9.1.0/src/lib.rs:59-60` |
| `client_name` (del `v` del handshake extendido, BEP 10) | Sí (solo peers vivos) | set en `.../torrent_state/live/mod.rs:1167-1174`; formato `:2100-2106` |
| `reqq` | No expuesto: solo ajusta la ventana de pedidos | `.../torrent_state/live/mod.rs:1176-1189` |
| `upload_only` (BEP 21) | Parseado y **nunca usado** | `$L/librqbit-peer-protocol-9.1.0/src/extended/handshake.rs:32` (grep: sin otros usos) |
| HaveAll/HaveNone (BEP 6) | **No soportado**: `Message` no los tiene | `$L/librqbit-peer-protocol-9.1.0/src/lib.rs:220-232` |
| Seeder por peer | Privado (`LivePeerState.seeder`); solo agregado `live_seeders` | `.../torrent_state/live/peer/mod.rs:263-267`; `.../torrent_state/live/peers/stats/mod.rs:19` |
| Choke (me tiene ahogado) | Privado al handler (`PeerFlowControl.i_am_choked`) | `.../torrent_state/live/mod.rs:1009-1012`, `:1078-1079` |
| Fase de metadatos (sin info) | `peer_info_reader` mira solo `metadata_size`/`ut_metadata`; ignora `v` y `upload_only` | `$L/librqbit-9.1.0/src/peer_info_reader/mod.rs:224-253` |

Consecuencias:
- Velocidad por peer = muestrear `fetched_bytes` por dirección. Peer que se desconecta entre muestras
  desaparece del snapshot (filtro Live): sus bytes se pierden del reparto por peer (el total sigue en
  `Stats.received_bytes`). Aceptable.
- "Seeder sin velocidad" vs "peer lento": no se ve choke ni seeder por peer. Proxy: peer **vivo en ambas
  muestras con Δ=0** = `idle` (ahogado, no interesado o sin piezas que pedimos). Δ>0 chico = lento.
- Sin bajar: `hold_peers` (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:494-517`)
  pide a lo sumo la última pieza → Δ por peer ≈ 0 durante el conteo. **No hay velocidad por peer sin descarga.**
- Señales sin bajar (BEP 6/21) requieren parchear/forkear librqbit → fuera de alcance (D4).
- Seedbox por client id: `client_name` existe, pero qBittorrent/Transmission/Deluge los usan hogares y
  seedboxes por igual. IP de hosting necesita base ASN (dato/dependencia nueva) → D5. v1: solo se loguea.

## 2. Cómo llega hoy lo de cada peer en Streamonte
- `connected_peers`: claves del snapshot (default = vivos) → `SocketAddr`; se guardan para el play.
  `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:519-532`; trait default `Vec::new()`
  en `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:287-290`.
- `stats()`: `peers` = `live`, `seeds` = `live_seeders`, `incoming_peers` = vivos con
  `incoming_connections > 0`, `received_bytes` = `fetched_bytes` total.
  `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:561-641`.
- `log_peers`/`peer_line`: cada 10 s en reproducción, conteo de entrantes/salientes y MiB/s total; nada por
  peer. `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:129-180`; se lanza en
  `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:380-387`.
- webtorrent: `stats` sin datos por peer (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/webtorrent.rs:434-457`);
  el sidecar tiene `t.wires` (`/Users/monti/Documents/Dev/streamonte/engines/webtorrent-sidecar/src/main.mjs:197-209`).

## 3. Métrica
Ventana = la de medición de velocidad, después de `WARMUP` (5 s,
`/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/speed.rs:161`). Snapshot A al terminar el
warmup, snapshot B al final; `dt` = segundos entre ambos.

Por dirección: `r_i = (B.fetched_i − A.fetched_i ó 0 si no estaba en A) / dt`.
Núcleo guarda (crudo, sin umbrales de negocio):
- `rates_bps`: los 8 `r_i > 0` más altos, descendente.
- `idle`: vivos en A y B con `r_i = 0`.
- `secs`: `dt`.

UI (sabe `need` = Mbps que pide):
- `total = Σ rates` (≈ throughput; si existe `avg_speed_bps`, manda ese como hoy).
- `top1 = rates[0]`, `robust = total − top1` (lo que queda si se va el mejor peer).
- `serving = #{ r_i ≥ 0,5 Mbps }`, `fast = #{ r_i ≥ max(10 Mbps, need/2) }`.
- Nivel: el de hoy con `supply` medido (`ratio ≥ 2` bueno, `≥ 1` justo). **Regla nueva única**: si nivel = 0
  y `robust < need` → nivel 1 ("depende de un solo peer"). Nunca baja a 2 por esto.

Por qué predice mejor que contar seeders: un seeder contado vale `seedMbps` (mediana por red,
`/Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:85`), pero un seedbox da 20× y un seeder que
nos ahoga da 0. `r_i` mide lo que cada uno entregó de verdad; `idle` separa "hay seeders" de "nos sirven".
`robust` anticipa los cortes por caída del mejor peer, que el promedio no ve.

Límite honesto: con tope por torrent (idea 3) o con el enlace saturado por medir 10–15 en paralelo, cada
`r_i` es **cota inferior** (librqbit reparte pedidos). Por eso `fast` es relativo a `need` y la regla usa
`robust` (proporción), no Mbps absolutos de capacidad.

Calibración (idea 4): cada muestra de reproducción guarda `analysis_robust_mbps` y `analysis_serving` de
la medición previa de ese torrent; por red se aprende `median(sostenido_reproducción / robust_análisis)`.
Sin implementarlo acá (paso 6 solo agrega los campos).

## 4. Diseño
### 4.1 Trait `TorrentEngine` (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:252`)
Junto a `connected_peers` (línea 287):
```rust
/// Bytes recibidos acumulados por peer vivo (para velocidad por peer = Δ entre dos llamadas).
/// `None` = el motor no lo informa.
async fn peer_bytes(&self, _handle: TorrentHandle) -> Option<Vec<PeerBytes>> { None }
```
Tipo nuevo en el mismo archivo (después de `Stats`, ~línea 225):
```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerBytes {
    pub addr: std::net::SocketAddr,
    pub fetched_bytes: u64,
    pub incoming: bool,              // counters.incoming_connections > 0
    pub client: Option<String>,      // `v` del handshake (solo log)
}
```
- rqbit (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs`, después de `connected_peers`
  ~línea 532): mismo patrón que `connected_peers` (`torrent(handle)`, `live()?`,
  `per_peer_stats_snapshot(Default::default())`), mapear cada `(addr, PeerStats)`; descartar claves que no
  parsean. `None` si no hay `live()`.
- webtorrent: **no implementar** (queda el default `None`). Posible a futuro con `w.downloaded` y
  `w.remoteAddress` de `t.wires` en el sidecar (cambio de protocolo; D2).

### 4.2 Cálculo puro — archivo nuevo `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/peer_rates.rs`
```rust
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PeerRates { pub rates_bps: Vec<f64>, pub idle: u32, pub secs: f64 }
pub(crate) fn peer_rates(a: &[PeerBytes], b: &[PeerBytes], secs: f64) -> PeerRates
pub(crate) fn rates_line(b_prev: &[PeerBytes], b: &[PeerBytes], secs: f64) -> String // log: top 5 "IP:puerto 12.3 Mbps (cliente, entrante)"
```
`secs <= 0` → `PeerRates::default()`. Tests unitarios en el mismo archivo (Δ, peer nuevo en B, idle, orden,
corte a 8). Registrar `mod peer_rates;` en `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs:18-24`
(`pub(crate)`, porque lo usa también `engine/rqbit/net.rs`).

### 4.3 Medición → `LiveMeasurement`
- `/Users/monti/Documents/Dev/streamonte/crates/core/src/library.rs:41-69`: agregar
  `#[serde(default)] pub peer_rates: Option<crate::analyzer::peer_rates::PeerRates>` (si el módulo es
  privado, mover el struct a `library.rs` y que `peer_rates.rs` lo importe — decidir por visibilidad al compilar;
  preferido: struct en `library.rs`).
- Literales a completar con `peer_rates: None`: `/Users/monti/Documents/Dev/streamonte/crates/core/src/library.rs:690`,
  `:943`, `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/queue.rs:770`, `:866`,
  `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/speed.rs:45`.
- `sample_speed` (`/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/speed.rs:72-158`): guardar
  `snap_a = engine.peer_bytes(handle)` la primera vez que `now − t0 > WARMUP` (junto a la línea 122), y al salir
  del loop `snap_b`; devolver `PeerRates` en `SpeedSample` (campo `peer_rates: Option<PeerRates>`, struct en
  `:13-20`). `sustained_speed` (`:202`) pone `None`; `sample_speed` lo completa.
- `measure_with` (`/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs:292-305`):
  `peer_rates: speed.peer_rates`.
- Eventos a la UI: **ninguno nuevo**. La fila de biblioteca ya llega con `live` (la UI lee `rowsOf(h)[0].live`).
  Idea 3, cuando exista, llama al mismo `peer_rates` y lo pone en su resultado.

### 4.4 Log de reproducción (diagnóstico y experimento)
`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:152-180`: en `log_peers` guardar el
snapshot anterior (por `ManagedTorrent::live()?.per_peer_stats_snapshot`, mismo mapeo que 4.1, extraer
función `fn peer_bytes_of(t: &ManagedTorrent) -> Option<Vec<PeerBytes>>` en net.rs y que rqbit.rs la reuse) y cada
10 s loguear `rates_line`. Sin cambios de trait.

### 4.5 `health()` y UI
`/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:702-722`:
- Tras `measuredBps` (línea 716): `const pr = rowsOf(c.info_hash).find((e) => e.live?.peer_rates)?.live.peer_rates;`
- Si `pr` y `level === 0`: calcular `robust`, `serving`, `top1` (§3) en Mbps; si `robust < need` → `level = 1`,
  `concentrated = true`.
- Devolver además `{ serving, top1, robust, idle: pr?.idle, concentrated }`.

`healthBadge` (`/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:726-745`, `tipText` en 735): en la rama
`measured`, agregar línea: `"${serving} peers dieron datos; el mejor ~${top1} Mbps, sin él quedan ~${robust}${idle ? ` · ${idle} conectados sin dar nada` : ''}."`
y si `concentrated`: `"Depende de un solo peer: si se va, puede cortarse."`
Sin elementos interactivos nuevos (el ícono ya tiene `id="cat-health-<hash>"`).

### 4.6 Calibración (solo campos)
`/Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:134-140` `addSample`: sumar `analysis_robust_mbps`
y `analysis_serving` si `trackPlayback` los recibe. `trackPlayback` (`:97`) gana 5º parámetro opcional `pr`;
su llamador `measurePlayback` (`/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:753`) pasa
`rowsOf(hash).find((e) => e.live?.peer_rates)?.live.peer_rates`. Aprender el factor = idea 4.

## 5. Pasos
| # | Qué | Ancla | Verificación |
|---|---|---|---|
| 1 | `PeerBytes` + `peer_bytes` en trait (default `None`) | `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:225`, `:290` | `cargo check -p streamonte-core --all-features` |
| 2 | `peer_rates.rs` puro + tests | `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/peer_rates.rs` (nuevo), `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs:18-24` | `cargo test -p streamonte-core peer_rates` |
| 3 | rqbit: `peer_bytes_of` en net.rs; `peer_bytes` en rqbit.rs | `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:129`, `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:532` | `cargo check` |
| 4 | Log por peer cada 10 s en reproducción | `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:152-180` | Reproducir un 4K con UPnP: "Ver detalle" muestra top 5 con Mbps y cliente; Σ ≈ MiB/s de la línea `peers:` |
| **4b** | **Experimento (antes de seguir)**: 5–10 reproducciones; anotar top1/total y serving | log de Detalle | Si en la mayoría 1–2 peers dan > 60 % del total, sigue; si no, la regla de concentración no aporta → parar en 4 |
| 5 | `LiveMeasurement.peer_rates` + `sample_speed` + `measure_with` + literales | §4.3 | `cargo test -p streamonte-core`; medir un torrent (⤓ o análisis) y ver `peer_rates` en el JSON de biblioteca |
| 6 | `health()` + tooltip + campos de calibración | §4.5, §4.6 | Con una fila medida de 1 seedbox: tooltip dice "Depende de un solo peer" y nivel ≤ 1; con fila sin `peer_rates`: idéntico a hoy |

## 6. Riesgos
- Cota inferior bajo tope/saturación (§3): mitigado usando proporciones; `fast` absoluto no decide nada.
- Ventana corta (15–30 s): un peer que llegó tarde parece lento. `secs` se guarda para ponderarlo después.
- `fetched_bytes` incluye chunks tardíos cancelados (`live/mod.rs:1795`): sobreestima levemente a peers lentos con robo; despreciable.
- Peers que se cortan en la ventana se pierden del reparto (filtro solo Live): `robust` puede quedar bajo → la regla solo baja de 0 a 1.
- Upgrade de librqbit: `PeerStats`/`per_peer_stats_snapshot` son API pública pero no estable; ya se usan en 3 lugares.

## 7. Decisiones abiertas
- D1 Umbral de la regla: `robust < need` (propuesto) vs `< 1,5×need`.
- D2 webtorrent: implementar `peer_bytes` en el sidecar (`wires[].downloaded`) o dejar `None` (propuesto: `None`).
- D3 ¿Mostrar `serving`/`fast` en la fila además del tooltip? (propuesto: no).
- D4 Parchear librqbit para exponer `upload_only`/choke/seeder por peer (fork = mantenimiento; propuesto: no).
- D5 Seedbox por ASN/IP de hosting: requiere base de datos externa (dependencia nueva). Propuesto: no; usar velocidad.

## 8. Estimación
Pasos 1–4: varios módulos (engine) · baja (lectura de contadores + función pura) · conocido.
Pasos 5–6: varios módulos (analyzer, library, UI) · media (ventana/snapshots, compatibilidad serde, regla nueva) ·
investigar (si la concentración predice cortes: lo dice el experimento 4b; con idea 3, cuánto distorsiona el tope).

## 9. Relación con 3, 4, 7
- **3**: dependencia dura; sin descarga no hay `r_i`. Idea 3 llama a `peer_rates` con sus snapshots y gana "robust/serving" gratis.
- **4**: `analysis_robust_mbps` es una entrada más para aprender el sesgo análisis→reproducción por red.
- **7**: PEX da tamaño del enjambre (direcciones), esta idea da calidad de los conectados; se complementan, no se pisan.
- Sin 3, el valor de 6 queda en el log de diagnóstico (paso 4) y en mediciones manuales (⤓ / análisis).
