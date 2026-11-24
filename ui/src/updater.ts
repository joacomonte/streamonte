// Autoactualización desde GitHub Releases (tauri-plugin-updater, como monti-git). Al arrancar y cada 6 h se
// pregunta si hay versión nueva; si la hay, un aviso discreto abajo (`UpdateBar` compartido) con las notas de la versión y
// "Actualizar y reiniciar". Nada se instala sin que el usuario lo pida.
import { t } from './i18n.ts';
import { showUpdateBar, showUpdating } from './mount-updating.svelte.ts';

const RECHECK_MS = 6 * 60 * 60 * 1000;

async function checkForUpdate(): Promise<void> {
  const { updater, process } = window.__TAURI__;
  // Ya hay un aviso abierto (de una vuelta anterior): no se apila otro.
  if (document.getElementById('update-bar')) return;
  // Sin red, sin release todavía o en desarrollo: se sigue sin aviso.
  const update = await updater.check({ timeout: 4000 }).catch((e) => { console.warn('update check failed:', e); return null; });
  if (!update) return;
  const bar = showUpdateBar({
    text: t('Versión {version} disponible', { version: update.version }),
    notes: update.body ?? undefined,
    actionLabel: t('Actualizar y reiniciar'),
    onaction: async () => {
      bar.setAction(t('Actualizando…'), true);
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
        bar.setAction(t('Falló, reintentar'), false);
      }
    },
  });
}

/** Chequea al iniciar y cada 6 h (lo llama `initApp`). */
export function startUpdater(): void {
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), RECHECK_MS);
}
