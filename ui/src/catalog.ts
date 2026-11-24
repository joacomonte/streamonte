// Lo que queda del catálogo del desktop en JS: el panel lateral y las opciones cuelgan de acá (la grilla, los filtros y el
// buscador son el catálogo compartido `packages/ui/src/catalog/`, que monta `catalog-mount.ts`). Este módulo conserva
// "Pegados", "Fuentes", los atajos, la biblioteca y el despacho de eventos del núcleo hacia las opciones/pruebas/subtítulos.
// Todo texto que viene de Cinemeta o de los addons entra como texto, nunca como HTML (NFR-24).

import * as core from './core.ts';
import { play } from './audio-picker.ts';
import { openSettings } from './dialog-flows.ts';
import { $, el, icon, setStatus } from './dom.ts';
import { humanBytes } from '$ui/format.ts';
import { playbackText } from './format.ts';
import { t } from './i18n.ts';
import { bgText, cardSig, measurePlayback, onPlaybackRow, onStreams, renderStreamsOnly, starting } from './catalog-options.ts';
import { magnetHash, openMagnet } from './catalog-magnet.ts';
import { subsProgress } from './catalog-subs.ts';
import { closeSide, renderSide } from './catalog-side.ts';
import { showError, state, view, type PickedPerson } from './catalog-state.ts';
import { onSwarmEvent } from './catalog-tests.ts';
import type { CatalogStore } from '../../packages/ui/src/catalog/store.ts';
import type { CoreEvent, LibraryRow } from './types.ts';


/** Mensaje de un rechazo del núcleo (`UiError`) o de cualquier otro error. */
const errText = (e: unknown): string => t((e as { message?: string } | null | undefined)?.message ?? String(e));
export const reduceMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** El catálogo compartido (lo fija `catalog-mount.ts`). */
let store: CatalogStore | null = null;
export function attachStore(s: CatalogStore): void { store = s; }
/** Elegido un actor o director desde el panel: el catálogo muestra lo que actuó o dirigió. */
export const pickPerson = (p: PickedPerson): void => store?.pickPerson(p);

/** Magnet pegado en el buscador: se agrega a Pegados; con TorBox, además se abre lo que TorBox sabe de él. */
export async function pasteMagnet(raw: string): Promise<void> {
  try {
    await core.addSelected([raw]);
    setStatus(t('Magnet pegado: queda en Pegados.'));
    const hash = magnetHash(raw);
    if (hash && view.torboxKey) openMagnet(hash, new URLSearchParams(raw.split('?')[1] ?? '').get('dn') ?? '');
  } catch (e) { showError(e); }
}

/** Abre Ajustes en la key de TMDB. */
export async function askTmdbKey(): Promise<void> {
  await openSettings();
  const input = $('#key-tmdb');
  input?.scrollIntoView({ block: 'center' });
  input?.focus();
}
/** Cambió la key de TMDB en Ajustes (2026-11-17): la lista se vuelve a pedir ya (con o sin sus filtros) y, si hay un
 *  título abierto, sus datos de TMDB. */
document.addEventListener('streamonte:tmdb-key', () => {
  core.forgetTitles();
  store?.relang();
  const s = state.side;
  if (s) {
    s.similar = undefined;
    core.catalogDetails(s.kind, s.id).then((d) => { if (state.side === s) { s.details = d; renderSide(); } }).catch(() => {});
  }
});

