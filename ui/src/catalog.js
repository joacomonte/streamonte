// Catálogo (F4b, spec 09 §11): Buscar → ficha / episodio → streams de los addons → elegir qué
// analizar → reproducir. Separado de app.js (la lista de magnets la rediseña otra tarea).
// Todo texto que viene de Cinemeta o de los addons entra como texto, nunca como HTML (NFR-24).

import { api, onCoreEvent } from './api.js';

const $ = (sel) => document.querySelector(sel);

/** Crea un elemento. `attrs`: atributos y `on*` como listeners. Hijos: nodos o texto. */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

const LANG = {
  en: ['EN', 'Inglés'], lat: ['LAT', 'Latino'], es: ['ES', 'Español (sin variante)'],
  cast: ['CAST', 'Castellano'], multi: ['MULTI', 'Varios audios'],
  unknown: ['?', 'Idioma desconocido'], other: ['OTRO', 'Otros idiomas'],
};
const langName = (code) => LANG[code]?.[1] ?? LANG_NAMES[code] ?? regionName(code) ?? code.toUpperCase();
const langShort = (code) => LANG[code]?.[0] ?? code.toUpperCase();
/** Banderas de los addons → idioma (el addon pone la bandera del país, no el código de idioma). */
const LANG_NAMES = {
  ru: 'Ruso', ua: 'Ucraniano', ja: 'Japonés', it: 'Italiano', pt: 'Portugués', br: 'Portugués (Brasil)',
  kr: 'Coreano', cn: 'Chino', tw: 'Chino (Taiwán)', fr: 'Francés', de: 'Alemán', nl: 'Neerlandés',
  pl: 'Polaco', cz: 'Checo', hu: 'Húngaro', dk: 'Danés', se: 'Sueco', no: 'Noruego', fi: 'Finés',
  tr: 'Turco', sa: 'Árabe', il: 'Hebreo', id: 'Indonesio', th: 'Tailandés', in: 'Hindi', gr: 'Griego',
  ro: 'Rumano', bg: 'Búlgaro', vn: 'Vietnamita', my: 'Malayo', ph: 'Filipino', hr: 'Croata', rs: 'Serbio',
};
function regionName(code) {
  try { return new Intl.DisplayNames(['es'], { type: 'region' }).of(code.toUpperCase()); } catch { return null; }
}
/** Explicación de cada badge (pedido del usuario 2026-11-14: "explicar con tooltips todos los badges"). */
const TIPS = {
  '2160p': '4K (2160p): la máxima resolución', '1440p': '1440p (2K)', '1080p': 'Full HD (1080p)',
  '720p': 'HD (720p)', '480p': 'Definición estándar (480p o menos)',
  HDR: 'HDR: más rango de brillo y color. Se aprovecha con pantalla HDR; en una común se ve igual o un poco más apagado.',
  DV: 'Dolby Vision: HDR dinámico de Dolby. En pantallas sin Dolby Vision puede verse con colores raros (verde/violeta).',
  REMUX: 'REMUX: copia del Blu-ray sin recomprimir. Máxima calidad de imagen y sonido; archivo enorme.',
  BluRay: 'BluRay: hecho desde un Blu-ray y recomprimido. Muy buena calidad, pesa menos que un REMUX.',
  'WEB-DL': 'WEB-DL: bajado tal cual de un servicio de streaming (Netflix, Amazon…), sin recomprimir.',
  WEBRip: 'WEBRip: grabado de un servicio de streaming y recomprimido. Un poco menos de calidad que WEB-DL.',
  WEB: 'WEB: de un servicio de streaming (no dice si es WEB-DL o WEBRip).',
  HDTV: 'HDTV: grabado de la televisión.', DVDRip: 'DVDRip: hecho desde un DVD (baja resolución).',
  HDRip: 'HDRip: recomprimido de una fuente HD.', CAM: 'CAM: filmado en el cine. Mala calidad.',
  Atmos: 'Dolby Atmos: sonido envolvente con altura (necesita equipo compatible; si no, suena normal).',
  TrueHD: 'Dolby TrueHD: audio sin pérdida, el de los Blu-ray.',
  'DTS-HD': 'DTS-HD Master Audio: audio sin pérdida, el de los Blu-ray.',
  DTS: 'DTS: audio comprimido de cine, buena calidad.',
  'DD+': 'Dolby Digital Plus (E-AC3): el audio de los servicios de streaming, buena calidad.',
  DD: 'Dolby Digital (AC3): audio envolvente clásico.',
  AAC: 'AAC: audio comprimido común; suele ser estéreo.',
  '7.1': '7.1: ocho canales de sonido envolvente.', '5.1': '5.1: seis canales de sonido envolvente.',
  PACK: 'PACK: el torrent trae varios episodios; se usa solo el que elegiste.',
};
/** Idiomas de audio: con más de 2, se muestran EN y LAT (si están) + un solo MULTI con la lista en el tooltip. */
function audioBadges(audio, badge) {
  if (!audio.length) return badge('¿Idioma?', 'guess', 'La fuente no dice el idioma del audio. En Torrentio, sin bandera suele ser el original (casi siempre inglés). Se confirma al analizarlo en Mis magnets.');
  const focus = (l) => (l === 'lat' ? 'focus lat' : l === 'en' ? 'focus en' : '');
  const langs = audio.filter((l) => l !== 'multi');
  if (langs.length <= 2) {
    return audio.map((l) => badge(langShort(l), focus(l), l === 'multi' ? 'Varios audios (la fuente no dice cuáles)' : `Audio en ${langName(l)}`));
  }
  const all = `Audios (${langs.length}): ${langs.map(langName).join(', ')}`;
  return [
    ...langs.filter((l) => l === 'en' || l === 'lat').map((l) => badge(langShort(l), focus(l), all)),
    badge(`MULTI ${langs.length}`, '', all),
  ];
}

