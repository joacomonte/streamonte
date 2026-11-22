// @ts-check
// Qué se cuenta en la burbuja de actividad (ui/src/activity.js es el widget): eventos del núcleo →
// líneas del log, y el resumen de lo que corre de fondo para su píldora.
import { activity } from './activity.js';
import { t as tr } from './i18n.js';
import { clock, humanBytes, mb, nf } from './format.js';
import { fullName, state, titleOf } from './state.js';

/** @type {Record<string, string>} */
const PHASE_TEXT = { connecting: 'conectando', metadata: 'buscando metadatos', preload: 'precargando' };

/** Resumen de lo que corre de fondo para la píldora de la burbuja de actividad. */
export function renderActivity() {
  const title = titleOf;
  const parts = [];
  for (const r of state.playbacks.values()) {
    const k = r.state.kind;
    if (k === 'fetching-metadata' || k === 'preparing') parts.push(tr('Preparando {a}{b}', { a: title(r.key), b: k === 'preparing' ? ` ${Math.round((r.state.fraction ?? 0) * 100)} %` : '' }));
    else if (k === 'playing' && r.progress < 0.999) parts.push(tr('Bajando {a} · {b} %', { a: title(r.key), b: Math.floor(r.progress * 100) }));
    else if (k === 'background') parts.push(tr('Bajando {a} de fondo · {b} %', { a: title(r.key), b: Math.floor(r.progress * 100) }));
    else if (k === 'stopping') parts.push(tr('Cerrando {a}', { a: title(r.key) }));
  }
  const s = state.analyzerState;
  const pending = state.pending;
  if (s.kind === 'scraping') parts.push(tr('Consultando trackers'));
  else if (s.kind === 'quick-scan') parts.push(tr('Leyendo datos de {total}', { total: s.total }));
  else if (s.kind === 'measuring' && s.current) parts.push(tr('Midiendo {a}', { a: title(s.current) }));
  else if (pending.size) parts.push(tr('Preparando {a}', { a: pending.size === 1 ? titleOf([...pending.keys()][0]) : tr('{size} análisis', { size: pending.size }) }));
  const waiting = state.queued.filter((h) => !(s.kind === 'measuring' && s.current === h)).length;
  if (waiting && s.kind !== 'paused') parts.push(tr('{waiting} en cola', { waiting }));
  activity.setBusy(parts.join(' · '));
}

/** Eventos del núcleo → líneas de la burbuja. Se llama ANTES de actualizar el estado, para
 *  comparar con lo anterior y contar solo los cambios (no cada tic). */