// ---------- Fuentes (FR-41) ----------
async function openSources(): Promise<void> {
  let dlg = $<HTMLDialogElement>('#dlg-sources');
  if (!dlg) {
    dlg = el('dialog', { id: 'dlg-sources', class: 'dialog wide' });
    document.body.append(dlg);
  }
  const addons = await core.catalogAddons().catch((e) => { showError(e); return []; });
  const input = el('input', { id: 'cat-add-url', type: 'text', placeholder: t('Pegá la URL del manifest (https://…/manifest.json)'), class: 'cat-add-url' });
  const msg = el('p', { class: 'hint' });
  const refresh = () => openSources();
  dlg.replaceChildren(
    el('h3', {}, t('Fuentes de torrents')),
    el('p', { class: 'hint' }, t('Addons de Stremio que se consultan al abrir una película o episodio. La app no indexa contenido: solo junta lo que devuelven. En P2P tu IP es visible para los demás del torrent.')),
    el('ul', { class: 'cat-sources' }, addons.map((a) => el('li', {},
      el('label', {}, el('input', { id: `cat-addon-${a.id}`, type: 'checkbox', checked: a.enabled, onchange: (ev) => core.catalogSetAddonEnabled(a.id, ev.target.checked).catch(showError) }), ` ${a.name}`),
      el('span', { class: 'hint cat-url' }, a.display_url),
      a.own ? null : el('button', { id: `cat-addon-rm-${a.id}`, class: 'small danger', onclick: () => core.catalogRemoveAddon(a.id).then(refresh, showError) }, t('Quitar'))))),
    el('div', { class: 'key-line' }, input,
      el('button', { id: 'cat-add-addon', onclick: async () => {
        msg.textContent = t('Validando…');
        try {
          const a = await core.catalogAddAddon(input.value);
          setStatus(t('{n} ✓ agregado.', { n: a.name }));
          refresh();
        } catch (e) { msg.textContent = errText(e); }
      } }, t('Agregar'))),
    msg,
    el('div', { class: 'dialog-actions' },
      el('button', { id: 'cat-sources-reset', onclick: () => core.catalogResetAddons().then(refresh, showError) }, t('Restaurar lista por defecto')),
      el('button', { id: 'cat-sources-close', onclick: () => dlg.close() }, t('Cerrar'))),
  );
  if (!dlg.open) dlg.showModal();
}

// ---------- Pegados ----------
/** Magnets pegados (portapapeles o buscador; sin ficha del catálogo), arriba de todo (2026-11-15: reemplaza a "Mis
 *  magnets"). Lo más nuevo primero. Con key de TorBox, cada uno abre lo que TorBox sabe de él (2026-11-20). */
function pastedSection(): HTMLElement | null {
  const rows = [...state.library.values()].filter((e) => !e.origin)
    .sort((a, b) => String(b.added_at ?? '').localeCompare(String(a.added_at ?? '')));
  if (!rows.length) return null;
  const name = (e: LibraryRow): string => {
    const r = e.release;
    const ep = r?.season != null && r?.episode != null ? ` T${r.season}·E${r.episode}` : '';
    return r?.title ? `${r.title}${ep}` : e.torrent_name || e.name;
  };
  return el('section', { id: 'cat-pasted', class: 'cat-pasted', 'aria-label': t('Pegados') },
    el('h3', {}, t('Pegados')),
    el('ul', {}, rows.map((e) => el('li', { class: 'surface cat-pasted-row' },
      el('span', { class: 'cat-pasted-name', title: e.torrent_name || e.name }, name(e)),
      e.video_size ? el('span', { class: 'cat-pasted-size' }, humanBytes(e.video_size)) : null,
      view.torboxKey ? el('button', { id: `cat-pasted-torbox-${e.key}`, class: 'cat-icon-btn', title: t('Ver en TorBox: si lo tiene, al instante; si no, bajarlo en sus servidores'), 'aria-label': t('Ver en TorBox'),
        onclick: () => openMagnet(e.info_hash, e.torrent_name || e.name) }, icon('cloud', 16)) : null,
      el('button', { id: `cat-pasted-rm-${e.key}`, class: 'cat-icon-btn', title: t('Quitar de Pegados'), 'aria-label': t('Quitar'), onclick: () => core.remove(e.key).catch(showError) }, '✕'),
      el('button', { id: `cat-pasted-play-${e.key}`, class: 'cat-icon-btn primary', title: t('Reproducir'), 'aria-label': t('Reproducir'), onclick: (ev) => play(e.key, ev.currentTarget, e) }, icon('play', 16))))));
}
/** Dónde va "Pegados": un div que monta el catálogo compartido arriba de la grilla (null mientras se busca). */
let pastedHost: HTMLElement | null = null;
export function setPastedHost(node: HTMLElement | null): void { pastedHost = node; refreshPasted(); }
/** Redibuja la sección de pegados (llega una fila nueva, se quita una o se sabe si hay key de TorBox). */
export function refreshPasted(): void { pastedHost?.replaceChildren(...[pastedSection()].filter((n) => n !== null)); }

