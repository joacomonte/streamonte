// Diálogos: confirmación (cola), log de una reproducción (FR-15), seguir bajando tras cerrar mpv (FR-12c), limpieza (FR-16/19),
// Ajustes y cierre con reproducciones activas (FR-17).
import { api } from './api.js';
import { $, el, setStatus, showError } from './dom.js';
import { humanBytes, mbps } from './format.js';
import { DEFAULT_SEED_MBPS, MIN_SAMPLES, healthCalibration, recalibrate, resetCalibration, setSeedMbps } from './health-calib.js';
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
      setStatus('No hay temporales para limpiar.');
      return;
    }
    const ok = await confirmDialog(
      'Limpiar temporales',
      `Se van a borrar ${humanBytes(usage.bytes)} de restos que no están en uso. Las reproducciones activas, las pausadas y tu lista no se tocan.`,
      [{ label: 'Cancelar', value: false }, { label: `Borrar ${humanBytes(usage.bytes)}`, value: true, primary: true }],
    );
    if (!ok) return;
    const r = await api.cleanTemp();
    setStatus(`Limpieza: ${r.dirs_removed} carpeta(s), ${humanBytes(r.bytes_freed)} liberados${r.failures.length ? ` · ${r.failures.length} no se pudieron borrar (se reintenta al abrir)` : ''}.`);
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
function showHealthCalibration() {
  const cal = healthCalibration(state.entries.values());
  $('#set-seed-mbps').value = Math.round(cal.seedMbps * 10) / 10;
  $('#health-calib-state').textContent = { measured: 'calibrado', manual: 'fijado a mano', default: 'por defecto' }[cal.source];
  $('#health-calib-detail').textContent = `${cal.n} medición(es) de velocidad útiles${cal.n < MIN_SAMPLES ? ` (con ${MIN_SAMPLES} se calibra solo; hasta entonces ${DEFAULT_SEED_MBPS} Mbps)` : ''}${cal.capMbps ? ` · tope de tu conexión: ~${Math.round(cal.capMbps)} Mbps` : ''}.`;
}

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