function setStatus(text) { $('#status').textContent = text; }
function showError(e) { if (e?.message !== 'Cancelado.') setStatus(e?.message ?? String(e)); }
function humanBytes(b) {
  if (b == null) return '—';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}
const mbps = (bps) => `${((bps * 8) / 1e6).toFixed(1).replace('.', ',')} Mbps`;

// ---------- estado ----------
const state = {
  results: null,          // {movies, series}
  excluded: new Set(),    // ids anime/japonés (FR-40)
  hideJapanese: true,
  meta: null,             // ficha abierta
  season: null,
  videoId: null,          // video cuyos streams se muestran
  update: null,           // último StreamsUpdate
  checked: new Set(),     // hashes marcados para analizar
  library: new Map(),     // hash → entrada de Mis magnets (semáforo, velocidad)
  collapsedRes: new Set(), // grupos colapsados (se recuerdan)
};
let searchSeq = 0;
let searchTimer = null;

// ---------- pestañas ----------
function showTab(tab) {
  document.querySelectorAll('.tab[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('.library').hidden = tab !== 'library';
  $('#catalog').hidden = tab !== 'catalog';
  $('#btn-play').hidden = tab !== 'library';
  if (tab === 'catalog') $('#cat-q').focus();
}

// ---------- búsqueda (FR-36) ----------
function onQueryInput() {
  clearTimeout(searchTimer);
  const q = $('#cat-q').value.trim();
  if (q.length < 2) { state.results = null; render(); return; }
  searchTimer = setTimeout(() => search(q), 300);
}

async function search(q) {
  const seq = ++searchSeq;
  state.meta = null;
  api.catalogStopStreams().catch(() => {});
  setStatus(`Buscando "${q}"…`);
  try {
    const r = await api.catalogSearch(q);
    if (seq !== searchSeq) return;
    state.results = r;
    setStatus(r.movies.length + r.series.length ? 'Elegí una película o serie.' : `No encontré "${q}". Probá con el título en inglés.`);
    render();
  } catch (e) {
    if (seq === searchSeq) showError(e);
  }
}

function posterCard(p) {
  const img = p.poster ? h('img', { src: p.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('div', { class: 'cat-noposter' }, p.name.slice(0, 1));
  return h('button', { class: 'cat-card', title: p.name, onclick: () => openMeta(p.kind, p.id) },
    img, h('span', { class: 'cat-card-name' }, p.name), h('span', { class: 'cat-card-year' }, [browse.from && p.released ? p.released.split('-').reverse().join('/') : p.year, p.imdb_rating && `★ ${p.imdb_rating}`].filter(Boolean).join(' · ')));
}

function renderResults(root) {
  const { movies, series } = state.results;
  const visible = (list) => list.filter((p) => !(state.hideJapanese && state.excluded.has(p.id)));
  for (const [label, list] of [['Películas', visible(movies)], ['Series', visible(series)]]) {
    if (!list.length) continue;
    root.append(h('h3', { class: 'cat-h' }, label), h('div', { class: 'cat-grid' }, list.map(posterCard)));
  }
}

// ---------- ficha (FR-38/39) ----------
async function openMeta(kind, id) {
  setStatus('Abriendo la ficha…');
  try {
    state.meta = await api.catalogMeta(kind, id);
    state.update = null;
    state.videoId = null;
    state.checked.clear();
    if (kind === 'movie') loadStreams(id);
    else {
      const seasons = [...new Set(state.meta.episodes.map((e) => e.season))];
      const saved = Number(safeGet(`tstream.season.${id}`));
      state.season = seasons.includes(saved) ? saved : seasons[0] ?? null;
      setStatus('Elegí un episodio.');
    }
    render();
  } catch (e) { showError(e); }
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

function renderMeta(root) {
  const m = state.meta;
  const facts = [m.year, m.runtime_min && `${m.runtime_min} min`, m.imdb_rating && `★ ${m.imdb_rating}`, m.country].filter(Boolean).join(' · ');
  root.append(h('div', { class: 'cat-meta' },
    m.background ? h('div', { class: 'cat-backdrop', style: `background-image:url("${encodeURI(m.background)}")` }) : null,
    m.poster ? h('img', { class: 'cat-poster', src: m.poster, alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'cat-poster cat-noposter' }, m.name.slice(0, 1)),
    h('div', { class: 'cat-meta-text' },
      h('button', { class: 'small', onclick: back }, '← Resultados'),
      h('h2', {}, m.name),
      h('p', { class: 'hint' }, facts),
      m.genres.length ? h('p', { class: 'hint' }, m.genres.join(', ')) : null,
      m.description ? h('p', { class: 'cat-desc' }, m.description) : null,
      m.excluded ? h('p', { class: 'hint' }, 'Marcado como anime / contenido japonés (filtro).') : null),
  ));
  if (m.kind === 'series') renderEpisodes(root);
  if (state.videoId) renderStreams(root);
}

function renderEpisodes(root) {
  const m = state.meta;
  const seasons = [...new Set(m.episodes.map((e) => e.season))];
  root.append(h('div', { class: 'cat-seasons' }, seasons.map((s) => h('button', {
    class: `small chip ${s === state.season ? 'active' : ''}`,
    onclick: () => { state.season = s; safeSet(`tstream.season.${m.id}`, s); render(); },
  }, s === 0 ? 'Especiales' : `T${s}`))));
  const eps = m.episodes.filter((e) => e.season === state.season);
  root.append(h('ul', { class: 'cat-episodes' }, eps.map((e) => h('li', {},
    h('button', {
      class: `cat-ep ${e.id === state.videoId ? 'active' : ''}`,
      disabled: !e.available,
      title: e.overview ?? '',
      onclick: () => loadStreams(e.id),
    }, h('b', {}, `${e.episode}.`), ` ${e.title || 'Episodio'} `, h('span', { class: 'hint' }, e.available ? (e.released ?? '') : `Se estrena ${e.released ?? 'pronto'}`))))));
}

function back() {
  api.catalogStopStreams().catch(() => {});
  state.meta = null;
  state.videoId = null;
  render();
}

// ---------- streams (FR-42–49) ----------
async function loadStreams(videoId) {
  state.videoId = videoId;
  state.update = null;
  state.checked.clear();
  render();
  setStatus('Pidiendo torrents a todas las fuentes…');
  try {
    await api.catalogStreams(state.meta.kind, videoId);
  } catch (e) { showError(e); }
}

function onStreams(update) {
  if (update.video_id !== state.videoId) return;
  state.update = update;
  const ok = update.addons.filter((a) => a.state !== 'pending').length;
  setStatus(update.done
    ? `${update.candidates.length} torrent(s) de ${ok} fuente(s). Marcá cuáles analizar o reproducí uno.`
    : `${ok} de ${update.addons.length} fuentes respondieron…`);
  renderStreamsOnly();
}

function addonChip(a) {
  const icon = { pending: '⏳', ok: '✓', 'needs-config': '🔧', unsupported: '–', error: '⚠' }[a.state];
  const tip = [a.message, a.ms != null && `${a.ms} ms`].filter(Boolean).join(' · ');
  return h('span', { class: `cat-addon ${a.state}`, title: tip || a.state }, `${icon} ${a.name}${a.state === 'ok' ? ` (${a.count})` : ''}`);
}

function lightOf(c) {
  const e = state.library.get(c.info_hash);
  if (!e) return { cls: 'none', text: '' };
  if (e.status?.kind === 'measuring') return { cls: 'measuring', text: 'midiendo…' };
  if (e.status?.kind === 'scraping') return { cls: 'measuring', text: 'analizando…' };
  if (e.status?.kind === 'failed') return { cls: 'red', text: 'falló' };
  const light = e.score?.light ?? 'unknown';
  const speed = e.live?.avg_speed_bps;
  return { cls: light, text: speed ? `${mbps(speed)}${e.score?.margin ? ` · ×${e.score.margin.toFixed(1).replace('.', ',')}` : ''}` : '' };
}

const RES_ORDER = ['2160p', '1440p', '1080p', '720p', '480p', '?'];
const resKey = (c) => (RES_ORDER.includes(c.resolution) ? c.resolution : '?');
const resLabel = (r) => ({ '2160p': '4K · 2160p', '480p': 'SD', '?': 'Sin resolución' }[r] ?? r);
/** Lo que se sabe de seeders: el mayor entre trackers y fuente (un tracker que no conoce el torrent da 0). */
function seedsOf(c) {
  const v = Math.max(c.seeders ?? -1, c.seeders_declared ?? -1);
  return v < 0 ? null : v;
}
function loadSet(key) { try { return new Set(JSON.parse(safeGet(key) ?? '[]')); } catch { return new Set(); } }
function toggleSet(set, value, key) {
  set.has(value) ? set.delete(value) : set.add(value);
  safeSet(key, JSON.stringify([...set]));
}

function streamRow(c) {
  const seeds = seedsOf(c);
  const light = lightOf(c);
  // Pedido del usuario (2026-11-14): resolución, peers, peso, audio, HDR y badges de calidad;
  // el nombre del release y el resto, solo en el tooltip.
  const tip = [c.release_name, c.file_name && `Archivo: ${c.file_name}`, c.is_pack && 'Pack: varios episodios en un torrent', `Fuentes: ${c.addons.join(' + ')}${c.sites.length ? ` (${c.sites.join(', ')})` : ''}`, `Hash: ${c.info_hash}`].filter(Boolean).join('\n');
  const badge = (text, cls = '', title = '') => h('span', { class: `lang ${cls}`, title }, text);
  return h('li', { class: `cat-row light-${light.cls}`, title: tip },
    h('input', {
      type: 'checkbox', title: 'Marcar para analizar', checked: state.checked.has(c.info_hash),
      onchange: (ev) => { ev.target.checked ? state.checked.add(c.info_hash) : state.checked.delete(c.info_hash); renderToolbar(); },
    }),
    h('span', { class: 'cat-res', title: TIPS[c.resolution] ?? 'La fuente no dice la resolución' }, c.resolution ?? '—'),
    h('span', { class: 'cat-badges' },
      audioBadges(c.audio, badge),
      c.subs.map((l) => badge(`SUB ${langShort(l)}`, 'guess', `Subtítulos en ${langName(l)}`)),
      c.hdr.map((x) => badge(x === 'DV' ? 'Dolby Vision' : x, 'cat-hdr', TIPS[x])),
      c.source ? badge(c.source, '', TIPS[c.source]) : null,
      (c.audio_format ?? []).map((f) => badge(f, 'cat-af', TIPS[f])),
      c.is_pack ? badge('PACK', 'guess', TIPS.PACK) : null),
    h('span', { class: 'cat-num', title: c.seeders != null ? `Seeders: trackers ${c.seeders}, fuente ${c.seeders_declared ?? '—'}` : 'Seeders según la fuente' }, seeds != null ? `${seeds}${c.seeders == null ? '?' : ''} ↑` : '—'),
    h('span', { class: 'cat-num cat-size' }, humanBytes(c.size_bytes)),
    h('span', { class: 'cat-num cat-speed', title: 'Velocidad medida · margen' }, light.text),
    state.library.has(c.info_hash)
      ? h('span', { class: 'cat-sent', title: 'Ya está en Mis magnets: reproducilo desde ahí' }, '✓ En Mis magnets')
      : h('button', { class: 'small primary', title: 'Enviar a Mis magnets (se analiza ahí y lo reproducís cuando quieras)', onclick: () => send([c.info_hash]) }, '＋ Mis magnets'),
  );
}

function renderToolbar() {
  const btn = $('#cat-analyze');
  if (!btn) return;
  btn.disabled = state.checked.size === 0;
  btn.textContent = state.checked.size ? `Enviar ${state.checked.size} a Mis magnets` : 'Enviar marcados a Mis magnets';
}

function renderStreams(root) {
  root.append(h('div', { id: 'cat-streams' }));
  renderStreamsOnly();
}

function renderStreamsOnly() {
  const box = $('#cat-streams');
  if (!box) return;
  const u = state.update;
  const scroll = $('#catalog').scrollTop;
  box.replaceChildren();
  box.append(h('div', { class: 'cat-streams-head' },
    h('h3', { class: 'cat-h' }, 'Torrents'),
    h('span', { class: 'cat-addons' }, (u?.addons ?? []).map(addonChip)),
    h('span', { class: 'spacer' }),
    h('button', { id: 'cat-analyze', class: 'small primary', onclick: () => send([...state.checked]), disabled: true }, 'Enviar marcados a Mis magnets'),
    h('button', { class: 'small', title: 'Volver a pedir a las fuentes', onclick: () => loadStreams(state.videoId) }, 'Actualizar')));
  if (!u) { box.append(h('p', { class: 'hint' }, 'Pidiendo a las fuentes…')); return; }
  if (u.done && !u.candidates.length) {
    const anyOk = u.addons.some((a) => a.state === 'ok');
    box.append(h('p', { class: 'hint' }, anyOk ? 'Ninguna fuente tiene torrents para esto.' : 'Ninguna fuente respondió. Probá "Actualizar".'));
    return;
  }
  box.append(h('p', { class: 'hint' }, 'Los seeders llegan solos. Mandá a Mis magnets los que te interesen (＋ o marcándolos): ahí se mide la velocidad real y los reproducís.'));
  // Pedido del usuario (2026-11-14): grupos por resolución (más alta primero), con una barra fija
  // para abrir/cerrar cada grupo rápido; dentro de cada grupo, más seeders primero.
  const groups = new Map(RES_ORDER.map((r) => [r, []]));
  for (const c of u.candidates) groups.get(resKey(c)).push(c);
  const present = RES_ORDER.filter((r) => groups.get(r).length);
  const toggle = (r) => {
    toggleSet(state.collapsedRes, r, 'tstream.catalog.collapsedRes');
    renderStreamsOnly();
    if (!state.collapsedRes.has(r)) document.getElementById(`cat-group-${r}`)?.scrollIntoView({ block: 'nearest' });
  };
  box.append(h('div', { class: 'cat-res-bar' },
    present.map((r) => h('button', {
      class: `small chip ${state.collapsedRes.has(r) ? '' : 'active'}`,
      title: state.collapsedRes.has(r) ? 'Expandir' : 'Colapsar',
      onclick: () => toggle(r),
    }, `${state.collapsedRes.has(r) ? '▸' : '▾'} ${resLabel(r)} · ${groups.get(r).length}`))));
  for (const r of present) {
    const collapsed = state.collapsedRes.has(r);
    const list = groups.get(r).sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0));
    box.append(h('section', { class: 'cat-group', id: `cat-group-${r}` },
      h('button', { class: 'cat-group-head', onclick: () => toggle(r) }, `${collapsed ? '▸' : '▾'} ${resLabel(r)} · ${list.length}`),
      collapsed ? null : h('ul', {}, list.map(streamRow))));
  }
  renderToolbar();
  $('#catalog').scrollTop = scroll;
}

// Pedido del usuario (2026-11-14): no se reproduce desde acá; se envía a Mis magnets, que analiza y reproduce.
async function send(hashes) {
  try {
    const n = await api.catalogAnalyze(state.meta.kind, state.videoId, hashes);
    state.checked.clear();
    setStatus(`${n} torrent(s) enviados a Mis magnets: se están analizando ahí.`);
    renderStreamsOnly();
  } catch (e) { showError(e); }
}

// ---------- Fuentes (FR-41) ----------
async function openSources() {
  let dlg = $('#dlg-sources');
  if (!dlg) {
    dlg = h('dialog', { id: 'dlg-sources', class: 'dialog wide' });
    document.body.append(dlg);
  }
  const addons = await api.catalogAddons().catch((e) => { showError(e); return []; });
  const input = h('input', { type: 'text', placeholder: 'Pegá la URL del manifest (https://…/manifest.json)', class: 'cat-add-url' });
  const msg = h('p', { class: 'hint' });
  const refresh = () => openSources();
  dlg.replaceChildren(
    h('h3', {}, 'Fuentes de torrents'),
    h('p', { class: 'hint' }, 'Addons de Stremio que se consultan al abrir una película o episodio. La app no indexa contenido: solo junta lo que devuelven. En P2P tu IP es visible para los demás del torrent.'),
    h('ul', { class: 'cat-sources' }, addons.map((a) => h('li', {},
      h('label', {}, h('input', { type: 'checkbox', checked: a.enabled, onchange: (ev) => api.catalogSetAddonEnabled(a.id, ev.target.checked).catch(showError) }), ` ${a.name}`),
      h('span', { class: 'hint cat-url' }, a.display_url),
      h('button', { class: 'small danger', onclick: () => api.catalogRemoveAddon(a.id).then(refresh, showError) }, 'Quitar')))),
    h('div', { class: 'key-row' }, input,
      h('button', { onclick: async () => {
        msg.textContent = 'Validando…';
        try {
          const a = await api.catalogAddAddon(input.value);
          setStatus(`${a.name} ✓ agregado.`);
          refresh();
        } catch (e) { msg.textContent = e?.message ?? String(e); }
      } }, 'Agregar')),
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { onclick: () => api.catalogResetAddons().then(refresh, showError) }, 'Restaurar lista por defecto'),
      h('button', { onclick: () => dlg.close() }, 'Cerrar')),
  );
  if (!dlg.open) dlg.showModal();
}

