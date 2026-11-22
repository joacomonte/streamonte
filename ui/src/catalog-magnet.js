// @ts-check
// "Pegar magnet" con TorBox (2026-11-20, como la web): el torrent pegado (Pegados o el buscador). Si TorBox lo tiene,
// sus videos; si no, "Bajarlo en TorBox" con el avance en vivo. Arriba, la película o serie si se reconoce por el
// nombre (TMDB), con "Ver ficha". Reproducir sigue siendo el ▶ de Pegados (por torrent).
import { api } from './api.js';
import { $, el, icon } from './dom.js';
import { humanBytes } from './format.js';
import { t } from './i18n.js';
import { magnetHash } from './magnet-hash.js';
import { openSide } from './catalog-side.js';

export { magnetHash };

/** @typedef {import('./types.js').MagnetStatus} MagnetStatus */
/** @typedef {import('./types.js').Identified} Identified */
/** @typedef {{hash: string, name: string, st: MagnetStatus|null, ident: Identified|null, error: string, adding: boolean,
 *   timer: ReturnType<typeof setInterval>|undefined, download?: () => Promise<void>}} OpenMagnet */

/** Mensaje de un rechazo del núcleo (`UiError`) o de cualquier otro error. @param {unknown} e */
const errText = (e) => t(/** @type {{message?: string}|null|undefined} */ (e)?.message ?? String(e));

/** El que está abierto: cerrar el diálogo o abrir otro corta su consulta de avance.
 *  @type {OpenMagnet|null} */
let open = null;

/** @param {string} hash @param {string} name */
export function openMagnet(hash, name) {
  /** @type {HTMLDialogElement} */
  let dlg = $('#dlg-magnet');
  if (!dlg) {
    dlg = /** @type {HTMLDialogElement} */ (el('dialog', { id: 'dlg-magnet', class: 'dialog magnet', onclose: () => { clearInterval(open?.timer); open = null; } }));
    document.body.append(dlg);
  }
  clearInterval(open?.timer);
  /** @type {OpenMagnet} */
  const cur = (open = { hash, name, st: null, ident: null, error: '', adding: false, timer: undefined });
  const draw = () => { if (open === cur) dlg.replaceChildren(...view(cur, dlg)); };
  const load = async (/** @type {boolean} */ who) => {
    try {
      const r = await api.torboxMagnet(hash, name, who);
      if (open !== cur) return;
      if (who) cur.ident = r.ident;
      cur.st = r.status;
    } catch (e) { cur.error = errText(e); }
    // Bajándose en TorBox: se pregunta el avance cada 4 s mientras esté abierto.
    clearInterval(cur.timer);
    if (cur.st?.state === 'downloading') cur.timer = setInterval(() => load(false), 4000);
    draw();
  };
  cur.download = async () => {
    cur.adding = true;
    cur.error = '';
    draw();
    try { cur.st = await api.torboxMagnetDownload(hash, name); } catch (e) { cur.error = errText(e); }
    cur.adding = false;
    clearInterval(cur.timer);
    if (cur.st?.state === 'downloading') cur.timer = setInterval(() => load(false), 4000);
    draw();
  };
  draw();
  if (!dlg.open) dlg.showModal();
  load(true);
}

/** @param {number} b */
const speed = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`);
/** @param {number} sec */
const eta = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`);
/** @param {boolean} moving */
const cloud = (moving) => el('span', { class: `mag-cloud ${moving ? 'moving' : ''}`, 'aria-hidden': 'true' }, icon('cloud', 54), el('span', { class: 'mag-arrow' }, icon('download', 22)));

/** @param {OpenMagnet} cur @param {HTMLDialogElement} dlg */
function view(cur, dlg) {
  const { st, ident } = cur;
  const name = ident?.name ?? st?.name ?? cur.name ?? t('Torrent pegado');
  const ep = ident?.season && ident?.episode ? `T${ident.season} E${ident.episode}` : ident?.season ? `T${ident.season}` : '';
  const sub = [ident ? '' : t('Torrent pegado'), ident?.year, ep, ident?.rating ? `★ ${ident.rating}` : ''].filter(Boolean).join(' · ');
  const head = el('header', { class: 'mag-head' },
    ident?.poster ? el('img', { class: 'mag-poster', src: ident.poster, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'mag-poster none' }, icon('peers', 26)),
    el('div', { class: 'mag-who' }, el('h3', {}, name), sub ? el('p', { class: 'hint' }, sub) : null,
      ident ? el('button', { id: 'mag-to-title', type: 'button', class: 'link', onclick: () => { dlg.close(); openSide(ident.kind, ident.id, ident.name); } }, t('Ver ficha')) : null));
  let body;
  if (cur.error) body = el('p', { class: 'mag-status error', role: 'alert' }, cur.error);
  else if (!st) body = el('p', { class: 'mag-status' }, el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }), t('Preguntándole a TorBox…'));
  else if (st.state === 'missing') {
    body = el('div', { class: 'mag-card' }, cloud(false),
      el('b', {}, t('TorBox todavía no lo tiene')),
      el('span', { class: 'hint' }, t('Lo puede bajar en sus servidores: tarda según cuántos lo comparten. Después se ve al instante.')),
      el('button', { id: 'mag-download', type: 'button', class: 'primary', disabled: cur.adding, onclick: cur.download },
        cur.adding ? el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }) : icon('download', 16), t('Bajarlo en TorBox')));
  } else if (st.state === 'downloading') {
    body = el('div', { class: 'mag-card', role: 'status' }, cloud(true),
      el('b', {}, t('TorBox lo está bajando')),
      el('span', { class: 'mag-bar' }, el('i', { style: `width:${Math.max(3, st.progress * 100)}%` })),
      el('span', { class: 'hint mag-nums' }, `${Math.floor(st.progress * 100)} % · ${speed(st.speed)} · ${t('{n} seeds', { n: st.seeds })}${st.eta ? ` · ${t('falta {t}', { t: eta(st.eta) })}` : ''}`),
      el('span', { class: 'hint small' }, t('Podés cerrar esto: sigue bajando en TorBox y vuelve a aparecer acá.')));
  } else if (!st.files.length) body = el('p', { class: 'mag-status hint' }, t('Este torrent no trae videos.'));
  else {
    body = [el('p', { class: 'mag-ready' }, icon('check', 14), t(st.state === 'ready' ? 'Ya está en tu cuenta de TorBox' : 'Está en la caché de TorBox: se ve al instante')),
      el('ul', { class: 'mag-files' }, st.files.map((f, i) => el('li', { id: `mag-file-${i}` },
        el('span', { class: 'mag-file-name', title: f.name }, f.name), el('span', { class: 'mag-file-size' }, humanBytes(f.size)))))];
  }
  return [head, ...[body].flat(), el('div', { class: 'dialog-actions' }, el('button', { id: 'mag-close', type: 'button', onclick: () => dlg.close() }, t('Cerrar')))];
}
