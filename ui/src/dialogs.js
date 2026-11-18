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
/** Estado de la cuenta de OpenSubtitles.com: conectada (con su cuota), login fallido o sin cuenta. */
async function showOsLogin() {
  const q = await api.premiumQuota().catch(() => null);
  $('#os-login-state').textContent = !q?.has_login ? 'Sin cuenta: la cuota se sabe con la primera descarga.'
    : q.login_error ? `No se pudo entrar: ${q.login_error}`
      : `Cuenta conectada${q.remaining != null ? ` · quedan ${q.remaining} de ${q.per_day} descargas hoy` : ''}.`;
}
/** Guarda usuario y contraseña (vacíos = borrar) y prueba entrar. */
export async function saveOsLogin() {
  const user = $('#os-user'), pass = $('#os-pass');
  try {
    await api.setOpensubtitlesLogin(user.value.trim(), pass.value);
    pass.value = '';
    await showOsLogin();
  } catch (e) { showError(e); }
}

export async function openSettings() {
  try {
    showOsLogin();
    for (const k of await api.apiKeys()) placeKey(k.service, k.configured);
    const { engine, player } = await api.config();
    $(`#set-eq-${player.equalizer}`).checked = true;
    await renderPlayers();
    $('#set-incoming').checked = engine.incoming;
    $('#set-upnp').checked = engine.upnp;
    $('#set-upnp').disabled = !engine.incoming;
    $('#set-announce').checked = engine.announce_early;
    $('#set-announce').disabled = !engine.incoming;
  } catch (e) {
    showError(e);
  }
  $('#dlg-settings').showModal();
}

/** Reproductor (2026-11-17): mpv incluido (o el instalado) o VLC si está. Sin mpv que corra (macOS < 15
 *  sin uno instalado) se recomienda instalarlo; mientras tanto se usa VLC si está. */
async function renderPlayers() {
  const p = await api.playersStatus();
  $(`#set-player-${p.chosen}`).checked = true;
  $('#set-player-vlc').disabled = !p.vlc;
  $('#set-vlc-note').textContent = p.vlc ? 'Sin subtítulos combinados ni ecualizador.' : 'No está instalado en esta compu.';
  $('#set-mpv-note').textContent = { bundled: 'Incluido en la app. Recomendado: anda mejor y gasta menos.', installed: 'El que tenés instalado. Recomendado: anda mejor y gasta menos.',
    configured: 'El de la ruta que elegiste.' }[p.mpv] ?? 'Esta compu no puede usar el que trae la app (pide macOS 15 o más nuevo).';
  $('#set-mpv-missing').hidden = !!p.mpv;
  $('#set-mpv-missing-text').textContent = p.vlc ? 'Mientras tanto se usa VLC. Te recomendamos instalar mpv: anda mejor y gasta menos.'
    : 'Sin mpv ni VLC no se puede reproducir. Instalá mpv (recomendado).';
  $('#btn-install-mpv').textContent = p.can_install_mpv ? 'Instalar mpv' : 'Cómo instalarlo';
}
export async function savePlayer(ev) {
  try {
    await api.setPlayer(ev.target.value);
    setStatus('Reproductor guardado: rige desde la próxima reproducción.');
    await renderPlayers();
  } catch (e) { showError(e); }
}
/** Con Homebrew instala mpv (puede tardar unos minutos); si no, abre la guía de instalación. */
export async function installMpv(ev) {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Instalando… (unos minutos)';
  try {
    const ok = await api.installMpv();
    setStatus(ok ? 'mpv instalado: se usa desde la próxima reproducción.' : 'Abrí la guía de instalación de mpv.');
  } catch (e) { showError(e); } finally {
    btn.disabled = false;
    await renderPlayers().catch(() => {});
  }
}

/** Ecualizador (2026-11-17): rige desde la próxima reproducción. */
export async function saveEqualizer(ev) {
  try {
    await api.setEqualizer(ev.target.value);
    setStatus('Sonido guardado: rige desde la próxima reproducción.');
  } catch (e) {
    showError(e);
  }
}

// ADR-30: entrantes / UPnP. El motor se crea por reproducción, así que aplica en la próxima.
export async function saveNetwork() {
  $('#set-upnp').disabled = !$('#set-incoming').checked;
  $('#set-announce').disabled = !$('#set-incoming').checked;
  try {
    await api.setNetwork($('#set-incoming').checked, $('#set-upnp').checked, $('#set-announce').checked);
    setStatus('Red guardada: aplica desde la próxima reproducción.');
  } catch (e) {
    showError(e);
  }
}

