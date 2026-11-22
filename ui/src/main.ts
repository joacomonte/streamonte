// Entrada de Vite: el JS viejo se carga igual que antes (efectos de módulo) y se monta una isla Svelte aparte.
import { mount, unmount } from 'svelte';
// CSS compartido (tokens → base → componentes) y luego el de las pantallas del desktop.
import '../../packages/ui/css/tokens.css';
import '../../packages/ui/css/base.css';
import '../../packages/ui/css/components.css';
import '../styles.css';
import '../catalog.css';

// El mock (solo sin Tauri) tiene que estar antes que app.js; los import estáticos se evalúan primero, por eso son dinámicos.
if (!('__TAURI__' in window)) await import('./mock-tauri');
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
await (await import('./catalog-mount.ts')).mountCatalog();
// Panel lateral: la ficha compartida (`TitleView`) dentro de #cat-side, que crea catalog.js.
const { createDesktopApi } = await import('./tauriApi.ts');
const { apiContext } = await import('$ui/context.ts');
const { langs, locale } = await import('./i18n.js');
const { genreName } = await import('./catalog-side.js');
const { default: SidePanel } = await import('./SidePanel.svelte');
const sideHost = document.getElementById('cat-side');
if (sideHost) {
  const api = await createDesktopApi(() => (langs.app === 'en' ? 'en' : 'es'));
  mount(SidePanel, { target: sideHost, context: apiContext(api), props: { locale: locale(), genreLabel: genreName } });
}
const { default: Island } = await import('./Island.svelte'); // mismo orden de evaluación que antes (evita ciclos)
const { default: Welcome } = await import('./Welcome.svelte');
const { default: SettingsLang } = await import('./SettingsLang.svelte');
const { default: CopiedMagnet } = await import('./components/CopiedMagnet.svelte');
const { default: Downloads } = await import('./components/Downloads.svelte');
const { default: Activity } = await import('./components/Activity.svelte');

const host = document.createElement('div');
host.id = 'svelte-root';
document.body.append(host);
mount(Island, { target: host });
mount(SettingsLang, { target: document.getElementById('set-lang-picker') ?? host });
mount(Welcome, { target: host });
mount(CopiedMagnet, { target: document.getElementById('top-copied-host') ?? host });
mount(Downloads, { target: document.getElementById('top-downloads-host') ?? host });
mount(Activity, { target: document.querySelector('.statusbar') ?? host });