// ---------- render ----------
// ---------- Explorar (FR-37 simple, pedido 2026-11-14) ----------
// Película/serie → año (o cualquiera) → orden (popularidad / IMDb) → de a 20, "Cargar más".
const PAGE = 20;
const browse = {
  kind: safeGet('tstream.browse.kind') ?? 'movie',
  sort: safeGet('tstream.browse.sort') ?? 'popular',
  year: Number(safeGet('tstream.browse.year')) || null,
  // Rango de estreno (AAAA-MM-DD; `to` vacío = hasta hoy). Con `from`, manda sobre el año.
  from: safeGet('tstream.browse.from') || '',
  to: safeGet('tstream.browse.to') || '',
  items: [], shown: 0, skip: 0, cursor: null, hasMore: true, loading: false, error: null, gen: 0,
};

function setBrowse(changes) {
  // `gen` invalida lo que esté cargando con el filtro anterior.
  Object.assign(browse, changes, { items: [], shown: 0, skip: 0, cursor: null, hasMore: true, error: null, loading: false, gen: browse.gen + 1 });
  safeSet('tstream.browse.kind', browse.kind);
  safeSet('tstream.browse.sort', browse.sort);
  safeSet('tstream.browse.year', browse.year ?? '');
  safeSet('tstream.browse.from', browse.from);
  safeSet('tstream.browse.to', browse.to);
  loadMore();
}

