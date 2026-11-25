// Arranque de la ventana principal. Imports estáticos: `main.ts` lo carga recién después del mock del navegador.
// El orden de abajo importa: los diálogos y el botón de velocidad se montan ANTES de `initApp` / `initCatalog`, que buscan
// elementos al arrancar (#dlg-log, #btn-sources, …). Ningún módulo hace trabajo al cargarse.
import { mount, unmount } from 'svelte';
import { apiContext } from '$ui/context.ts';
import { installTypeFx } from '$ui/components/type-fx.ts';
import { initApp } from './app.ts';
import { genreName } from './catalog-side.ts';
import { mountCatalog } from './catalog-mount.ts';
import { initCatalog } from './catalog.ts';
import Activity from './components/Activity.svelte';
import CopiedMagnet from './components/CopiedMagnet.svelte';
import Dialogs from './components/Dialogs.svelte';
import Downloads from './components/Downloads.svelte';
import SpeedButton from './components/SpeedButton.svelte';
import SpeedPanel from './components/SpeedPanel.svelte';
import Greeting from './Greeting.svelte';
import { showError } from './dom.ts';
import { langs, locale } from './i18n.ts';
import { provideApi } from './mount-shared.ts';
import { initNick } from './nick-state.svelte.ts';
import SidePanel from './SidePanel.svelte';
import { createDesktopApi } from './tauriApi.ts';
import { host as uiHost } from './ui-host.ts';
import Welcome from './Welcome.svelte';

export function startMain(): void {
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
  initApp().catch(showError);
  initCatalog().catch(showError); // crea #cat-side y #cat-root (sincrónico hasta su primer await): lo de abajo los busca
  // El único `Api` del desktop: se crea acá y llega a cada montaje por contexto (`mount-shared.ts`, `catalog-mount.ts`, panel lateral).
  const api = createDesktopApi(() => langs.titles);
  provideApi(api);
  initNick(api);
  mountCatalog(api);
  // Letras que entran desenfocadas al escribir, en todos los campos de texto.
  installTypeFx();
  // Panel lateral: la ficha compartida (`TitleView`) dentro de #cat-side, que crea catalog.ts.
  const sideHost = document.getElementById('cat-side');
  if (sideHost) {
    mount(SidePanel, { target: sideHost, context: apiContext(api), props: { locale: locale(), genreLabel: genreName } });
  }

  // Saludo con el apodo, entre la marca y los botones de la barra de arriba.
  const brand = document.querySelector('.topbar .brand');
  if (brand) {
    const helloHost = document.createElement('div');
    helloHost.style.display = 'contents';
    brand.after(helloHost);
    mount(Greeting, { target: helloHost });
  }

  const host = document.createElement('div');
  host.id = 'svelte-root';
  document.body.append(host);
  mount(Welcome, { target: host });
  mount(CopiedMagnet, { target: document.getElementById('top-copied-host') ?? host });
  mount(Downloads, { target: document.getElementById('top-downloads-host') ?? host });
  mount(Activity, { target: document.querySelector('.statusbar') ?? host });
}
