// Texto de estado de una reproducción (menú Descargas y la card del catálogo). El resto de los formatos (bytes, Mbps,
// relojes, "hace…", estreno en cine) vive en packages/ui/src/format.ts.
import { t } from './i18n.ts';
import type { PlaybackRow } from './types.ts';

/** Estado de una reproducción en palabras. */
export function playbackText(pb: PlaybackRow): string {
  const k = pb.state.kind;
  if (k === 'fetching-metadata') return t('cargando…');
  if (k === 'preparing') return t('cargando {a} %', { a: Math.round((pb.state.fraction ?? 0) * 100) });
  if (k === 'stopping') return t('cerrando…');
  if (k === 'download-paused') return t('reproduciendo · descarga en pausa');
  if (k === 'ask-after-close') return t('cerraste el reproductor…');
  if (k === 'background') return t('descargando · {a} %', { a: Math.floor((pb.progress ?? 0) * 100) });
  if (k === 'paused') return t('pausado · {a} % bajado', { a: Math.floor((pb.progress ?? 0) * 100) });
  if (k === 'failed') return t('falló: {message}', { message: pb.state.message });
  return t('reproduciendo');
}
