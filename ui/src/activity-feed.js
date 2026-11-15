// Qué se cuenta en la burbuja de actividad (ui/src/activity.js es el widget): eventos del núcleo →
// líneas del log, y el resumen de lo que corre de fondo para su píldora.
import { activity } from './activity.js';
import { clock, humanBytes, mb, nf } from './format.js';
import { fullName, state, titleOf } from './state.js';

const PHASE_TEXT = { connecting: 'conectando', metadata: 'buscando metadatos', preload: 'precargando' };

/** Resumen de lo que corre de fondo para la píldora de la burbuja de actividad. */
export function renderActivity() {
  const title = titleOf;
  const parts = [];
  for (const r of state.playbacks.values()) {
    const k = r.state.kind;
    if (k === 'fetching-metadata' || k === 'preparing') parts.push(`Preparando ${title(r.key)}${k === 'preparing' ? ` ${Math.round((r.state.fraction ?? 0) * 100)} %` : ''}`);
    else if (k === 'playing' && r.progress < 0.999) parts.push(`Bajando ${title(r.key)} · ${Math.floor(r.progress * 100)} %`);
    else if (k === 'background') parts.push(`Bajando ${title(r.key)} de fondo · ${Math.floor(r.progress * 100)} %`);
    else if (k === 'stopping') parts.push(`Cerrando ${title(r.key)}`);
  }
  const s = state.analyzerState;
  const pending = state.pending;
  if (s.kind === 'scraping') parts.push('Consultando trackers');
  else if (s.kind === 'quick-scan') parts.push(`Leyendo datos de ${s.total}`);
  else if (s.kind === 'measuring' && s.current) parts.push(`Midiendo ${title(s.current)}`);
  else if (pending.size) parts.push(`Preparando ${pending.size === 1 ? titleOf([...pending.keys()][0]) : `${pending.size} análisis`}`);
  const waiting = state.queued.filter((h) => !(s.kind === 'measuring' && s.current === h)).length;
  if (waiting && s.kind !== 'paused') parts.push(`${waiting} en cola`);
  activity.setBusy(parts.join(' · '));
}

/** Eventos del núcleo → líneas de la burbuja. Se llama ANTES de actualizar el estado, para
 *  comparar con lo anterior y contar solo los cambios (no cada tic). */
