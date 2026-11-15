// Diálogos: confirmación (cola), log de una reproducción (FR-15), seguir bajando tras cerrar mpv (FR-12c), limpieza (FR-16/19),
// Ajustes y cierre con reproducciones activas (FR-17).
import { api } from './api.js';
import { $, el, setStatus, showError } from './dom.js';
import { ago, humanBytes, mbps, nf1 } from './format.js';
import { DEFAULT_SEED_MBPS, MIN_SAMPLES, MIN_SECS, healthCalibration, measuringNow, recalibrate, resetCalibration, setSeedMbps } from './health-calib.js';
import { state, titleOf } from './state.js';

/** Diálogo de confirmación con botones; devuelve el `value` del botón elegido (o null).
 *  Hay un solo <dialog>: los pedidos se encolan y se muestran de a uno. */
let confirmQueue = Promise.resolve();
export function confirmDialog(title, text, buttons) {
  const shown = confirmQueue.then(() => showConfirm(title, text, buttons));
  confirmQueue = shown;
  return shown;
}
function showConfirm(title, text, buttons) {
  const dlg = $('#dlg-confirm');
  $('#dlg-confirm-title').textContent = title;
  $('#dlg-confirm-text').textContent = text;
  const actions = $('#dlg-confirm-actions');
  actions.replaceChildren();
  return new Promise((resolve) => {
    for (const b of buttons) {
      actions.append(
        el('button', { class: b.primary ? 'primary' : '', onclick: () => { dlg.close(); resolve(b.value); } }, b.label),
      );
    }
    dlg.onclose = () => resolve(null);
    dlg.showModal();
  });
}

// ---------- "Ver análisis" (FR-30) ----------
// Veredicto: velocidad real contra lo que consume el video (bitrate = tamaño ÷ duración).
// ---------- reproducción: después de cerrar mpv y log en vivo ----------
/** Se cerró mpv sin terminar de bajar: ¿seguir bajando de fondo o pausar? (2026-11-14) */
export async function askAfterClose(row) {
  const t = titleOf(row.key);
  const pct = Math.floor((row.progress ?? 0) * 100);
  const choice = await confirmDialog(
    'Cerraste el reproductor',
    `${t} va ${pct} % bajado.\n\n¿Lo sigo bajando de fondo, para que después lo veas sin esperar, o lo pauso? Lo bajado queda guardado en los dos casos.`,
    [
      { label: 'Pausar', value: 'stop' },
      { label: 'Seguir bajando', value: 'keep-downloading', primary: true },
    ],
  );
  // Cerrar el diálogo sin elegir = pausar (lo de siempre). Si ya se resolvió solo, no importa.
  api.playbackAction(row.id, choice ?? 'stop').catch(() => {});
}

export async function openLog(row) {
  state.logOpenFor = row.id;
  $('#dlg-log-title').textContent = `Detalle — ${row.name}`;
  const lines = await api.playbackLog(row.id).catch(() => state.logs.get(row.id) ?? []);
  state.logs.set(row.id, lines);
  $('#dlg-log-body').textContent = lines.join('\n');
  $('#dlg-log').showModal();
}

// ---------- limpieza (FR-16, FR-18, FR-19) ----------
export async function cleanTemp() {
  try {
    const usage = await api.tempUsage();
    if (usage.bytes === 0) {
      setStatus('La caché está vacía.');
      return;
    }
    const ok = await confirmDialog(
      'Borrar caché',
      `Se van a borrar ${humanBytes(usage.bytes)}: lo analizado y restos que no están en uso. No se tocan lo que se está reproduciendo ni las descargas guardadas.`,
      [{ label: 'Cancelar', value: false }, { label: `Borrar ${humanBytes(usage.bytes)}`, value: true, primary: true }],
    );
    if (!ok) return;
    const r = await api.cleanTemp();
    setStatus(`Caché borrada: ${r.dirs_removed} carpeta(s), ${humanBytes(r.bytes_freed)} liberados${r.failures.length ? ` · ${r.failures.length} no se pudieron borrar (se reintenta al abrir)` : ''}.`);
  } catch (e) {
    showError(e);
  }
}

