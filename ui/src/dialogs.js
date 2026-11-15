// Diálogos de Mis magnets: confirmación (cola), "Ver análisis" (FR-30),
// log de una reproducción (FR-15), seguir bajando tras cerrar mpv (FR-12c), limpieza (FR-16/19),
// Ajustes y cierre con reproducciones activas (FR-17).
import { api } from './api.js';
import { $, el, setStatus, showError } from './dom.js';
import { ago, clock, humanBytes, mbps, verdict } from './format.js';
import { fullName, state, titleOf } from './state.js';

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
const LIGHT_LABEL = { green: 'Sobrado', yellow: 'Justo', red: 'Mal', unknown: 'Sin medir' };
const STATUS_LABEL = {
  new: 'Sin analizar',
  scraping: 'Consultando trackers…',
  scraped: 'Trackers consultados',
  measuring: 'Midiendo velocidad real…',
  measured: 'Medido',
  failed: 'Falló la medición',
};

function langSummary(e) {
  const langs = e.languages ?? [];
  if (!langs.length) return e.live?.audio ? 'sin pistas de audio con idioma' : null;
  const src = langs[0].confirmed ? '' : ' (según el nombre, sin confirmar)';
  return langs.map((l) => `${l.label}${l.detail ? ` — ${l.detail}` : ''}`).join('\n') + src;
}

export function showAnalysis(key) {
  const e = state.entries.get(key);
  if (!e) return;
  const s = e.score;
  const live = e.live;
  const row = (k, v) => (v == null || v === '' ? null : el('tr', {}, el('th', {}, k), el('td', {}, String(v))));
  const status = e.status?.kind ?? 'new';
  $('#dlg-analysis-title').textContent = fullName(e);
  $('#dlg-analysis-body').replaceChildren(
    ...[
      row('Nombre real del torrent', e.torrent_name ?? live?.torrent_name ?? '(todavía no llegaron los metadatos)'),
      row('Nombre en el magnet (dn)', e.name),
      row('Info hash', e.info_hash),
      row('Archivo de video', live?.file_name),
      row('Idiomas de audio', langSummary(e)),
      row('Tamaño', (e.video_size ?? live?.file_size) ? humanBytes(e.video_size ?? live.file_size) : null),
      row('Duración', s.duration ? `${s.duration.estimated ? '~' : ''}${clock(s.duration.secs, true)}${s.duration.estimated ? ' (estimada: falta medir)' : ' (real)'}` : null),
      row('Seeders / leechers (trackers)', e.scrape ? `${e.scrape.seeders} / ${e.scrape.leechers} · respondieron ${e.scrape.trackers_ok} tracker(s) ${ago(e.scrape.scraped_at)}` : 'sin consultar'),
      row('Seeders conectados (reales)', live ? live.seeds ?? 0 : null),
      row('Peers conectados al medir', live?.peers),
      row('Precisión', live ? (live.partial ? `Parcial: ${Math.round(live.measured_secs)} s medidos (se pausó el análisis)` : `Completa: ${Math.round(live.measured_secs || 0)} s medidos`) : null),
      row('Velocidad real (promedio / máxima)', live ? `${mbps(live.avg_speed_bps)} / ${mbps(live.max_speed_bps)}` : 'sin medir'),
      row('Velocidad calibrada', s.effective_speed_bps != null && s.speed_factor !== 1 ? `${mbps(s.effective_speed_bps)} (×${s.speed_factor.toFixed(2).replace('.', ',')} según tus reproducciones)` : null),
      row('Velocidad que necesita', s.needed_bps ? mbps(s.needed_bps) : null),
      row('Margen', s.margin != null ? `${s.margin.toFixed(2).replace('.', ',')}× (verde ≥ ${s.green_margin.toLocaleString('es-AR')} · amarillo ≥ ${s.yellow_margin.toLocaleString('es-AR')})` : null),
      row('Semáforo', `${LIGHT_LABEL[s.light]}: ${verdict(s).text}`),
      row('Estado', `${STATUS_LABEL[status] ?? status}${status === 'failed' && e.status.reason ? `: ${e.status.reason}` : ''}`),
      row('Medido', live ? ago(live.measured_at) : null),
      row('Agregado', ago(e.added_at)),
    ].filter(Boolean),
  );
  $('#dlg-analysis').showModal();
}

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
    'Cerrar Torrent Stream',
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
