# Registro de operaciones externas

Todo lo que se corrió fuera de git (queries a una base, comandos de aws, terraform, kubectl, cambios en consolas), en orden,
con el comando exacto, para poder replicarlo en otro ambiente. Se agrega con `mem op`; no se edita a mano.

## 1. Índices de eventos en Neon (streamonte web) — 2026-11-20
- Ambiente: prod
- Resultado: ok: eventos_pkey, eventos_dispositivo_fecha, eventos_fecha, eventos_accion_fecha; 109 filas, 120 kB
```
CREATE INDEX IF NOT EXISTS eventos_fecha ON eventos (fecha); CREATE INDEX IF NOT EXISTS eventos_accion_fecha ON eventos (accion, fecha);
```
