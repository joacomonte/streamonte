// Entrada de Vite: CSS, el mock del navegador y el arranque (`boot.ts`, con imports estáticos).
import { mount } from 'svelte';
// CSS compartido (tokens → base → componentes) y luego el de las pantallas del desktop.
import '../../packages/ui/css/tokens.css';
import '../../packages/ui/css/base.css';
import '../../packages/ui/css/components.css';
import '../styles.css';
import '../catalog.css';
import '../../packages/ui/css/options.css';
import '../../packages/ui/css/settings.css';

// El mock (solo sin Tauri) tiene que estar antes que cualquier módulo que llame al núcleo (`i18n.ts` lee la config al cargar):
// por eso `boot.ts` (con todos los imports estáticos) se importa después, no arriba.
if (!('__TAURI__' in window)) await import('./mock-tauri');
// Ventana aparte de Actividad (`open_logs_window`, `?logs`): solo el panel, sin el catálogo ni app.js.
const logsOnly = new URLSearchParams(location.search).has('logs');
if (logsOnly) {
  document.body.replaceChildren();
  const { default: Activity } = await import('./components/Activity.svelte');
  const { startLive } = await import('./live.svelte.ts');
  mount(Activity, { target: document.body, props: { detached: true } });
  await startLive(() => {});
}
if (!logsOnly) await (await import('./boot.ts')).startMain();

