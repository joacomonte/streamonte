// Diálogos: confirmación (cola), log de una reproducción (FR-15), seguir bajando tras cerrar mpv (FR-12c), limpieza (FR-16/19),
// Ajustes y cierre con reproducciones activas (FR-17).
import { api } from './api.js';
import { $, el, setStatus, showError } from './dom.js';
import { humanBytes } from './format.js';
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
  $('#dlg-confirm-text').replaceChildren(text); // texto o un nodo armado (barra de progreso)
  const actions = $('#dlg-confirm-actions');
  actions.replaceChildren();
  return new Promise((resolve) => {
    for (const b of buttons) {
      actions.append(
        el('button', { id: b.id, class: `${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, autofocus: b.primary || null, onclick: () => { dlg.close(); resolve(b.value); } }, b.label),
      );
    }
    dlg.onclose = () => resolve(null);
    dlg.showModal();
  });
}

// ---------- "Ver análisis" (FR-30) ----------
// Veredicto: velocidad real contra lo que consume el video (bitrate = tamaño ÷ duración).
// ---------- reproducción: después de cerrar mpv y log en vivo ----------
/** Se cerró mpv sin terminar de bajar (2026-11-16): detener y borrar (por defecto), pausar
 *  guardando lo bajado, o seguir bajando de fondo. */
export async function askAfterClose(row) {
  const pct = Math.floor((row.progress ?? 0) * 100);
  const body = el('span', { class: 'close-dl' },
    el('span', { class: 'close-dl-head' }, el('b', {}, titleOf(row.key)), el('span', {}, `${pct} % bajado`)),
    el('span', { class: 'close-dl-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, el('i', { style: `width:${pct}%` })));
  const choice = await confirmDialog('Cerraste el reproductor', body, [
    { id: 'close-keep', label: 'Seguir bajando', value: 'keep-downloading' },
    { id: 'close-pause', label: 'Pausar', value: 'stop' },
    { id: 'close-delete', label: 'Detener y borrar', value: 'stop-and-delete', primary: true },
  ]);
  // Cerrar el diálogo sin elegir (Esc) = pausar: nunca se borra sin un clic. Si ya se resolvió solo, no importa.
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

/** "Borrar datos guardados" (2026-11-16): la caché de datos es útil, así que se explica antes. */
export async function clearDataCache() {
  try {
    const bytes = await api.dataCacheSize();
    if (!bytes) { setStatus('No hay datos guardados.'); return; }
    const ok = await confirmDialog(
      'Borrar datos guardados',
      `Son ${humanBytes(bytes)} de fichas, portadas, puntajes por temporada y los datos de IMDb. Sirven para que el catálogo y las series abran al instante y no haya que volver a bajarlos (los de IMDb tardan unos segundos). No son videos.\n\nSi los borrás no se pierde nada: se vuelven a bajar cuando hagan falta.`,
      [{ id: 'data-clear-cancel', label: 'Cancelar', value: false }, { id: 'data-clear-ok', label: `Borrar ${humanBytes(bytes)}`, value: true, primary: true }],
    );
    if (!ok) return;
    setStatus(`Datos guardados borrados: ${humanBytes(await api.clearDataCache())} liberados.`);
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
  $('#dlg-settings').showModal();
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