async function loadMore() {
  if (browse.loading) return;
  const gen = browse.gen;
  const visible = () => browseItems().length;
  // Cinemeta da 50 por página: se piden más solo cuando no alcanzan para mostrar 20 más.
  while (browse.hasMore && visible() < browse.shown + PAGE) {
    browse.loading = true;
    render();
    try {
      const page = browse.from
        ? await api.catalogBrowseReleased(browse.kind, browse.from, browse.to || null, browse.cursor)
        : await api.catalogBrowse(browse.kind, browse.sort, browse.year, browse.skip);
      if (gen !== browse.gen) return; // cambió el filtro: otra carga ya está en curso
      const seen = new Set(browse.items.map((p) => p.id));
      browse.items.push(...page.items.filter((p) => !seen.has(p.id)));
      browse.skip += 50;
      browse.cursor = page.next ?? null;
      // Con rango, una tanda puede venir vacía (años sin estrenos en el rango) y seguir habiendo más.
      browse.hasMore = page.has_more && (browse.from ? !!page.next : page.items.length > 0);
    } catch (e) {
      if (gen !== browse.gen) return;
      browse.error = e?.message ?? String(e);
      browse.hasMore = false;
    } finally {
      if (gen === browse.gen) browse.loading = false;
    }
  }
  browse.shown += PAGE;
  render();
}

