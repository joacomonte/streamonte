-- Tabla de uso de la web (Neon, proyecto `streamonte`). La escribe src/lib/server/track.js y la lee /admin.
-- Idempotente: se puede correr de nuevo en una base nueva o en una rama de Neon.
CREATE TABLE IF NOT EXISTS eventos (
	id bigserial PRIMARY KEY,
	dispositivo text,
	equipo text,
	accion text,
	dato text,
	fecha timestamptz DEFAULT now(),
	lugar text
);
-- Historial de un dispositivo en /admin.
CREATE INDEX IF NOT EXISTS eventos_dispositivo_fecha ON eventos (dispositivo, fecha DESC);
-- Entradas por día en /admin (accion = 'entrar' de los últimos 14 días).
CREATE INDEX IF NOT EXISTS eventos_accion_fecha ON eventos (accion, fecha);
-- Borrado de lo que tiene más de 90 días (track.js lo corre de vez en cuando).
CREATE INDEX IF NOT EXISTS eventos_fecha ON eventos (fecha);