export function logEvent(ev) {
  const A = (area, text, more = {}) => activity.push({ area, text, ...more });
  switch (ev.type) {
    case 'activity':
      A(ev.area, ev.message, { level: ev.level, at: new Date(ev.at) });
      break;
    case 'status':
      A('general', ev.message, { level: ev.level });
      break;
    case 'clipboard-history-unavailable':
      A('portapapeles', 'El historial del portapapeles (Win+V) está apagado: solo se ve lo último copiado.', { level: 'warn' });
      break;
    case 'analyzer-progress': {
      const s = ev.state;
      const p = state.analyzerState;
      if (s.kind === 'scraping' && p.kind !== 'scraping') A('analisis', `Consultando trackers de ${s.total} magnet(s)`);
      else if (s.kind === 'quick-scan' && p.kind !== 'quick-scan') A('analisis', `Leyendo datos rápidos de ${s.total}: nombre, duración, audios, seeds`);
      else if (s.kind === 'measuring' && s.current) {
        if (p.kind !== 'measuring' || p.current !== s.current) A('analisis', `Midiendo la velocidad de ${titleOf(s.current)} (${s.done + 1} de ${s.total})`, { announce: true });
        if (s.live) {
          const ph = s.live.phase;
          const txt = ph in PHASE_TEXT ? `preparando · ${PHASE_TEXT[ph]}`
            : ph === 'probing' ? `${mb(s.live.speed_bps)} Mbps · leyendo duración y audios`
              : `${mb(s.live.speed_bps)} Mbps · ${Math.round(s.live.secs)} s · ${s.live.peers} peers${s.live.stable ? ' · ya estable' : ''}`;
          A('analisis', `${titleOf(s.current)}: ${txt}`, { key: `spd:${s.current}` });
        }
      } else if (s.kind === 'paused' && p.kind !== 'paused') A('analisis', 'Análisis en pausa');
      else if (s.kind === 'idle' && !['idle', 'paused'].includes(p.kind)) A('analisis', 'Análisis terminado: la lista quedó ordenada de mejor a peor', { announce: true });
      break;
    }
    case 'analyzer-queue':
      if (ev.queued.length && ev.queued.length !== state.queued.length) A('analisis', `${ev.queued.length} en cola para analizar`, { key: 'queue' });
      for (const hsh of ev.held) if (!state.held.has(hsh)) A('analisis', `Pausado el análisis de ${titleOf(hsh)}`);
      break;
    case 'library-entry-updated': {
      const e = ev.entry;
      const old = state.entries.get(e.key);
      const t = e.release?.title || fullName(e);
      if (!old) { A('portapapeles', `Agregado: ${t}`); break; }
      if (!old.torrent_name && e.torrent_name) A('motor', `Metadatos de ${t}: ${e.torrent_name}`);
      if (!old.live && e.live) {
        const size = e.video_size ?? e.live.file_size;
        A('analisis', `Datos leídos de ${t}: ${size ? humanBytes(size) : ''}${e.live.duration_secs ? ` · ${clock(e.live.duration_secs)}` : ''}${e.languages?.length ? ` · ${e.languages.map((l) => l.short).join('/')}` : ''}`);
      }
      if (e.live?.avg_speed_bps > 0 && e.live.avg_speed_bps !== old.live?.avg_speed_bps) {
        A('analisis', `${t}: ${mb(e.live.avg_speed_bps)} Mbps reales${e.score?.margin != null ? ` (${nf(e.score.margin)}×)` : ''}`, { announce: true });
      }
      if (e.status?.kind === 'failed' && old.status?.kind !== 'failed') A('analisis', `Falló el análisis de ${t}: ${e.status.reason ?? 'sin detalle'}`, { level: 'error' });
      break;
    }
    case 'library-entry-removed':
      A('general', `Quitado de la lista: ${titleOf(ev.key)}`);
      break;
    case 'playback-updated': {
      const r = ev.row;
      const k = r.state.kind;
      const old = state.playbacks.get(r.id);
      const t = titleOf(r.key);
      if (old?.state.kind !== k || k === 'preparing') {
        const text = {
          'fetching-metadata': `Buscando metadatos de ${t}`,
          preparing: `Preparando ${t}: ${Math.round((r.state.fraction ?? 0) * 100)} % (principio y final del video)`,
          playing: `Reproduciendo ${t} en mpv`,
          'download-paused': `Descarga de ${t} en pausa`,
          stopping: `Cerrando ${t}`,
          paused: `${t} quedó pausada${r.state.position_secs != null ? ` en ${clock(r.state.position_secs)}` : ''}: lo bajado queda guardado`,
          failed: `No se pudo reproducir ${t}: ${r.state.message}`,
          'ask-after-close': `Cerraste el reproductor de ${t}: ¿seguir bajando de fondo o pausar?`,
          background: `${t} sigue bajando de fondo, sin reproductor`,
        }[k];
        if (text) A('reproduccion', text, { key: k === 'preparing' ? `prep:${r.id}` : undefined, level: k === 'failed' ? 'error' : 'info', announce: k === 'playing' || k === 'failed' });
      }
      if ((k === 'playing' || k === 'background') && r.progress < 0.999) {
        A('motor', `Bajando ${t}: ${Math.floor(r.progress * 100)} % · ${mb(r.speed_bps ?? 0)} Mbps · ${r.peers} peers`, { key: `dl:${r.id}` });
      }
      break;
    }
    case 'playback-removed': {
      const r = state.playbacks.get(ev.id);
      if (r) A('limpieza', `Descarga de ${titleOf(r.key)} borrada`);
      break;
    }
    case 'catalog-streams': {
      const u = ev.update;
      const failed = u.addons.filter((x) => x.message).length;
      A('catalogo', `Catálogo: ${u.candidates.length} streams de ${u.addons.length} addons${u.done ? '' : ' (llegando…)'}${failed ? ` · ${failed} sin respuesta` : ''}`, { key: `cat:${u.video_id}` });
      break;
    }
    default:
      break;
  }
}
