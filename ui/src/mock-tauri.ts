// Verificar la UI desktop en el navegador sin Tauri: responde `invoke` con JSON grabado (`ui/mock/`, ver `record_fixtures`).
const files = import.meta.glob('../mock/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fixtures = new Map(Object.entries(files).map(([path, data]) => [path.split('/').pop()!.replace(/\.json$/, ''), data]));

// Mismo slug que `record_fixtures.rs`: valores de los args en orden, unidos con `_`, fuera de [a-z0-9_-] → `-`.
const slug = (args?: Record<string, unknown>) =>
  Object.values(args ?? {}).map(String).join('_').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

const defaults: Record<string, unknown> = {
  library_get: { pasted_now: [], previous: [] },
  playbacks_get: [],
  config_get: { language: { app: 'es', titles: 'es' } },
  api_keys: [],
};

function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const exact = fixtures.get(`${cmd}__${slug(args)}`);
  if (exact !== undefined) return Promise.resolve(exact);
  const first = [...fixtures.keys()].find((k) => k.startsWith(`${cmd}__`));
  if (first) return Promise.resolve(fixtures.get(first));
  if (cmd in defaults) return Promise.resolve(defaults[cmd]);
  // Comandos con efecto o por evento en vivo (que el mock no cubre): null sin aviso; los demás avisan.
  if (!/^(catalog_open_|play|catalog_link|catalog_stop_|catalog_streams|copied_magnet|speed_test|temp_usage|downloads_free_bytes)/.test(cmd)) console.warn('[mock] sin fixture:', cmd, args);
  return Promise.resolve(null);
}

const w = window as unknown as { __TAURI__?: unknown };
w.__TAURI__ ??= { core: { invoke }, event: { listen: () => Promise.resolve(() => {}) },
  updater: { check: () => Promise.resolve(null) }, process: {} };
// La bienvenida taparía toda captura.
try { localStorage.setItem('streamonte.welcome', 'done'); } catch { /* sin storage */ }