function browseItems() {
  const list = browse.items.filter((p) => !(state.hideJapanese && p.excluded));
  // Cinemeta no ordena por puntaje dentro de un año: se ordena lo cargado.
  if ((browse.year || browse.from) && browse.sort === 'rating') list.sort((a, b) => (Number(b.imdb_rating) || 0) - (Number(a.imdb_rating) || 0));
  return list;
}

// Rango de estreno como el `release_date=desde,hasta` de IMDb. Cinemeta no filtra por fecha:
// el núcleo recorre sus catálogos por año (≈400 títulos por año) y filtra por `released`.
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function renderReleased() {
  const today = isoDay(new Date());
  const set = (from, to) => (from !== browse.from || to !== browse.to) && setBrowse({ from, to });
  const preset = (label, from, title) => h('button', {
    class: `small chip ${browse.from === from && !browse.to ? 'active' : ''}`, title, onclick: () => set(from, ''),
  }, label);
  const field = (key, label) => h('label', { class: 'cat-date' }, label,
    h('input', {
      type: 'date', value: browse[key], min: '1950-01-01', 'aria-label': `Estreno ${label}`,
      onchange: (ev) => {
        const v = ev.target.value;
        if (key === 'from') set(v, v && browse.to && browse.to < v ? '' : browse.to);
        else set(browse.from || (v ? '1950-01-01' : ''), v); // "hasta" solo = desde 1950
      },
    }));
  return h('div', { class: 'cat-released', role: 'group', 'aria-label': 'Fecha de estreno' },
    h('span', { class: 'cat-released-label' }, 'Estreno'),
    field('from', 'desde'), field('to', 'hasta'),
    browse.from && !browse.to ? h('span', { class: 'cat-hoy' }, 'hoy') : null,
    preset('Últimos 30 días', isoDay(new Date(Date.now() - 30 * 86400000))),
    preset('Este año', `${today.slice(0, 4)}-01-01`, 'Del 1 de enero a hoy'),
    h('button', {
      class: 'small chip', title: 'Elegí la fecha "desde"; el final queda en hoy',
      onclick: (ev) => {
        const input = ev.currentTarget.closest('.cat-released').querySelector('input');
        if (browse.to) set(browse.from, '');
        else { input.focus(); input.showPicker?.(); }
      },
    }, 'Desde… hasta hoy'),
    browse.from || browse.to ? h('button', { class: 'small', onclick: () => set('', '') }, 'Limpiar') : null);
}

