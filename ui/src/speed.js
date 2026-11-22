// @ts-check
// "Tu conexión" (2026-11-16): el botón de la barra de arriba muestra la velocidad de internet y abre
// un menú con todo lo que usa la salud estimada de los torrents: la velocidad de internet (techo),
// cuánto aporta cada seeder en esta PC (calibración, `health-calib.js`), cómo se combinan y las
// mediciones. Al abrir la app se pide la velocidad de esta red (el núcleo mide solo si esta red no
// tiene una medición); "Medir de nuevo" la fuerza.

import { api } from './api.js';
import { $, el, setStatus } from './dom.js';
import { t as tr } from './i18n.js';
import { ago, mbps, nf1 } from './format.js';
import { DEFAULT_SEED_MBPS, MIN_SAMPLES, TRACKER_MIN, fidelity, healthCalibration, incomingStatus, measuringNow, predict, recalibrate, resetCalibration, setLinkMbps, setSeedMbps } from './health-calib.js';
import { state } from './state.js';
import { popFor, togglePop } from './top-menus.js';

/** @typedef {{kind:'idle', mbps?:number}|{kind:'measuring', mbps:number}|{kind:'done', mbps:number, at:string}|{kind:'failed', mbps:number, message:string}} SpeedView */
/** @type {SpeedView} */
let view = { kind: 'idle' };
/** Editando el aporte por seeder a mano. */
let editing = false;

/** Ángulo de la aguja: escala logarítmica de 1 a 1000 Mbps sobre media vuelta (-90° a 90°). */
/** @param {number} v */
const angle = (v) => -90 + 180 * Math.min(1, Math.max(0, Math.log10(Math.max(1, v)) / 3));

/** @param {number} v @param {number=} size @returns {string} */
function gauge(v, size = 22) {
  const a = angle(v);
  const len = Math.PI * 8;
  const fill = (len * (a + 90)) / 180;
  return `<svg class="speed-gauge" viewBox="0 0 22 13" width="${size}" height="${Math.round((size * 13) / 22)}" aria-hidden="true">
    <path class="track" d="M3 11a8 8 0 0 1 16 0" />
    <path class="fill" d="M3 11a8 8 0 0 1 16 0" stroke-dasharray="${fill} ${len}" />
    <line class="needle" x1="11" y1="11" x2="11" y2="4.5" style="transform: rotate(${a}deg)" />
    <circle class="hub" cx="11" cy="11" r="1.4" />
  </svg>`;
}

/** @param {string} cls @param {string} svg */
function svgSpan(cls, svg) {
  const s = el('span', { class: cls, 'aria-hidden': 'true' });
  s.innerHTML = svg;
  return s;
}

/** @param {number} v */
const fmt = (v) => (v >= 100 ? String(Math.round(v)) : nf1(v));

function renderButton() {
  const btn = $('#btn-speed');
  const v = view;
  btn.classList.toggle('measuring', v.kind === 'measuring');
  btn.classList.toggle('failed', v.kind === 'failed');
  btn.setAttribute('aria-busy', String(v.kind === 'measuring'));
  const value = v.kind === 'measuring' || v.kind === 'done' ? `${fmt(v.mbps ?? 0)} <small>Mbps</small>` : v.kind === 'failed' ? tr('Sin medir') : tr('Medir');
  btn.innerHTML = `${gauge(v.mbps ?? 0)}<span class="speed-val">${value}</span>`;
  btn.title = tr('Tu conexión: velocidad de internet y cómo se estima si un torrent va a andar bien');
}

/** Nombre de una medición: el del torrent en la biblioteca (las viejas guardaban el hash). */
/** @param {import('./types.js').HealthMeasurement} l @returns {string} */
function nameOf(l) {
  const e = [...state.entries.values()].find((x) => x.info_hash === l.hash);
  const name = e?.torrent_name || e?.name || l.name;
  return !name || /^[0-9a-f]{40}$/i.test(name) ? tr('Torrent sin nombre') : name;
}

