// "Tu conexión" (2026-11-16): el botón de la barra de arriba muestra la velocidad de internet y abre
// un menú con todo lo que usa la salud estimada de los torrents: la velocidad de internet (techo),
// cuánto aporta cada seeder en esta PC (calibración, `health-calib.js`), cómo se combinan y las
// mediciones. Al abrir la app se pide la velocidad de esta red (el núcleo mide solo si esta red no
// tiene una medición); "Medir de nuevo" la fuerza.

import { api } from './api.js';
import { $, el, setStatus } from './dom.js';
import { ago, mbps, nf1 } from './format.js';
import { DEFAULT_SEED_MBPS, MIN_SAMPLES, MIN_SECS, healthCalibration, incomingStatus, measuringNow, recalibrate, resetCalibration, setLinkMbps, setSeedMbps } from './health-calib.js';
import { state } from './state.js';
import { popFor, togglePop } from './top-menus.js';

/** `{kind: 'idle'|'measuring'|'done'|'failed', mbps, at, message}` */
let view = { kind: 'idle' };
/** Editando el aporte por seeder a mano. */
let editing = false;

/** Ángulo de la aguja: escala logarítmica de 1 a 1000 Mbps sobre media vuelta (-90° a 90°). */
const angle = (v) => -90 + 180 * Math.min(1, Math.max(0, Math.log10(Math.max(1, v)) / 3));

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

function svgSpan(cls, svg) {
  const s = el('span', { class: cls, 'aria-hidden': 'true' });
  s.innerHTML = svg;
  return s;
}

const fmt = (v) => (v >= 100 ? String(Math.round(v)) : nf1(v));

function renderButton() {
  const btn = $('#btn-speed');
  const v = view;
  btn.classList.toggle('measuring', v.kind === 'measuring');
  btn.classList.toggle('failed', v.kind === 'failed');
  btn.setAttribute('aria-busy', String(v.kind === 'measuring'));
  const value = v.kind === 'measuring' || v.kind === 'done' ? `${fmt(v.mbps ?? 0)} <small>Mbps</small>` : v.kind === 'failed' ? 'Sin medir' : 'Medir';
  btn.innerHTML = `${gauge(v.mbps ?? 0)}<span class="speed-val">${value}</span>`;
  btn.title = 'Tu conexión: velocidad de internet y cómo se estima si un torrent va a andar bien';
}