function renderBrowse(root) {
  const seg = (value, label, key) => h('button', {
    class: `small chip ${browse[key] === value ? 'active' : ''}`,
    onclick: () => browse[key] !== value && setBrowse({ [key]: value }),
  }, label);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1949 }, (_, i) => thisYear - i);
  root.append(h('div', { class: 'cat-browse-bar' },
    seg('movie', 'Películas', 'kind'), seg('series', 'Series', 'kind'),
    h('span', { class: 'cat-sep' }),
    h('select', { title: browse.from ? 'Con rango de fechas no se usa el año' : 'Año de estreno', disabled: !!browse.from, onchange: (ev) => setBrowse({ year: Number(ev.target.value) || null }) },
      h('option', { value: '', selected: !browse.year }, 'Cualquier año'),
      years.map((y) => h('option', { value: y, selected: browse.year === y }, y))),
    h('span', { class: 'cat-sep' }),
    seg('popular', browse.from ? 'Más recientes' : 'Más populares', 'sort'), seg('rating', 'Mejor puntaje IMDb', 'sort')),
    renderReleased());
  const items = browseItems().slice(0, browse.shown);
  if (items.length) root.append(h('div', { class: 'cat-grid' }, items.map(posterCard)));
  if (browse.error) root.append(h('p', { class: 'hint' }, browse.error));
  else if (!items.length && !browse.loading) root.append(h('p', { class: 'hint' }, 'No hay títulos con ese filtro.'));
  if (browse.loading) root.append(h('p', { class: 'hint' }, 'Cargando…'));
  else if (browse.hasMore || browseItems().length > browse.shown) {
    root.append(h('div', { class: 'cat-more' }, h('button', { onclick: loadMore }, 'Cargar más')));
  }
}