function renderPop() {
  const pop = popFor('btn-speed');
  if (!pop) return;
  const cal = healthCalibration(state.entries.values());
  const v = view;
  const measuring = v.kind === 'measuring';

  const internet = el('div', { class: 'conn-card' },
    svgSpan('conn-gauge', gauge(v.mbps ?? 0, 56)),
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-big' }, v.kind === 'done' || measuring ? tr('{a} Mbps', { a: fmt(v.mbps ?? 0) }) : tr('Sin medir')),
      el('span', { class: 'conn-sub' }, measuring ? tr('Midiendo tu internet…')
        : v.kind === 'done' ? tr('Tu internet en esta red · medida {a}', { a: ago(v.at) })
          : v.kind === 'failed' ? v.message : tr('Todavía no se midió'))),
    el('button', { id: 'speed-retest', class: 'pop-btn', disabled: measuring, onclick: () => measure(true) }, measuring ? tr('Midiendo…') : tr('Medir de nuevo')));

  const perSeedNote = cal.source === 'manual' ? tr('Fijado a mano') : tr('Se aprende solo en esta red (arranca en {DEFAULT_SEED_MBPS} Mbps)', { DEFAULT_SEED_MBPS });
  const tracks = calibTracks(cal);
  const doneCount = tracks.filter((t) => t.have >= t.goal).length;
  const now = measuringNow();
  const seeder = el('div', { class: 'conn-card' },
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-big' }, tr('{a} Mbps ', { a: nf1(cal.seedMbps) }), el('small', {}, tr('por seeder'))),
      el('span', { class: 'conn-sub' }, perSeedNote),
      el('div', { id: 'calib-tracks', class: 'calib' },
        el('span', { class: `calib-head ${doneCount === tracks.length ? 'all' : ''}` }, tr('Calibración {doneCount}/{n}', { doneCount, n: tracks.length })),
        tracks.map((t) => {
          const done = t.have >= t.goal;
          return el('div', { id: `calib-${t.id}`, class: `calib-row ${done ? 'done' : ''}` },
            el('span', { class: 'calib-label' }, t.label, el('b', {}, t.value)),
            el('span', { class: 'calib-steps', role: 'progressbar', 'aria-valuenow': t.have, 'aria-valuemin': 0, 'aria-valuemax': t.goal, 'aria-label': t.label },
              Array.from({ length: t.goal }, (_, i) => el('i', { class: i < t.have ? 'on' : '' }))),
            el('span', { class: 'calib-state' }, done ? t.reward : tr('faltan {a} reprod.', { a: t.goal - t.have })));
        })),
      now.length ? el('span', { class: 'conn-live' }, el('i', { 'aria-hidden': 'true' }),
        tr('Midiendo: {a} · {b}{c}', { a: now[0].name, b: mbps(now[0].avg_speed_bps), c: now[0].ev ? '' : tr(' (sin datos del análisis: no cuenta)') })) : null),
    editing
      ? el('span', { class: 'conn-edit' },
        el('input', { id: 'speed-seed-input', type: 'number', min: '0.1', step: '0.5', inputmode: 'decimal', value: String(Math.round(cal.seedMbps * 10) / 10), 'aria-label': tr('Mbps por seeder') }),
        el('button', { id: 'speed-seed-fix', class: 'pop-btn', onclick: fixSeed }, tr('Fijar')),
        cal.source === 'manual' ? el('button', { id: 'speed-seed-auto', class: 'pop-btn', onclick: () => { editing = false; recalibrate(); } }, tr('Usar lo medido')) : null)
      : el('button', { id: 'speed-seed-edit', class: 'pop-btn', onclick: () => { editing = true; renderPop(); /** @type {HTMLInputElement} */ ($('#speed-seed-input'))?.focus(); } }, tr('Cambiar')));

  // Conexiones entrantes (2026-11-16): lo que vieron las reproducciones en esta red.
  const inc = incomingStatus();
  const incoming = el('div', { class: `conn-card conn-incoming ${inc ? (inc.open ? 'open' : 'closed') : ''}` },
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-title' }, inc ? (inc.open ? tr('Entrantes: sí') : tr('Entrantes: no')) : tr('Entrantes: sin datos')),
      el('span', { class: 'conn-sub' }, !inc ? tr('Se sabe después de reproducir algo 2 minutos en esta red.')
        : inc.open ? tr('Otros peers se conectan a vos: más fuentes para cada torrent. Visto {a}.', { a: ago(inc.at) })
          : tr('Tu router no deja entrar conexiones: anda igual, pero con menos peers. Preferí opciones con buena salud; si podés, activá UPnP en el router.'))));

  // Fidelidad (salud fiel): lo que dijo la salud al tocar ▶ vs lo que bajó en los minutos 2–5; cada
  // muestra predicha solo con lo aprendido de las anteriores.
  const f = fidelity(cal.learnable, cal.capFrom === 'test' ? cal.capMbps : null);
  const ok = f && f.n >= 8 && Math.abs(f.biasAfter) <= Math.log(1.5) && f.hits / f.n >= 0.75 && f.pessimistic / f.n <= 0.1;
  /** @param {number} x */
  const dir = (x) => (x < 0 ? tr('pesimista ×{a}', { a: nf1(Math.exp(-x)) }) : tr('optimista ×{a}', { a: nf1(Math.exp(x)) }));
  const fid = el('div', { id: 'conn-fidelity', class: `conn-card ${ok ? 'ok' : ''}` },
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-title' }, f ? tr('Fidelidad: acertó {hits} de {n} niveles', { hits: f.hits, n: f.n }) : tr('Fidelidad: sin datos')),
      el('span', { class: 'conn-sub' }, f
        ? tr('Sin aprender: {a} (error típico ×{b}). Con lo aprendido: {c} (×{d}). Dijo menos de lo que anduvo {pessimistic} veces y más {optimistic}; lo real cayó dentro del rango {inBand} de {n}.', { a: dir(f.biasBefore), b: nf1(Math.exp(f.typBefore)), c: dir(f.biasAfter), d: nf1(Math.exp(f.typAfter)), pessimistic: f.pessimistic, optimistic: f.optimistic, inBand: f.inBand, n: f.n })
        : tr('Se calcula al reproducir 2 minutos algo cuya salud se mostró.'))));

  // Cómo se calcula, con los números de esta PC.
  const how = el('div', { class: 'conn-how' },
    el('p', { class: 'conn-formula' },
      el('span', {}, tr('seeders × {a}', { a: nf1(cal.seedMbps) })), ' + ', el('span', {}, tr('leechers × {a}', { a: nf1(cal.seedMbps / 6) })),
      cal.capMbps ? [tr(' · máx. '), el('span', {}, tr('{a} Mbps', { a: fmt(cal.capMbps) }))] : null,
      ' ÷ ', el('span', {}, tr('lo que pide el video'))),
    el('p', { class: 'conn-legend' },
      el('b', { class: 'good' }, tr('Buena')), tr(' sobra el doble · '), el('b', { class: 'fair' }, tr('Puede cortarse')), tr(' alcanza apenas · '), el('b', { class: 'risky' }, tr('Mala')), tr(' no alcanza')),
    el('p', { class: 'hint' }, tr('"Lo que pide" = tamaño del episodio o película ÷ duración. Si ese torrent ya se midió (reproduciendo, cargando en background o al analizarlo), manda lo medido. Cada reproducción (minutos 2 a 5) compara lo que mostró la salud con lo que bajó de verdad y corrige la estimación, aparte para cada red (casa, trabajo…).')));

  const samples = el('details', { class: 'conn-samples' },
    el('summary', {}, tr('Mediciones ({n})', { n: cal.samples.length })),
    cal.samples.length
      ? el('ul', { class: 'calib-list' }, cal.samples.map((l) => el('li', {},
        el('b', {}, nameOf(l)),
        el('span', {}, sampleText(l)))))
      : el('p', { class: 'hint' }, tr('Todavía ninguna. Se mide sola al ver una opción ya analizada.')),
    cal.samples.length ? el('button', { id: 'speed-reset', class: 'link', onclick: () => { editing = false; resetCalibration(); setStatus(tr('Mediciones olvidadas: se vuelve a calibrar con las próximas reproducciones.')); } }, tr('Olvidar mediciones y volver a calibrar')) : null);

  pop.replaceChildren(
    el('div', { class: 'pop-head' }, el('div', {}, el('h3', {}, tr('Tu conexión')),
      el('p', { class: 'pop-sub' }, tr('Con esto se estima si cada torrent va a andar bien: el ícono de señal y el orden de las opciones.')))),
    internet, seeder, incoming, fid, how, samples);
}

