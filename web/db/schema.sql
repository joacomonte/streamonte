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

-- Apodo (cookie `nick`), zona horaria IANA del navegador y modelo del equipo (Sec-CH-UA-Model, Chrome en Android).
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS apodo text;
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS zona text;
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS modelo text;
-- Lo de cada usuario en /admin.
CREATE INDEX IF NOT EXISTS eventos_apodo_fecha ON eventos (apodo, fecha DESC);

-- Intentos fallidos de los códigos (acceso y panel), por IP. La escribe src/lib/server/intentos.js.
-- `ip` va con prefijo (`app:1.2.3.4`, `admin:1.2.3.4`); `ultimo`: el último código errado, para no contarlo dos veces
-- (varios pedidos con la misma cookie vieja); `hasta`: fin de la ventana de 15 min (y del bloqueo, con 5 fallos).
CREATE TABLE IF NOT EXISTS intentos (
	ip text PRIMARY KEY,
	fallos int NOT NULL DEFAULT 0,
	hasta timestamptz,
	ultimo text
);