function render() {
  const root = $('#cat-body');
  root.replaceChildren();
  if (state.meta) renderMeta(root);
  else if (state.results) renderResults(root);
  else {
    if (!browse.items.length && browse.hasMore && !browse.loading) loadMore();
    renderBrowse(root);
  }
}

async function init() {
  state.collapsedRes = loadSet('tstream.catalog.collapsedRes');
  $('#catalog').append(
    h('div', { class: 'cat-bar' },
      h('input', { id: 'cat-q', type: 'search', placeholder: 'Buscar película o serie…', autocomplete: 'off', oninput: onQueryInput }),
      h('label', { class: 'cat-filter', title: 'Ocultar anime y contenido japonés' },
        h('input', { id: 'cat-hide-jp', type: 'checkbox', checked: true, onchange: onFilter }), ' Sin anime'),
      h('button', { class: 'small', onclick: openSources }, 'Fuentes')),
    h('div', { id: 'cat-body' }));
  document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); showTab('catalog'); }
  });
  try {
    const cfg = await api.config();
    state.hideJapanese = cfg.catalog?.exclude_japanese ?? true;
    $('#cat-hide-jp').checked = state.hideJapanese;
    const lib = await api.library();
    for (const e of [...lib.pasted_now, ...lib.previous]) state.library.set(e.info_hash, e);
  } catch (e) { showError(e); }
  await onCoreEvent((event) => {
    switch (event.type) {
      case 'catalog-streams': onStreams(event.update); break;
      case 'catalog-excluded':
        state.excluded.add(event.id);
        if (state.results && !state.meta && state.hideJapanese) render();
        break;
      case 'library-entry-updated':
        state.library.set(event.entry.info_hash, event.entry);
        if (state.update?.candidates.some((c) => c.info_hash === event.entry.info_hash)) renderStreamsOnly();
        break;
      // Redibujar: si no, la fila sigue diciendo "✓ En Mis magnets" y no deja volver a agregarlo.
      case 'library-entry-removed':
        state.library.delete(event.info_hash);
        if (state.update?.candidates.some((c) => c.info_hash === event.info_hash)) renderStreamsOnly();
        break;
      case 'library-cleared': state.library.clear(); if (state.update) renderStreamsOnly(); break;
      default: break;
    }
  });
  render();
}

async function onFilter(ev) {
  state.hideJapanese = ev.target.checked;
  render();
  try {
    const cfg = await api.config();
    await api.setConfig({ ...cfg, catalog: { ...cfg.catalog, exclude_japanese: state.hideJapanese } });
  } catch (e) { showError(e); }
}

init().catch(showError);
