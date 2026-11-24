// Autoactualización desde GitHub Releases (tauri-plugin-updater, como monti-git). Al arrancar y cada 6 h se
// pregunta si hay versión nueva; si la hay, un aviso discreto abajo a la izquierda con las notas de la versión y
// "Actualizar y reiniciar". Nada se instala sin que el usuario lo pida.
import { el } from './dom.ts';
import { t } from './i18n.ts';
import { showUpdating } from './mount-updating.svelte.ts';

const RECHECK_MS = 6 * 60 * 60 * 1000;

async function checkForUpdate(): Promise<void> {
  const { updater, process } = window.__TAURI__;
  // Ya hay un aviso abierto (de una vuelta anterior): no se apila otro.
  if (document.getElementById('update-notice')) return;
  // Sin red, sin release todavía o en desarrollo: se sigue sin aviso.
  const update = await updater.check({ timeout: 4000 }).catch((e) => { console.warn('update check failed:', e); return null; });
  if (!update) return;
  const button = el('button', { id: 'btn-update-install', class: 'small' }, t('Actualizar y reiniciar'));
  const close = el('button', { id: 'btn-update-dismiss', class: 'small', 'aria-label': t('Cerrar aviso') }, '✕');
  const notice = el('div', {
    id: 'update-notice', role: 'status',
    style: 'position:fixed;left:16px;bottom:44px;z-index:50;display:flex;gap:8px;align-items:center;padding:8px 10px;' +
      'background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;box-shadow:0 4px 16px #0003',
  }, t('Versión {version} disponible', { version: update.version }), update.body ? el('span', { id: 'update-notes', style: 'max-width:320px;white-space:pre-line;opacity:.8' }, update.body) : null, button, close);
  close.addEventListener('click', () => notice.remove());
  button.addEventListener('click', async () => {
    button.disabled = close.disabled = true;
    button.textContent = t('Actualizando…');
    const screen = showUpdating(t('Bajando la versión {version}…', { version: update.version }));
    let total = 0, got = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') { got += ev.data.chunkLength; if (total) screen.set(t('Bajando la versión {version}…', { version: update.version }), got / total); }
        else screen.set(t('Instalando…'), null);
      });
      screen.set(t('Reiniciando…'), null);
      await process.relaunch();
    } catch (e) {
      screen.close();
      console.warn('update install failed:', e);
      button.textContent = t('Falló, reintentar');
      button.disabled = close.disabled = false;
    }
  });
  document.body.append(notice);
}

/** Chequea al iniciar y cada 6 h (lo llama `initApp`). */
export function startUpdater(): void {
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), RECHECK_MS);
}