export async function stopAllAndClean() {
  const ok = await confirmDialog(
    'Borrar todo',
    'Se detienen todas las reproducciones y se borra TODO lo descargado, también lo pausado. Tu lista de magnets no se toca.',
    [{ label: 'Cancelar', value: false }, { label: 'Borrar todo', value: true, primary: true }],
  );
  if (!ok) return;
  try {
    const r = await api.stopAllAndClean();
    setStatus(`Todo borrado.${r.dirs_removed ? ` Restos limpiados: ${humanBytes(r.bytes_freed)}.` : ''}`);
  } catch (e) {
    showError(e);
  }
}

// ---------- Ajustes: API keys de subtítulos ----------
export async function openSettings() {
  try {
    for (const k of await api.apiKeys()) {
      const badge = document.getElementById(`key-${k.service}-state`);
      if (badge) {
        badge.textContent = k.configured ? '✔ configurada' : 'sin configurar';
        badge.className = `key-state ${k.configured ? 'ok' : ''}`;
      }
    }
    const { engine } = await api.config();
    $('#set-incoming').checked = engine.incoming;
    $('#set-upnp').checked = engine.upnp;
    $('#set-upnp').disabled = !engine.incoming;
  } catch (e) {
    showError(e);
  }
  showHealthCalibration();
  $('#dlg-settings').showModal();
}

// ---------- Ajustes: calibración de la salud estimada (2026-11-15) ----------
/** Panel de calibración (2026-11-15): estado, lo que se mide ahora y cada medición. Se redibuja
 *  solo mientras Ajustes está abierto (`health-calib-changed`). */
