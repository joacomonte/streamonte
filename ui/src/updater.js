// @ts-check
// Autoactualización desde GitHub Releases (tauri-plugin-updater, como monti-git). Al arrancar se
// pregunta si hay versión nueva; si la hay, un aviso discreto abajo a la izquierda con
// "Actualizar y reiniciar". Nada se instala sin que el usuario lo pida.
import { el } from './dom.js';
import { t } from './i18n.js';

const { updater, process } = window.__TAURI__;

async function checkForUpdate() {
  // Sin red, sin release todavía o en desarrollo: se sigue sin aviso.
  const update = await updater.check({ timeout: 4000 }).catch((e) => { console.warn('update check failed:', e); return null; });
  if (!update) return;
  const button = el('button', { id: 'btn-update-install', class: 'small' }, t('Actualizar y reiniciar'));
  const close = el('button', { id: 'btn-update-dismiss', class: 'small', 'aria-label': t('Cerrar aviso') }, '✕');
  const notice = el('div', {
    id: 'update-notice', role: 'status',
    style: 'position:fixed;left:16px;bottom:44px;z-index:50;display:flex;gap:8px;align-items:center;padding:8px 10px;' +
      'background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;box-shadow:0 4px 16px #0003',
  }, t('Versión {version} disponible', { version: update.version }), button, close);
  close.addEventListener('click', () => notice.remove());
  button.addEventListener('click', async () => {
    button.disabled = close.disabled = true;
    button.textContent = t('Actualizando…');
    try {
      await update.downloadAndInstall();
      await process.relaunch();
    } catch (e) {
      console.warn('update install failed:', e);
      button.textContent = t('Falló, reintentar');
      button.disabled = close.disabled = false;
    }
  });
  document.body.append(notice);
}

checkForUpdate();
