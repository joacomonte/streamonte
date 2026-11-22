// @ts-check
// Diálogos: confirmación (cola), log de una reproducción (FR-15), seguir bajando tras cerrar mpv (FR-12c), limpieza (FR-16/19),
// Ajustes y cierre con reproducciones activas (FR-17).
import { api } from './api.js';
import { $, $button, $input, el, setStatus, showError } from './dom.js';
import { t } from './i18n.js';
import { humanBytes } from './format.js';
import { state, titleOf } from './state.js';

/** Diálogo de confirmación con botones; devuelve el `value` del botón elegido (o null).
 *  Hay un solo <dialog>: los pedidos se encolan y se muestran de a uno. */
let confirmQueue = Promise.resolve();
/** @typedef {{id?: string, label: string, value: unknown, primary?: boolean, danger?: boolean}} ConfirmButton */
/** @param {string} title @param {string|Node} text @param {ConfirmButton[]} buttons @returns {Promise<any>}  `value` del botón elegido: lo que pase quien llama */
export function confirmDialog(title, text, buttons) {
  const shown = confirmQueue.then(() => showConfirm(title, text, buttons));
  confirmQueue = shown;
  return shown;
}
/** @param {string} title @param {string|Node} text @param {ConfirmButton[]} buttons @returns {Promise<any>} */
function showConfirm(title, text, buttons) {
  const dlg = /** @type {HTMLDialogElement} */ ($('#dlg-confirm'));
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
/** @param {import('./types.js').PlaybackRow} row */
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

/** @param {import('./types.js').PlaybackRow} row */
export async function openLog(row) {
  state.logOpenFor = row.id;
  $('#dlg-log-title').textContent = t('Detalle — {name}', { name: row.name });
  const lines = await api.playbackLog(row.id).catch(() => state.logs.get(row.id) ?? []);
  state.logs.set(row.id, lines);
  $('#dlg-log-body').textContent = lines.join('\n');
  /** @type {HTMLDialogElement} */ ($('#dlg-log')).showModal();
}

// ---------- limpieza (FR-16, FR-18, FR-19) ----------
export async function cleanTemp() {
  try {
    const usage = await api.tempUsage();
    if (usage.bytes === 0) {
      setStatus(t('La caché está vacía.'));
      return;
    }
    const ok = await confirmDialog(
      t('Borrar caché'),
      t('Se van a borrar {a}: lo analizado y restos que no están en uso. No se tocan lo que se está reproduciendo ni las descargas guardadas.', { a: humanBytes(usage.bytes) }),
      [{ label: t('Cancelar'), value: false }, { label: t('Borrar {a}', { a: humanBytes(usage.bytes) }), value: true, primary: true }],
    );
    if (!ok) return;
    const r = await api.cleanTemp();
    setStatus(t('Caché borrada: {dirs_removed} carpeta(s), {a} liberados{b}.', { dirs_removed: r.dirs_removed, a: humanBytes(r.bytes_freed), b: r.failures.length ? t(' · {n} no se pudieron borrar (se reintenta al abrir)', { n: r.failures.length }) : '' }));
  } catch (e) {
    showError(e);
  }
}

/** "Borrar datos guardados" (2026-11-16): la caché de datos es útil, así que se explica antes. */
export async function clearDataCache() {
  try {
    const bytes = await api.dataCacheSize();
    if (!bytes) { setStatus(t('No hay datos guardados.')); return; }
    const ok = await confirmDialog(
      t('Borrar datos guardados'),
      t('Son {a} de fichas, portadas, puntajes por temporada y los datos de IMDb. Sirven para que el catálogo y las series abran al instante y no haya que volver a bajarlos (los de IMDb tardan unos segundos). No son videos.\n\nSi los borrás no se pierde nada: se vuelven a bajar cuando hagan falta.', { a: humanBytes(bytes) }),
      [{ id: 'data-clear-cancel', label: t('Cancelar'), value: false }, { id: 'data-clear-ok', label: t('Borrar {a}', { a: humanBytes(bytes) }), value: true, primary: true }],
    );
    if (!ok) return;
    setStatus(t('Datos guardados borrados: {a} liberados.', { a: humanBytes(await api.clearDataCache()) }));
  } catch (e) {
    showError(e);
  }
}

export async function stopAllAndClean() {
  const ok = await confirmDialog(
    t('Borrar todo'),
    t('Se detienen todas las reproducciones y se borra TODO lo descargado, también lo pausado. Tu lista de magnets no se toca.'),
    [{ label: t('Cancelar'), value: false }, { label: t('Borrar todo'), value: true, primary: true }],
  );
  if (!ok) return;
  try {
    const r = await api.stopAllAndClean();
    setStatus(t('Todo borrado.{a}', { a: r.dirs_removed ? t(' Restos limpiados: {a}.', { a: humanBytes(r.bytes_freed) }) : '' }));
  } catch (e) {
    showError(e);
  }
}

// ---------- Ajustes: API keys de subtítulos ----------
/** Estado de la cuenta de OpenSubtitles.com: conectada (con su cuota), login fallido o sin cuenta. */
async function showOsLogin() {
  const q = await api.premiumQuota().catch(() => null);
  $('#os-login-state').textContent = !q?.has_login ? t('Sin cuenta: la cuota se sabe con la primera descarga.')
    : q.login_error ? t('No se pudo entrar: {login_error}', { login_error: q.login_error })
      : t('Cuenta conectada{a}.', { a: q.remaining != null ? t(' · quedan {remaining} de {per_day} descargas hoy', { remaining: q.remaining, per_day: q.per_day }) : '' });
}
/** Guarda usuario y contraseña (vacíos = borrar) y prueba entrar. */
export async function saveOsLogin() {
  const user = $input('#os-user'), pass = $input('#os-pass');
  try {
    await api.setOpensubtitlesLogin(user.value.trim(), pass.value);
    pass.value = '';
    await showOsLogin();
  } catch (e) { showError(e); }
}

/** Lat-Team: el toggle sigue a la fuente `latteam` y el estado al token guardado. */
/** @param {import('./types.js').ApiKeyStatus[]} keys */
async function showLatTeam(keys) {
  const addons = await api.catalogAddons();
  $input('#set-latteam-on').checked = addons.some((a) => a.id === 'latteam' && a.enabled);
  const has = keys.some((k) => k.service === 'latteam' && k.configured);
  $('#latteam-state').textContent = has ? t('✔ token guardado') : t('sin token');
  $('#latteam-state').className = `key-state ${has ? 'ok' : ''}`;
}
export async function toggleLatTeam() {
  try {
    await api.catalogSetAddonEnabled('latteam', $input('#set-latteam-on').checked);
  } catch (e) { showError(e); }
}
/** Guarda el token (vacío = lo borra). */
export async function saveLatTeamToken() {
  const input = $input('#key-latteam');
  try {
    await api.setApiKey('latteam', input.value.trim());
    input.value = '';
    await showLatTeam(await api.apiKeys());
    setStatus(t('Token de Lat-Team guardado en el almacén seguro.'));
  } catch (e) { showError(e); }
}

// ---------- Ajustes: TorBox de Streamonte (2026-11-21) ----------
/** Prendido: el código de acceso (la fila de la key propia no se ve). Apagado: la key propia, como antes. */
/** @param {boolean} shared @param {import('./types.js').ApiKeyStatus[]} keys */
function showTorboxShared(shared, keys) {
  const usable = keys.some((k) => k.service === 'torbox' && k.configured);
  $input('#set-torbox-shared').checked = shared;
  $('#torbox-code-line').hidden = !shared;
  $('#torbox-code-state').hidden = !shared;
  $('#torbox-code-state').textContent = usable ? t('✔ código guardado') : t('falta el código');
  $('#torbox-code-state').className = `key-state ${usable ? 'ok' : ''}`;
  const row = /** @type {HTMLElement} */ (document.querySelector('.key-row[data-service="torbox"]'));
  row.hidden = shared;
  if (shared) $('#set-catalog').insertBefore(row, $('#torbox-shared').nextSibling);
  else placeKey('torbox', usable);
}
export async function toggleTorboxShared() {
  try {
    await api.setTorboxShared($input('#set-torbox-shared').checked);
    $('#torbox-code-error').textContent = '';
    showTorboxShared($input('#set-torbox-shared').checked, await api.apiKeys());
    document.dispatchEvent(new CustomEvent('streamonte:torbox-key'));
  } catch (e) { showError(e); }
}
/** Guarda el código (3 dígitos; vacío = lo borra). Si la web lo rechaza, se borra y se vuelve a pedir acá. */
export async function saveTorboxCode() {
  const input = $input('#key-torbox-code');
  const code = input.value.trim();
  if (code && !/^\d{3}$/.test(code)) {
    $('#torbox-code-error').textContent = t('Son 3 dígitos.');
    return;
  }
  try {
    await api.setApiKey('streamonte-code', code);
    input.value = '';
    $('#torbox-code-error').textContent = '';
    showTorboxShared(true, await api.apiKeys());
    document.dispatchEvent(new CustomEvent('streamonte:torbox-key'));
    setStatus(code ? t('Código de Streamonte guardado.') : t('Código de Streamonte borrado.'));
  } catch (e) { showError(e); }
}
/** La web rechazó el código (`api.js`): Ajustes abierto en el campo, con el aviso. */
document.addEventListener('streamonte:torbox-code', async () => {
  if (!(/** @type {HTMLDialogElement} */ ($('#dlg-settings'))).open) await openSettings();
  $('#torbox-code-error').textContent = t('Código incorrecto');
  $input('#key-torbox-code').focus();
});

export async function openSettings() {
  try {
    showOsLogin();
    const keys = await api.apiKeys();
    const { engine, player, catalog } = await api.config();
    for (const k of keys) if (!(k.service === 'torbox' && catalog.torbox_shared)) placeKey(k.service, k.configured);
    showTorboxShared(catalog.torbox_shared, keys);
    await showLatTeam(keys);
    $input(`#set-eq-${player.equalizer}`).checked = true;
    await renderPlayers();
    $input('#set-incoming').checked = engine.incoming;
    $input('#set-upnp').checked = engine.upnp;
    $input('#set-upnp').disabled = !engine.incoming;
    $input('#set-announce').checked = engine.announce_early;
    $input('#set-announce').disabled = !engine.incoming;
  } catch (e) {
    showError(e);
  }
  /** @type {HTMLDialogElement} */ ($('#dlg-settings')).showModal();
}

/** Reproductores de esta compu (2026-11-17): mpv incluido (o el instalado) y VLC si está. Cuál usar se pregunta
 *  en cada ▶ (2026-11-20). Sin mpv que corra (macOS < 15 sin uno instalado) se recomienda instalarlo; mientras
 *  tanto se usa VLC si está. */
async function renderPlayers() {
  const p = await api.playersStatus();
  $('#set-vlc-note').textContent = p.vlc ? 'Sin subtítulos combinados ni ecualizador.' : 'No está instalado en esta compu.';
  $('#set-mpv-note').textContent = /** @type {Record<string, string>} */ ({ bundled: 'Incluido en la app. Recomendado: anda mejor y gasta menos.', installed: 'El que tenés instalado. Recomendado: anda mejor y gasta menos.',
    configured: 'El de la ruta que elegiste.' })[p.mpv ?? ''] ?? 'Esta compu no puede usar el que trae la app (pide macOS 15 o más nuevo).';
  $('#set-mpv-missing').hidden = !!p.mpv;
  $('#set-mpv-missing-text').textContent = p.vlc ? 'Mientras tanto se usa VLC. Te recomendamos instalar mpv: anda mejor y gasta menos.'
    : 'Sin mpv ni VLC no se puede reproducir. Instalá mpv (recomendado).';
  $('#btn-install-mpv').textContent = p.can_install_mpv ? 'Instalar mpv' : 'Cómo instalarlo';
}
/** Con Homebrew instala mpv (puede tardar unos minutos); si no, abre la guía de instalación. */
/** @param {Event} ev */
export async function installMpv(ev) {
  const btn = /** @type {HTMLButtonElement} */ (ev.currentTarget);
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
/** @param {Event} ev */
export async function saveEqualizer(ev) {
  try {
    await api.setEqualizer(/** @type {import('./types.js').Equalizer} */ (/** @type {HTMLInputElement} */ (ev.target).value));
    setStatus(t('Sonido guardado: rige desde la próxima reproducción.'));
  } catch (e) {
    showError(e);
  }
}

// ADR-30: entrantes / UPnP. El motor se crea por reproducción, así que aplica en la próxima.
export async function saveNetwork() {
  $input('#set-upnp').disabled = !$input('#set-incoming').checked;
  $input('#set-announce').disabled = !$input('#set-incoming').checked;
  try {
    await api.setNetwork($input('#set-incoming').checked, $input('#set-upnp').checked, $input('#set-announce').checked);
    setStatus(t('Red guardada: aplica desde la próxima reproducción.'));
  } catch (e) {
    showError(e);
  }
}

/** @type {Record<string, string>} */
const SERVICE_NAMES = { wyzie: 'Wyzie', opensubtitles: 'OpenSubtitles', tmdb: 'TMDB' };
/** Sección de cada key sin configurar (2026-11-17); configurada, baja a "Conectado". */
/** @type {Record<string, string>} */
const KEY_HOME = { tmdb: 'set-catalog', torbox: 'set-catalog', wyzie: 'set-subs', opensubtitles: 'set-subs' };

/** Pone la fila de la key donde corresponde según si está configurada, con su estado. */
/** @param {string} service @param {boolean} configured */
function placeKey(service, configured) {
  const row = document.querySelector(`.key-row[data-service="${service}"]`);
  const home = configured ? $('#set-connected') : document.getElementById(KEY_HOME[service]);
  if (!row || !home) return;
  const badge = /** @type {HTMLElement} */ (document.getElementById(`key-${service}-state`));
  badge.textContent = configured ? t('✔ conectada') : t('sin configurar');
  badge.className = `key-state ${configured ? 'ok' : ''}`;
  row.classList.remove('editing', 'saved');
  if (row.parentElement === home) return;
  // En su sección, antes de lo que no es key (las fuentes del catálogo).
  const before = !configured && home.querySelector(':scope > .set-line');
  if (before) before.before(row); else home.append(row);
}

/** "Cambiar" en una key conectada: abre el campo. */
/** @param {string} service */
export function toggleKeyEdit(service) {
  const row = document.querySelector(`.key-row[data-service="${service}"]`);
  if (row?.classList.toggle('editing')) /** @type {HTMLElement|null} */ (document.getElementById(`key-${service}`))?.focus();
}

const DONE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>';
/** @param {number} ms */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Guarda la key (vacía = la borra). Guardada (2026-11-17): un tilde que se dibuja y un mensaje, y
 *  después la fila baja a "Conectado". TMDB además avisa al catálogo, que se recarga con sus filtros. */
/** @param {string|undefined} service */
export async function saveKey(service) {
  if (!service) return;
  const input = /** @type {HTMLInputElement} */ (document.getElementById(`key-${service}`));
  const value = input.value.trim();
  const row = /** @type {HTMLElement} */ (input.closest('.key-row'));
  try {
    await api.setApiKey(service, value);
    input.value = '';
    if (service === 'tmdb') document.dispatchEvent(new CustomEvent('streamonte:tmdb-key'));
    if (service === 'torbox') document.dispatchEvent(new CustomEvent('streamonte:torbox-key'));
    if (!value) {
      placeKey(service, false);
      setStatus(t('Key de {a} borrada.', { a: SERVICE_NAMES[service] }));
      return;
    }
    const done = /** @type {HTMLElement} */ (row.querySelector('.key-done'));
    done.innerHTML = DONE_ICON;
    done.append(service === 'tmdb' ? t('¡TMDB conectada! El catálogo se recarga con filtros por votos, idioma y géneros.') : t('¡{a} conectada!', { a: SERVICE_NAMES[service] }));
    row.classList.add('saved');
    setStatus(t('Key de {a} guardada en el almacén seguro.', { a: SERVICE_NAMES[service] }));
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
/** @param {number} count */
export async function onConfirmClose(count) {
  if (closeAsking) return;
  closeAsking = true;
  const choice = await confirmDialog(
    t('Cerrar Streamonte'),
    t('Hay {count} reproducción(es) activa(s). En los dos casos la descarga queda pausada y guardada para retomarla al volver a abrir la app.', { count }),
    [
      { label: t('Cancelar'), value: null },
      { label: t('Dejar el reproductor abierto'), value: 'leave-running' },
      { label: t('Cerrar el reproductor y salir'), value: 'stop-all', primary: true },
    ],
  );
  closeAsking = false;
  if (choice) {
    setStatus(t('Cerrando…'));
    await api.onClose(choice).catch(showError);
  }
}

// ---------- Ajustes › Red: verificar el puerto entrante (2026-11-15) ----------
export async function onNetCheck() {
  const btn = $button('#btn-net-check');
  const out = $('#net-check-result');
  btn.disabled = true;
  out.className = 'net-check-result';
  out.textContent = t('Abriendo el puerto en el router y probando desde internet (hasta 30 s)…');
  try {
    const r = await api.checkIncoming();
    const ip = r.local_ip ? t(' · IP de esta PC: {local_ip}', { local_ip: r.local_ip }) : '';
    // Por qué está cerrado, según lo que respondió el router a UPnP (2026-11-16).
    const why = !r.upnp_on ? t('UPnP está apagado: abrilo a mano en el router (pasos de arriba)')
      : r.upnp === false ? t('el router rechazó abrirlo por UPnP. Suele ser porque otra PC de la casa ya tiene ese puerto, o el router lo bloquea')
        : r.upnp === true ? t('el router aceptó abrirlo, pero igual no llega: puede ser el firewall de esta PC o que tu proveedor comparta la IP pública (CGNAT)')
          : t('el router no respondió a UPnP (puede tenerlo apagado): activalo en el router o abrí el puerto a mano');
    out.className = `net-check-result ${r.reachable === true ? 'ok' : r.reachable === false ? 'bad' : ''}`;
    out.textContent = r.reachable === true ? t('Abierto: el puerto {port} llega desde internet{a}{ip}', { port: r.port, a: r.upnp ? t(' (lo abrió UPnP)') : '', ip })
      : r.reachable === false ? t('Cerrado: el puerto {port} no llega desde internet; {why}{ip}', { port: r.port, why, ip })
        : `${r.problem ?? t('No se pudo probar.')}${ip}`;
  } catch (e) {
    showError(e);
    out.textContent = '';
  } finally {
    btn.disabled = false;
  }
}