function showHealthCalibration() {
  const cal = healthCalibration(state.entries.values());
  const editing = document.activeElement === $('#set-seed-mbps');
  if (!editing) $('#set-seed-mbps').value = Math.round(cal.seedMbps * 10) / 10;
  $('#health-calib-state').textContent = { measured: 'calibrado', manual: 'fijado a mano', default: 'por defecto' }[cal.source];
  const perSeed = (l) => `${nf1((l.avg_speed_bps * 8) / 1e6 / l.seeds)} Mbps/seeder`;
  const status = cal.source === 'manual'
    ? `Fijado a mano en ${nf1(cal.seedMbps)} Mbps por seeder; lo medido sigue juntándose (${cal.n}).`
    : cal.source === 'measured'
      ? `Calibrado con ${cal.n} mediciones: ${nf1(cal.seedMbps)} Mbps por seeder${cal.capMbps ? ` · tu conexión llegó a ~${Math.round(cal.capMbps)} Mbps` : ''}.`
      : `Juntando mediciones: ${cal.n} de ${MIN_SAMPLES}. Hasta entonces se usa ${DEFAULT_SEED_MBPS} Mbps por seeder.`;
  const now = measuringNow();
  $('#health-calib-panel').replaceChildren(
    el('p', { class: 'calib-status' }, status),
    cal.source === 'default' ? el('div', { class: 'calib-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(MIN_SAMPLES), 'aria-valuenow': String(cal.n) },
      el('i', { style: `width:${Math.round((cal.n / MIN_SAMPLES) * 100)}%` })) : null,
    el('h5', {}, 'Midiendo ahora'),
    now.length
      ? el('ul', { class: 'calib-list' }, now.map((t) => el('li', {},
        el('b', {}, t.name), el('span', {}, `${t.source} · ${mbps(t.avg_speed_bps)} · ${t.secs} s`),
        el('span', { class: 'calib-note' }, !t.seeds ? 'sin seeders contados: no calibra (analizalo antes de verlo)'
          : t.secs < MIN_SECS ? `cuenta a partir de los ${MIN_SECS} s` : `${t.seeds} seeders · ${perSeed(t)}`))))
      : el('p', { class: 'hint' }, 'Nada ahora. Se mide solo cuando ves o cargás en background una opción ya analizada.'),
    el('h5', {}, `Mediciones (${cal.n})`),
    cal.samples.length
      ? el('ul', { class: 'calib-list' }, cal.samples.map((l) => el('li', {},
        el('b', {}, l.name ?? 'torrent'),
        el('span', {}, `${l.source ?? 'background'} · ${l.seeds} seeders · ${mbps(l.avg_speed_bps)} en ${Math.round(l.measured_secs)} s`),
        el('span', { class: 'calib-note' }, `${perSeed(l)} · ${ago(l.measured_at)}`))))
      : el('p', { class: 'hint' }, 'Todavía ninguna.'));
}
window.addEventListener('health-calib-changed', () => { if ($('#dlg-settings').open) showHealthCalibration(); });

export function onHealthCalibration(action) {
  const v = Number($('#set-seed-mbps').value);
  if (action === 'fix' && !(v > 0)) { setStatus('Poné un número mayor a 0.'); return; }
  if (action === 'fix') setSeedMbps(v);
  if (action === 'recalibrate') recalibrate();
  if (action === 'reset') resetCalibration();
  showHealthCalibration();
  setStatus('Salud estimada: se aplica al volver a dibujar el catálogo.');
}

// ADR-30: entrantes / UPnP. El motor se crea por reproducción, así que aplica en la próxima.
export async function saveNetwork() {
  $('#set-upnp').disabled = !$('#set-incoming').checked;
  try {
    await api.setNetwork($('#set-incoming').checked, $('#set-upnp').checked);
    setStatus('Red guardada: aplica desde la próxima reproducción.');
  } catch (e) {
    showError(e);
  }
}

const SERVICE_NAMES = { wyzie: 'Wyzie', opensubtitles: 'OpenSubtitles', tmdb: 'TMDB' };

export async function saveKey(service) {
  const input = document.getElementById(`key-${service}`);
  try {
    await api.setApiKey(service, input.value.trim());
    input.value = '';
    setStatus(`Key de ${SERVICE_NAMES[service]} guardada en el almacén seguro.`);
    await openSettings();
  } catch (e) {
    showError(e);
  }
}

// ---------- cierre (FR-17) ----------
/** Cada clic en la X re-emite el evento `confirm-close`: uno solo a la vez. */
let closeAsking = false;
export async function onConfirmClose(count) {
  if (closeAsking) return;
  closeAsking = true;
  const choice = await confirmDialog(
    'Cerrar Streamonte',
    `Hay ${count} reproducción(es) activa(s). En los dos casos la descarga queda pausada y guardada para retomarla al volver a abrir la app.`,
    [
      { label: 'Cancelar', value: null },
      { label: 'Dejar el reproductor abierto', value: 'leave-running' },
      { label: 'Cerrar el reproductor y salir', value: 'stop-all', primary: true },
    ],
  );
  closeAsking = false;
  if (choice) {
    setStatus('Cerrando…');
    await api.onClose(choice).catch(showError);
  }
}

// ---------- Ajustes › Red: verificar el puerto entrante (2026-11-15) ----------
export async function onNetCheck() {
  const btn = $('#btn-net-check');
  const out = $('#net-check-result');
  btn.disabled = true;
  out.className = 'net-check-result';
  out.textContent = 'Probando desde internet…';
  try {
    const r = await api.checkIncoming();
    const ip = r.local_ip ? ` · IP de esta PC: ${r.local_ip}` : '';
    out.className = `net-check-result ${r.reachable === true ? 'ok' : r.reachable === false ? 'bad' : ''}`;
    out.textContent = r.reachable === true ? `Abierto: el puerto ${r.port} llega desde internet${ip}`
      : r.reachable === false ? `Cerrado: el puerto ${r.port} no llega desde internet. Seguí los pasos de arriba${ip}`
        : `${r.problem ?? 'No se pudo probar.'}${ip}`;
  } catch (e) {
    showError(e);
    out.textContent = '';
  } finally {
    btn.disabled = false;
  }
}