/** @param {import('./types.js').CoreEvent} ev */
export function logEvent(ev) {
  /** @param {string} area @param {string} text @param {{level?: 'info'|'warn'|'error', key?: string, at?: Date, announce?: boolean}=} more */
  const A = (area, text, more = {}) => activity.push({ area, text, ...more });
  switch (ev.type) {
    case 'activity':
      A(ev.area, ev.message, { level: ev.level, at: new Date(ev.at) });
      break;
    case 'status':
      A('general', ev.message, { level: ev.level });
      break;
    case 'clipboard-history-unavailable':
      A('portapapeles', tr('El historial del portapapeles (Win+V) está apagado: solo se ve lo último copiado.'), { level: 'warn' });
      break;
    case 'analyzer-progress': {
      const s = ev.state;
      const p = state.analyzerState;
      if (s.kind === 'scraping' && p.kind !== 'scraping') A('analisis', tr('Consultando trackers de {total} magnet(s)', { total: s.total }));
      else if (s.kind === 'quick-scan' && p.kind !== 'quick-scan') A('analisis', tr('Leyendo datos rápidos de {total}: nombre, duración, audios, seeds', { total: s.total }));
      else if (s.kind === 'measuring' && s.current) {
        if (p.kind !== 'measuring' || p.current !== s.current) A('analisis', tr('Midiendo la velocidad de {a} ({b} de {total})', { a: titleOf(s.current), b: s.done + 1, total: s.total }), { announce: true });
        if (s.live) {
          const ph = s.live.phase;
          const txt = ph in PHASE_TEXT ? tr('preparando · {a}', { a: PHASE_TEXT[ph] })
            : ph === 'probing' ? tr('{a} Mbps · leyendo duración y audios', { a: mb(s.live.speed_bps) })
              : tr('{a} Mbps · {b} s · {peers} peers{c}', { a: mb(s.live.speed_bps), b: Math.round(s.live.secs), peers: s.live.peers, c: s.live.stable ? tr(' · ya estable') : '' });
          A('analisis', `${titleOf(s.current)}: ${txt}`, { key: `spd:${s.current}` });
        }
      } else if (s.kind === 'paused' && p.kind !== 'paused') A('analisis', tr('Análisis en pausa'));
      else if (s.kind === 'idle' && !['idle', 'paused'].includes(p.kind)) A('analisis', tr('Análisis terminado: la lista quedó ordenada de mejor a peor'), { announce: true });
      break;
    }
    case 'analyzer-queue':
      if (ev.queued.length && ev.queued.length !== state.queued.length) A('analisis', tr('{n} en cola para analizar', { n: ev.queued.length }), { key: 'queue' });
      for (const hsh of ev.held) if (!state.held.has(hsh)) A('analisis', tr('Pausado el análisis de {a}', { a: titleOf(hsh) }));
      break;
    case 'library-entry-updated': {
      const e = ev.entry;
      const old = state.entries.get(e.key);
      const t = e.release?.title || fullName(e);
      if (!old) { A('portapapeles', tr('Agregado: {t}', { t })); break; }
      if (!old.torrent_name && e.torrent_name) A('motor', tr('Metadatos de {t}: {torrent_name}', { t, torrent_name: e.torrent_name }));
      if (!old.live && e.live) {
        const size = e.video_size ?? e.live.file_size;
        A('analisis', tr('Datos leídos de {t}: {a}{b}{c}', { t, a: size ? humanBytes(size) : '', b: e.live.duration_secs ? ` · ${clock(e.live.duration_secs)}` : '', c: e.languages?.length ? ` · ${e.languages.map((l) => l.short).join('/')}` : '' }));
      }
      if (e.live && e.live.avg_speed_bps > 0 && e.live.avg_speed_bps !== old.live?.avg_speed_bps) {
        A('analisis', tr('{t}: {a} Mbps reales{b}', { t, a: mb(e.live.avg_speed_bps), b: e.score?.margin != null ? ` (${nf(e.score.margin)}×)` : '' }), { announce: true });
      }
      if (e.status?.kind === 'failed' && old.status?.kind !== 'failed') A('analisis', tr('Falló el análisis de {t}: {a}', { t, a: e.status.reason ?? tr('sin detalle') }), { level: 'error' });
      break;
    }
    case 'library-entry-removed':
      A('general', tr('Quitado de la lista: {a}', { a: titleOf(ev.key) }));
      break;
    case 'playback-updated': {
      const r = ev.row;
      const k = r.state.kind;
      const old = state.playbacks.get(r.id);
      const t = titleOf(r.key);
      if (old?.state.kind !== k || k === 'preparing') {
        const text = {
          'fetching-metadata': tr('Buscando metadatos de {t}', { t }),
          preparing: tr('Preparando {t}: {a} % (principio y final del video)', { t, a: Math.round((r.state.fraction ?? 0) * 100) }),
          playing: tr('Reproduciendo {t} en mpv', { t }),
          'download-paused': tr('Descarga de {t} en pausa', { t }),
          stopping: tr('Cerrando {t}', { t }),
          paused: tr('{t} quedó pausada{a}: lo bajado queda guardado', { t, a: r.state.position_secs != null ? tr(' en {c}', { c: clock(r.state.position_secs) }) : '' }),
          failed: tr('No se pudo reproducir {t}: {message}', { t, message: r.state.message }),
          'ask-after-close': tr('Cerraste el reproductor de {t}: ¿seguir bajando de fondo o pausar?', { t }),
          background: tr('{t} sigue bajando de fondo, sin reproductor', { t }),
        }[k];
        if (text) A('reproduccion', text, { key: k === 'preparing' ? `prep:${r.id}` : undefined, level: k === 'failed' ? 'error' : 'info', announce: k === 'playing' || k === 'failed' });
      }
      if ((k === 'playing' || k === 'background') && r.progress < 0.999) {
        A('motor', tr('Bajando {t}: {a} % · {b} Mbps · {peers} peers', { t, a: Math.floor(r.progress * 100), b: mb(r.speed_bps ?? 0), peers: r.peers }), { key: `dl:${r.id}` });
      }
      break;
    }
    case 'playback-removed': {
      const r = state.playbacks.get(ev.id);
      if (r) A('limpieza', tr('Descarga de {a} borrada', { a: titleOf(r.key) }));
      break;
    }
    case 'catalog-streams': {
      const u = ev.update;
      const failed = u.addons.filter((x) => x.message).length;
      A('catalogo', tr('Catálogo: {n} streams de {n2} addons{a}{b}', { n: u.candidates.length, n2: u.addons.length, a: u.done ? '' : tr(' (llegando…)'), b: failed ? tr(' · {failed} sin respuesta', { failed }) : '' }), { key: `cat:${u.video_id}` });
      break;
    }
    default:
      break;
  }
}
