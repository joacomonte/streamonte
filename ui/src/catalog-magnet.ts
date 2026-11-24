// "Pegar magnet" con TorBox (2026-11-20, como la web): el torrent pegado (Pegados o el buscador). Si TorBox lo tiene,
// sus videos; si no, "Bajarlo en TorBox" con el avance en vivo. Arriba, la película o serie si se reconoce por el
// nombre (TMDB), con "Ver ficha". Reproducir sigue siendo el ▶ de Pegados (por torrent).
// La vista es `MagnetView` de packages/ui (la misma que la ruta /m/<hash> de la web); acá solo el diálogo que la contiene.
import { $, el } from './dom.ts';
import { t } from './i18n.ts';
import { magnetHash } from '$ui/magnet-hash.ts';
import { mountMagnet } from './mount-shared.ts';
import type { Identified } from '../../packages/ui/src/types.ts';
import { openSide } from './catalog-side.ts';

export { magnetHash };

/** Desmonta la vista abierta (al cerrar el diálogo o abrir otro magnet). */
let unmountView: (() => void) | null = null;

export function openMagnet(hash: string, name: string): void {
  let dlg = $<HTMLDialogElement>('#dlg-magnet');
  if (!dlg) {
    dlg = el('dialog', { id: 'dlg-magnet', class: 'dialog magnet', onclose: () => { unmountView?.(); unmountView = null; } });
    document.body.append(dlg);
  }
  unmountView?.();
  const view = el('div', { class: 'mag-view' });
  dlg.replaceChildren(view, el('div', { class: 'dialog-actions' }, el('button', { id: 'mag-close', type: 'button', onclick: () => dlg.close() }, t('Cerrar'))));
  unmountView = mountMagnet(view, {
    hash, name,
    onTitle: (ident: Identified) => { dlg.close(); openSide(ident.kind === 'tv' ? 'series' : 'movie', ident.id, ident.title); }
  });
  if (!dlg.open) dlg.showModal();
}