/** Progreso de cada calibración (2026-11-17): segmentos hasta la meta, que es cuando esa evidencia
 *  pasa a confiarse (MIN_SAMPLES) o, la de trackers, a mostrar salud sola (TRACKER_MIN). */
/** @param {import('./types.js').HealthCalibration} cal */
function calibTracks(cal) {
  /** @type {{id: import('./types.js').HealthKind, label: string, value: string, goal: number, reward: string}[]} */
  const tracks = [
    { id: 'counted', label: tr('Seeders contados'), value: tr('{a} Mbps c/u', { a: nf1(cal.seedMbps) }), goal: MIN_SAMPLES, reward: tr('Calibrado') },
    { id: 'tracker', label: tr('Seeders de trackers'), value: tr('{a} Mbps c/u', { a: nf1(cal.trackerSeedMbps) }), goal: TRACKER_MIN, reward: tr('Ya estima salud') },
    { id: 'measured', label: tr('Medición del análisis'), value: `×${nf1(cal.measuredFactor)}`, goal: MIN_SAMPLES, reward: tr('Calibrado') },
  ];
  return tracks.map((t) => ({ ...t, have: Math.min(t.goal, Math.round(cal.bias[t.id]?.nEff ?? 0)) }));
}

/** @param {import('./types.js').HealthMeasurement} l @returns {string} */
function sampleText(l) {
  if (!l.ev) return tr('{seeds} seeders · {a} · {b} por seeder · {c}', { seeds: l.seeds, a: mbps(l.avg_speed_bps), b: nf1((l.avg_speed_bps * 8) / 1e6 / (l.seeds ?? 0)), c: ago(l.measured_at) });
  const p = predict(l.ev, { bias: {}, capMbps: null })?.p50;
  const real = l.real_mbps ?? 0;
  if (p == null) return tr('real {a} Mbps · sin predicción · {b}', { a: nf1(real), b: ago(l.measured_at) });
  return tr('predijo {a} → real {b} Mbps (×{c}) · reales {real_seeds} seeders / {real_peers} peers ({real_incoming} entrantes){d} · {e}', { a: nf1(p), b: nf1(real), c: nf1(real / p), real_seeds: l.real_seeds, real_peers: l.real_peers, real_incoming: l.real_incoming, d: l.short ? tr(' · corta') : '', e: ago(l.measured_at) });
}

