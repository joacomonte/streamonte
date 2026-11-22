// Verificar la UI desktop en el navegador sin Tauri: responde `invoke` con JSON grabado (`ui/mock/`, ver `record_fixtures`).
const files = import.meta.glob('../mock/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fixtures = new Map(Object.entries(files).map(([path, data]) => [path.split('/').pop()!.replace(/\.json$/, ''), data]));

// Mismo slug que `record_fixtures.rs`: valores de los args en orden, unidos con `_`, fuera de [a-z0-9_-] → `-`.
const slug = (args?: Record<string, unknown>) =>
  Object.values(args ?? {}).map(String).join('_').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

const defaults: Record<string, unknown> = {
  library_get: { pasted_now: [], previous: [] },
  playbacks_get: [],
  config_get: { language: { app: 'es', titles: 'es' }, engine: { incoming: true, upnp: true, announce_early: false }, player: { equalizer: 'cine' }, catalog: { torbox_shared: false } },
  api_keys: [],
  catalog_census: {}, // sin DHT: la UI lo toma como "no se sabe"
  catalog_swarm_saved: {},
  // Ajustes y "Tu conexión" (desktop).
  players_status: { mpv: 'bundled', vlc: false, can_install_mpv: false },
  premium_quota: { has_key: false, has_login: false, login_error: null, remaining: null, per_day: null, resets_at: null },
  catalog_addons: [],
  speed_test: { mbps: 240, measured_at: new Date().toISOString(), network: 'mock' },
};

// Eventos `core://event` (solo `catalog-streams`, grabados): se reenvían a los listeners al invocar el comando.
type Listener = (e: { payload: unknown }) => void;
const listeners: Listener[] = [];
function replay(events: unknown) {
  (events as unknown[]).forEach((payload, i) => setTimeout(() => listeners.forEach((cb) => cb({ payload })), 50 * (i + 1)));
}

function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const exact = fixtures.get(`${cmd}__${slug(args)}`);
  if (cmd === 'catalog_streams') {
    const events = fixtures.get(`events__${cmd}__${slug(args)}`);
    if (events) replay(events); else console.warn('[mock] sin fixture', cmd, args);
    return Promise.resolve(null);
  }
  if (exact !== undefined) return Promise.resolve(exact);
  // Con id de título (tt…) nunca se cae a la ficha de otro título; sin id (página, búsqueda) vale la primera.
  const byId = Object.values(args ?? {}).some((v) => /^tt\d/.test(String(v)));
  const first = byId ? undefined : [...fixtures.keys()].find((k) => k.startsWith(`${cmd}__`));
  if (first) return Promise.resolve(fixtures.get(first));
  if (cmd in defaults) return Promise.resolve(defaults[cmd]);
  // Comandos con efecto o por evento en vivo (que el mock no cubre): null sin aviso; los demás avisan.
  if (byId || !/^(catalog_open_|play|catalog_link|catalog_stop_|copied_magnet|speed_test|temp_usage|downloads_free_bytes)/.test(cmd)) console.warn('[mock] sin fixture', cmd, args);
  return Promise.resolve(null);
}

// Evento a mano (solo mock): `scripts/bench-options.mjs` empuja `catalog-streams` y `catalog-swarm-*` por acá.
const w = window as unknown as { __TAURI__?: unknown; __mockEmit?: (payload: unknown) => void };
w.__mockEmit = (payload) => listeners.forEach((cb) => cb({ payload }));
w.__TAURI__ ??= { core: { invoke }, event: { listen: (_: string, cb: Listener) => { listeners.push(cb); return Promise.resolve(() => {}); } },
  updater: { check: () => Promise.resolve(null) }, process: {} };
// La bienvenida taparía toda captura.
// `?tour` deja ver la bienvenida (desde cero).
try { if (location.search.includes('tour')) localStorage.removeItem('streamonte.welcome'); else localStorage.setItem('streamonte.welcome', 'done'); } catch { /* sin storage */ }
// `?live`: un par de eventos en vivo (fila nueva + bajando de fondo) para ver la barra de arriba y la actividad.
if (new URLSearchParams(location.search).has('live')) {
  const entry = { key: 'abc:0', info_hash: 'abc', name: 'Fight.Club.1999.1080p.mkv', torrent_name: null, live: null, release: { title: 'Fight Club' }, video_size: 2e9 };
  const row = { id: 1, key: 'abc:0', info_hash: 'abc', name: 'Fight Club', state: { kind: 'background' }, progress: 0.42, speed_bps: 3e6, peers: 12 };
  setTimeout(() => replay([{ type: 'library-entry-updated', entry }, { type: 'playback-updated', row }]), 1500);
}
