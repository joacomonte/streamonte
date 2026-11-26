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
const art = (tt: string) => ({ poster: `https://images.metahub.space/poster/small/${tt}/img`, backdrop: `https://images.metahub.space/background/medium/${tt}/img` });
// Novedades de ejemplo (forma del cable, `NewsListWire`). Títulos reales con póster de metahub; subgéneros = interests de IMDb.
const newsItem = (kind: 'movie' | 'tv', imdb: string, title: string, year: number, subgenres: string[], extra: Record<string, unknown> = {}) =>
  ({ kind, imdb, tmdb: null, title, year, ...art(imdb), subgenres, overview: 'Sinopsis de ejemplo para el mock.', imdbRating: 7.6, imdbVotes: 120000, what: null, date: null, ...extra });
function newsMock() {
  const mode = new URLSearchParams(location.search).get('news');
  const empty = { fresh: [], trending: [], seenAt: null, updatedAt: null, stale: false, refreshing: false };
  if (mode === null || mode === 'empty' || !nickMock.nick) return empty;
  const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  const title = { type: 'title' };
  const fresh = [
    newsItem('tv', 'tt0903747', 'Breaking Bad', 2008, ['in0000086'], { what: { type: 'episode', season: 2, episode: 5, finale: false }, date: ago(1) }),
    newsItem('movie', 'tt15239678', 'Dune: Parte dos', 2024, ['in0000164'], { what: title, date: ago(3) }),
    newsItem('movie', 'tt9218128', 'Gladiador II', 2024, ['in0000019'], { what: title, date: ago(6) }),
    newsItem('tv', 'tt11280740', 'Severance', 2022, ['in0000083'], { what: title, date: ago(10) })
  ];
  const trending = [
    newsItem('movie', 'tt1375666', 'El origen', 2010, ['in0000086']),
    newsItem('movie', 'tt0137523', 'El club de la pelea', 1999, ['in0000083'], { imdbRating: 8.8, imdbVotes: 2400000 }),
    newsItem('movie', 'tt6710474', 'Todo en todas partes al mismo tiempo', 2022, ['in0000166'], { imdbRating: 7.8 })
  ];
  // `?news=seen`: ya vio todo (el diálogo no se abre solo; la pastilla sin número).
  return { fresh, trending, seenAt: mode === 'seen' ? ago(0) : ago(20), updatedAt: ago(mode === 'stale' ? 0.5 : 0.05), stale: mode === 'stale', refreshing: mode === 'refreshing' };
}
const vistosMock = [
  { kind: 'tv', imdb: 'tt0903747', tmdb: null, title: 'Breaking Bad', ...art('tt0903747'), season: 2, episode: 3, at: '2026-11-23T10:00:00.000Z' },
  { kind: 'movie', imdb: 'tt0137523', tmdb: null, title: 'El club de la pelea', ...art('tt0137523'), season: null, episode: null, at: '2026-11-22T10:00:00.000Z' },
  { kind: 'movie', imdb: 'tt1375666', tmdb: null, title: 'El origen', ...art('tt1375666'), season: null, episode: null, at: '2026-11-21T10:00:00.000Z' },
];
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
    // "Vistos recientemente": con sesión, 3 de ejemplo; con `?nonick`, vacía (la fila no sale). Marcar/sacar no guardan nada.
    case 'vistos_list': return Promise.resolve(nickMock.nick ? vistosMock : []);
    case 'vistos_mark': case 'vistos_restore': case 'vistos_dismiss': return Promise.resolve(null);
    // "Novedades": `?news` diálogo + Tendencias; `?news=stale` vieja (la UI pide refresh); `?news=refreshing`; `?news=seen`; `?news=empty`.
    // Sin apodo (`?nonick`) vacía, como el núcleo sin sesión. Sin `?news`, vacía (no cambia las capturas de siempre).
    case 'news_list': return Promise.resolve(newsMock());
    case 'news_refresh': case 'news_mark_seen': return Promise.resolve(null);
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