function fixSeed() {
  const v = Number(/** @type {HTMLInputElement} */ ($('#speed-seed-input')).value);
  if (!(v > 0)) { setStatus(tr('Poné un número mayor a 0.')); return; }
  editing = false;
  setSeedMbps(v);
}

function render() {
  renderButton();
  renderPop();
}

/** @param {boolean} force */
async function measure(force) {
  view = { kind: 'measuring', mbps: 0 };
  render();
  try {
    const r = await api.speedTest(force);
    view = { kind: 'done', mbps: r.mbps, at: r.measured_at };
    setLinkMbps(r.mbps, r.network);
  } catch (e) {
    view = { kind: 'failed', mbps: 0, message: /** @type {{message?: string}} */ (e)?.message ?? String(e) };
  }
  render();
}

/** Evento `speed-test` del núcleo: lo que va midiendo (el final llega con la respuesta). */
/** @param {import('./types.js').SpeedState} s */
export function onSpeedEvent(s) {
  if (s.kind === 'measuring' && view.kind === 'measuring') {
    view = { ...view, mbps: s.mbps };
    render();
  }
}

export function initSpeed() {
  const btn = $('#btn-speed');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => { editing = false; togglePop(btn, renderPop); });
  window.addEventListener('health-calib-changed', renderPop);
  measure(false);
}