const SERVICE_NAMES = { wyzie: 'Wyzie', opensubtitles: 'OpenSubtitles', tmdb: 'TMDB' };
/** Sección de cada key sin configurar (2026-11-17); configurada, baja a "Conectado". */
const KEY_HOME = { tmdb: 'set-catalog', torbox: 'set-catalog', wyzie: 'set-subs', opensubtitles: 'set-subs' };

/** Pone la fila de la key donde corresponde según si está configurada, con su estado. */
function placeKey(service, configured) {
  const row = document.querySelector(`.key-row[data-service="${service}"]`);
  const home = configured ? $('#set-connected') : document.getElementById(KEY_HOME[service]);
  if (!row || !home) return;
  const badge = document.getElementById(`key-${service}-state`);
  badge.textContent = configured ? '✔ conectada' : 'sin configurar';
  badge.className = `key-state ${configured ? 'ok' : ''}`;
  row.classList.remove('editing', 'saved');
  if (row.parentElement === home) return;
  // En su sección, antes de lo que no es key (las fuentes del catálogo).
  const before = !configured && home.querySelector(':scope > .set-line');
  if (before) before.before(row); else home.append(row);
}

/** "Cambiar" en una key conectada: abre el campo. */
export function toggleKeyEdit(service) {
  const row = document.querySelector(`.key-row[data-service="${service}"]`);
  if (row?.classList.toggle('editing')) document.getElementById(`key-${service}`)?.focus();
}

const DONE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Guarda la key (vacía = la borra). Guardada (2026-11-17): un tilde que se dibuja y un mensaje, y
 *  después la fila baja a "Conectado". TMDB además avisa al catálogo, que se recarga con sus filtros. */
export async function saveKey(service) {
  const input = document.getElementById(`key-${service}`);
  const value = input.value.trim();
  const row = input.closest('.key-row');
  try {
    await api.setApiKey(service, value);
    input.value = '';
    if (service === 'tmdb') document.dispatchEvent(new CustomEvent('streamonte:tmdb-key'));
    if (service === 'torbox') document.dispatchEvent(new CustomEvent('streamonte:torbox-key'));
    if (!value) {
      placeKey(service, false);
      setStatus(`Key de ${SERVICE_NAMES[service]} borrada.`);
      return;
    }
    const done = row.querySelector('.key-done');
    done.innerHTML = DONE_ICON;
    done.append(service === 'tmdb' ? '¡TMDB conectada! El catálogo se recarga con filtros por votos, idioma y géneros.' : `¡${SERVICE_NAMES[service]} conectada!`);
    row.classList.add('saved');
    setStatus(`Key de ${SERVICE_NAMES[service]} guardada en el almacén seguro.`);
    await wait(1800);
    const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (motion) await row.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px)' }], { duration: 220, easing: 'ease-in' }).finished;
    placeKey(service, true);
    if (motion) row.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
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
  out.textContent = 'Abriendo el puerto en el router y probando desde internet (hasta 30 s)…';
  try {
    const r = await api.checkIncoming();
    const ip = r.local_ip ? ` · IP de esta PC: ${r.local_ip}` : '';
    // Por qué está cerrado, según lo que respondió el router a UPnP (2026-11-16).
    const why = !r.upnp_on ? 'UPnP está apagado: abrilo a mano en el router (pasos de arriba)'
      : r.upnp === false ? 'el router rechazó abrirlo por UPnP. Suele ser porque otra PC de la casa ya tiene ese puerto, o el router lo bloquea'
        : r.upnp === true ? 'el router aceptó abrirlo, pero igual no llega: puede ser el firewall de esta PC o que tu proveedor comparta la IP pública (CGNAT)'
          : 'el router no respondió a UPnP (puede tenerlo apagado): activalo en el router o abrí el puerto a mano';
    out.className = `net-check-result ${r.reachable === true ? 'ok' : r.reachable === false ? 'bad' : ''}`;
    out.textContent = r.reachable === true ? `Abierto: el puerto ${r.port} llega desde internet${r.upnp ? ' (lo abrió UPnP)' : ''}${ip}`
      : r.reachable === false ? `Cerrado: el puerto ${r.port} no llega desde internet; ${why}${ip}`
        : `${r.problem ?? 'No se pudo probar.'}${ip}`;
  } catch (e) {
    showError(e);
    out.textContent = '';
  } finally {
    btn.disabled = false;
  }
}
