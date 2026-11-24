// Entrada de Vite: el JS viejo se carga igual que antes (efectos de módulo) y se monta una isla Svelte aparte.
import { mount, unmount } from 'svelte';
// CSS compartido (tokens → base → componentes) y luego el de las pantallas del desktop.
import '../../packages/ui/css/tokens.css';
import '../../packages/ui/css/base.css';
import '../../packages/ui/css/components.css';
import '../styles.css';
import '../catalog.css';
import '../../packages/ui/css/options.css';
import '../../packages/ui/css/settings.css';

// El mock (solo sin Tauri) tiene que estar antes que app.js; los import estáticos se evalúan primero, por eso son dinámicos.
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
if (!logsOnly) await startMain();

async function startMain(): Promise<void> {
  // Diálogos y botón de velocidad antes de app.js/catalog.js: ellos buscan estos elementos al arrancar (#dlg-log, #btn-sources, #set-lang-picker…).
  const { default: Dialogs } = await import('./components/Dialogs.svelte');
  const { default: SpeedButton } = await import('./components/SpeedButton.svelte');
  const { default: SpeedPanel } = await import('./components/SpeedPanel.svelte');
  const { host: uiHost } = await import('./ui-host.ts');
  const dialogsHost = document.createElement('div');
  document.body.append(dialogsHost);
  mount(Dialogs, { target: dialogsHost });
  const speedBtn = document.getElementById('btn-speed');
  if (speedBtn) mount(SpeedButton, { target: speedBtn, props: { host: speedBtn } });
  // shortcut: el panel anterior queda montado (en un popover ya vaciado) hasta la próxima apertura; es uno solo.
  let speedPanel: ReturnType<typeof mount> | null = null;
  uiHost.showSpeedPanel = (pop) => {
    if (speedPanel) void unmount(speedPanel);
    pop.replaceChildren();
    speedPanel = mount(SpeedPanel, { target: pop });
  };
  await import('./app.js');
  await import('./catalog.js');
  // El único `Api` del desktop: se crea acá y llega a cada montaje por contexto (`mount-shared.ts`, `catalog-mount.ts`, panel lateral).
  const { langs, locale } = await import('./i18n.js');
  const { createDesktopApi } = await import('./tauriApi.ts');
  const { apiContext } = await import('$ui/context.ts');
  const { provideApi } = await import('./mount-shared.ts');
  const api = await createDesktopApi(() => langs.titles);
  provideApi(api);
  (await import('./catalog-mount.ts')).mountCatalog(api);
  // Letras que entran desenfocadas al escribir, en todos los campos de texto.
  (await import('$ui/components/type-fx.ts')).installTypeFx();
  // Panel lateral: la ficha compartida (`TitleView`) dentro de #cat-side, que crea catalog.js.
  const { genreName } = await import('./catalog-side.js');
  const { default: SidePanel } = await import('./SidePanel.svelte');
  const sideHost = document.getElementById('cat-side');
  if (sideHost) {
    mount(SidePanel, { target: sideHost, context: apiContext(api), props: { locale: locale(), genreLabel: genreName } });
  }
  const { default: Welcome } = await import('./Welcome.svelte');
  const { default: SettingsLang } = await import('./SettingsLang.svelte');
  const { default: CopiedMagnet } = await import('./components/CopiedMagnet.svelte');
  const { default: Downloads } = await import('./components/Downloads.svelte');
  const { default: Activity } = await import('./components/Activity.svelte');

  const host = document.createElement('div');
  host.id = 'svelte-root';
  document.body.append(host);
  mount(SettingsLang, { target: document.getElementById('set-lang-picker') ?? host });
  mount(Welcome, { target: host });
  mount(CopiedMagnet, { target: document.getElementById('top-copied-host') ?? host });
  mount(Downloads, { target: document.getElementById('top-downloads-host') ?? host });
  mount(Activity, { target: document.querySelector('.statusbar') ?? host });
}
