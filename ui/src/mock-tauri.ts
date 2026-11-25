// Verificar la UI desktop en el navegador sin Tauri: responde `invoke` con JSON grabado (`ui/mock/`, ver `record_fixtures`).
const files = import.meta.glob('../mock/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const fixtures = new Map(Object.entries(files).map(([path, data]) => [path.split('/').pop()!.replace(/\.json$/, ''), data]));

import { ANIMAL_IDS } from '../../packages/ui/src/animals/animals.ts';

// Mismo slug que `record_fixtures.rs`: valores de los args en orden, unidos con `_`, fuera de [a-z0-9_-] → `-`.
const slug = (args?: Record<string, unknown>) =>
  Object.values(args ?? {}).map(String).join('_').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

const defaults: Record<string, unknown> = {
  library_get: { pasted_now: [], previous: [] },
  playbacks_get: [],
  config_get: { language: { app: 'es', titles: 'es' }, engine: { incoming: true, upnp: true, announce_early: false }, player: { equalizer: 'cine', equalizer_intensity: 100 } },
  api_keys: [],
  catalog_census: {}, // sin DHT: la UI lo toma como "no se sabe"
  catalog_swarm_saved: {},
  // Ajustes y "Tu conexión" (desktop).
  players_status: { mpv: 'bundled', vlc: false, can_install_mpv: false },
  premium_quota: { has_key: false, has_login: false, login_error: null, remaining: null, per_day: null, resets_at: null },
  catalog_addons: [],
  speed_test: { mbps: 240, measured_at: new Date().toISOString(), network: 'mock' },
};

// Eventos `core://event`: `catalog-streams` (grabados) se reenvían al invocar el comando; `?scenario=` reproduce secuencias a mano.
type Listener = (e: { payload: unknown }) => void;
const listeners: Listener[] = [];
function replay(events: unknown, stepMs = 500, startMs = stepMs) {
  (events as unknown[]).forEach((payload, i) => setTimeout(() => listeners.forEach((cb) => cb({ payload })), startMs + stepMs * i));
}

// Apodo de la web (desktop): con sesión y código cargado, salvo `?nonick` (sin código ni apodo, para ver el paso del apodo).
// El código de 3 dígitos que vale es cualquiera menos `000`; los animales de la sesión son los dos primeros de la grilla.
const nickMock = { codeSet: !location.search.includes('nonick'), code: '123', nick: location.search.includes('nonick') ? null : 'Joaco' as string | null };
const reject = (msg: string) => Promise.reject(msg);
function mockNick(cmd: string, args?: Record<string, unknown>): Promise<unknown> | undefined {
  const guard = () => {
    if (!nickMock.codeSet) return reject('Falta el código de la web.');
    if (nickMock.code === '000') { nickMock.codeSet = false; return reject('El código de la web no es correcto: cargalo de nuevo.'); }
  };
  switch (cmd) {
    case 'web_code_set': nickMock.code = String(args?.code ?? ''); nickMock.codeSet = nickMock.code !== ''; return Promise.resolve(null);
    case 'nick_status': return Promise.resolve({ code_set: nickMock.codeSet, nick: nickMock.nick });
    case 'nick_ask': return guard() ?? Promise.resolve({ nick: String(args?.nick), mode: 'nuevo', order: ANIMAL_IDS, wait: 0 });
    case 'nick_enter': return guard() ?? (nickMock.nick = String(args?.nick), Promise.resolve({ kind: 'ok', nick: nickMock.nick, created: true }));
    case 'nick_logout': nickMock.nick = null; return Promise.resolve(null);
    case 'nick_animals': return Promise.resolve(nickMock.nick ? ANIMAL_IDS.slice(0, 2) : null);
  }
}

function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const nick = mockNick(cmd, args);
  if (nick) return nick;
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
// `?scenario=<nombre>`: reproduce `ui/mock/events__<nombre>.json` (o la primera `events__<nombre>__*`; hechos a mano: `analyze__basic`,
// `speed__basic`, `downloads__basic`, `subs__basic`) con 300 ms entre eventos, para ver análisis, velocidad, descargas y subtítulos sin el núcleo.
const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario) {
  const key = fixtures.has(`events__${scenario}`) ? `events__${scenario}` : [...fixtures.keys()].find((k) => k.startsWith(`events__${scenario}__`));
  if (key) replay(fixtures.get(key), 300, 1500); else console.warn('[mock] sin escenario', scenario);
}