/** Nombre de una medición: el del torrent en la biblioteca (las viejas guardaban el hash). */
function nameOf(l) {
  const e = [...state.entries.values()].find((x) => x.info_hash === l.hash);
  const name = e?.torrent_name || e?.name || l.name;
  return !name || /^[0-9a-f]{40}$/i.test(name) ? 'Torrent sin nombre' : name;
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
      el('span', { class: 'conn-big' }, v.kind === 'done' || measuring ? `${fmt(v.mbps ?? 0)} Mbps` : 'Sin medir'),
      el('span', { class: 'conn-sub' }, measuring ? 'Midiendo tu internet…'
        : v.kind === 'done' ? `Tu internet en esta red · medida ${ago(v.at)}`
          : v.kind === 'failed' ? v.message : 'Todavía no se midió')),
    el('button', { id: 'speed-retest', class: 'pop-btn', disabled: measuring, onclick: () => measure(true) }, measuring ? 'Midiendo…' : 'Medir de nuevo'));

  const perSeedNote = cal.source === 'manual' ? 'Fijado a mano'
    : cal.source === 'measured' ? `Medido en ${cal.n} reproducciones tuyas`
      : `Juntando mediciones: ${cal.n} de ${MIN_SAMPLES} (mientras tanto, ${DEFAULT_SEED_MBPS} Mbps)`;
  const now = measuringNow();
  const seeder = el('div', { class: 'conn-card' },
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-big' }, `${nf1(cal.seedMbps)} Mbps `, el('small', {}, 'por seeder')),
      el('span', { class: 'conn-sub' }, perSeedNote),
      now.length ? el('span', { class: 'conn-live' }, el('i', { 'aria-hidden': 'true' }),
        `Midiendo: ${now[0].name} · ${mbps(now[0].avg_speed_bps)}${now[0].seeds ? '' : ' (sin seeders contados: no cuenta)'}`) : null),
    editing
      ? el('span', { class: 'conn-edit' },
        el('input', { id: 'speed-seed-input', type: 'number', min: '0.1', step: '0.5', inputmode: 'decimal', value: String(Math.round(cal.seedMbps * 10) / 10), 'aria-label': 'Mbps por seeder' }),
        el('button', { id: 'speed-seed-fix', class: 'pop-btn', onclick: fixSeed }, 'Fijar'),
        cal.source === 'manual' ? el('button', { id: 'speed-seed-auto', class: 'pop-btn', onclick: () => { editing = false; recalibrate(); } }, 'Usar lo medido') : null)
      : el('button', { id: 'speed-seed-edit', class: 'pop-btn', onclick: () => { editing = true; renderPop(); $('#speed-seed-input')?.focus(); } }, 'Cambiar'));

  // Conexiones entrantes (2026-11-16): lo que vieron las reproducciones en esta red.
  const inc = incomingStatus();
  const incoming = el('div', { class: `conn-card conn-incoming ${inc ? (inc.open ? 'open' : 'closed') : ''}` },
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-title' }, inc ? (inc.open ? 'Entrantes: sí' : 'Entrantes: no') : 'Entrantes: sin datos'),
      el('span', { class: 'conn-sub' }, !inc ? 'Se sabe después de reproducir algo 2 minutos en esta red.'
        : inc.open ? `Otros peers se conectan a vos: más fuentes para cada torrent. Visto ${ago(inc.at)}.`
          : 'Tu router no deja entrar conexiones: anda igual, pero con menos peers. Preferí opciones con buena salud; si podés, activá UPnP en el router.')));

  // Cómo se calcula, con los números de esta PC.
  const how = el('div', { class: 'conn-how' },
    el('p', { class: 'conn-formula' },
      el('span', {}, `seeders × ${nf1(cal.seedMbps)}`), ' + ', el('span', {}, `leechers × ${nf1(cal.seedMbps / 6)}`),
      cal.capMbps ? [' · máx. ', el('span', {}, `${fmt(cal.capMbps)} Mbps`)] : null,
      ' ÷ ', el('span', {}, 'lo que pide el video')),
    el('p', { class: 'conn-legend' },
      el('b', { class: 'good' }, 'Buena'), ' sobra el doble · ', el('b', { class: 'fair' }, 'Puede cortarse'), ' alcanza apenas · ', el('b', { class: 'risky' }, 'Mala'), ' no alcanza'),
    el('p', { class: 'hint' }, `"Lo que pide" = tamaño del episodio o película ÷ duración. Si ese torrent ya se midió (reproduciendo, cargando en background o al analizarlo), manda lo medido. Cada reproducción de más de ${MIN_SECS} s de una opción analizada calibra el aporte por seeder, aparte para cada red (casa, trabajo…).`));

  const samples = el('details', { class: 'conn-samples' },
    el('summary', {}, `Mediciones (${cal.n})`),
    cal.samples.length
      ? el('ul', { class: 'calib-list' }, cal.samples.map((l) => el('li', {},
        el('b', {}, nameOf(l)),
        el('span', {}, `${l.seeds} seeders · ${mbps(l.avg_speed_bps)} · ${nf1((l.avg_speed_bps * 8) / 1e6 / l.seeds)} por seeder · ${ago(l.measured_at)}`))))
      : el('p', { class: 'hint' }, 'Todavía ninguna. Se mide sola al ver una opción ya analizada.'),
    cal.n ? el('button', { id: 'speed-reset', class: 'link', onclick: () => { editing = false; resetCalibration(); setStatus('Mediciones olvidadas: se vuelve a calibrar con las próximas reproducciones.'); } }, 'Olvidar mediciones y volver a calibrar') : null);

  pop.replaceChildren(
    el('div', { class: 'pop-head' }, el('div', {}, el('h3', {}, 'Tu conexión'),
      el('p', { class: 'pop-sub' }, 'Con esto se estima si cada torrent va a andar bien: el ícono de señal y el orden de las opciones.'))),
    internet, seeder, incoming, how, samples);
}

function fixSeed() {
  const v = Number($('#speed-seed-input').value);
  if (!(v > 0)) { setStatus('Poné un número mayor a 0.'); return; }
  editing = false;
  setSeedMbps(v);
}

function render() {
  renderButton();
  renderPop();
}

async function measure(force) {
  view = { kind: 'measuring', mbps: 0 };
  render();
  try {
    const r = await api.speedTest(force);
    view = { kind: 'done', mbps: r.mbps, at: r.measured_at };
    setLinkMbps(r.mbps, r.network);
  } catch (e) {
    view = { kind: 'failed', mbps: 0, message: e?.message ?? String(e) };
  }
  render();
}

/** Evento `speed-test` del núcleo: lo que va midiendo (el final llega con la respuesta). */
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