/** Arranque del catálogo: lo llama `main.ts` después de montar los diálogos (busca `#catalog` y `#btn-sources`). */
export async function initCatalog(): Promise<void> {
  // La grilla, el buscador y los filtros los monta `catalog-mount.ts` (catálogo compartido) en #cat-root.
  $('#catalog').append(
    el('div', { class: 'cat-main' }, el('div', { id: 'cat-root' })),
    el('aside', { id: 'cat-side', class: 'cat-side', 'aria-label': t('Opciones') }));
  $('#btn-sources').addEventListener('click', openSources); // en Ajustes (2026-11-15)
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key.toLowerCase() === 'f') { ev.preventDefault(); $('#cat-q').focus(); }
    // Esc cierra el panel, salvo que esté abierto un diálogo o el selector de audio (cierran ellos).
    if (ev.key === 'Escape' && state.side
      && !document.querySelector('dialog[open]') && !document.querySelector('#pk.on')) closeSide();
  });
  try {
    const cfg = await core.config();
    // Anime siempre oculto (se sacó el toggle, 2026-11-15); si estaba apagado, se vuelve a prender.
    if (cfg.catalog?.exclude_japanese === false) core.catalogSetExcludeJapanese(true).catch(showError);
    const lib = await core.library();
    for (const e of [...lib.pasted_now, ...lib.previous]) state.library.set(e.key, e);
  } catch (e) { showError(e); }
  refreshPasted();
  // Reproducciones (2026-11-16): se dibujan con lo que app.js ya guardó en `lib.playbacks` (avisa con
  // `playback-changed` después de guardar). Oír el evento del núcleo directo dibujaba a veces con la
  // fila vieja ("preparando 0 %" reproduciendo, o una pausada ya borrada): el orden entre oyentes
  // no está garantizado.
  window.addEventListener('playback-changed', (ev) => {
    // app.js lo manda con el evento del núcleo ya guardado en `detail`.
    const event = (ev as CustomEvent<Extract<CoreEvent, { type: 'playback-updated' | 'playback-removed' }>>).detail;
    if (event.type === 'playback-removed') { if (state.update) renderStreamsOnly(); return; }
    const n = starting.size;
    onPlaybackRow(event.row);
    measurePlayback(event.row);
    // Redibuja si cambió lo que muestra la card de esa opción (llega una fila por segundo
    // mientras reproduce y casi siempre dice lo mismo, 2026-11-15).
    const hash = event.row.key.split(':')[0];
    const c = state.update?.candidates.find((x) => x.info_hash === hash);
    const sig = c ? `${playbackText(event.row)}|${bgText(c)?.text ?? ''}` : null;
    const changed = c && cardSig.get(hash) !== sig;
    if (c) cardSig.set(hash, sig);
    if (state.update && (starting.size !== n || changed)) renderStreamsOnly();
  });
  await core.onCoreEvent((event) => {
    switch (event.type) {
      case 'catalog-streams': onStreams(event.update); break;
      case 'catalog-swarm-progress':
      case 'catalog-swarm-counted': onSwarmEvent(event); break;
      case 'catalog-subtitles-progress':
        subsProgress.set(event.video_id, event);
        if (event.video_id === state.side?.videoId) renderStreamsOnly();
        break;
      case 'library-entry-updated':
        state.library.set(event.entry.key, event.entry);
        if (!event.entry.origin) refreshPasted();
        if (state.update?.candidates.some((c) => c.info_hash === event.entry.info_hash)) renderStreamsOnly();
        break;
      case 'library-entry-removed':
        state.library.delete(event.key);
        refreshPasted();
        if (state.update) renderStreamsOnly();
        break;
      default: break;
    }
  });
}

