// Lo que se ve de los subtítulos que trae el video: el recomendado (tarjeta) y el resto (lista gris), cada uno con qué
// tipo es (diálogo completo, para sordos, forzados) y si es texto o imagen. El orden lo decide `nativeRank`.
import type { SpanishVariant } from '../latino.ts';
import { t } from '../i18n/runtime.ts';
import { isForced, isImage, isSdh, nativeRank, spanishTrack, type RankSub } from './native-rank.ts';

/** Una pista del video: `key` para elegirla, `id` del botón, `sub` lo que lee la regla. */
export type NativeTrack = { key: string; id: string; sub: RankSub };
export type NativeKind = 'full' | 'sdh' | 'forced';
/** `format`: "PGS · imagen", "SRT · texto" o '' (sin codec). */
export type NativeLine = { key: string; id: string; name: string; kind: NativeKind; kindText: string; format: string; isDefault: boolean };
export type NativeView = { best: NativeLine | null; rest: NativeLine[] };

const CODEC: Record<string, string> = { subrip: 'SRT', srt: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'VTT', mov_text: 'TX3G', hdmv_pgs_subtitle: 'PGS', pgs: 'PGS', dvd_subtitle: 'VobSub', dvdsub: 'VobSub', vobsub: 'VobSub', dvb_subtitle: 'DVB' };

function lineOf(tr: NativeTrack): NativeLine {
	const s = tr.sub;
	const kind: NativeKind = isForced(s) ? 'forced' : isSdh(s) ? 'sdh' : 'full';
	const variant = spanishTrack(s.lang, s.title);
	const name = variant === 'lat' ? t('Español latino') : variant === 'spain' ? t('Español castellano') : variant === 'unknown' ? t('Español') : (s.lang ?? '').toUpperCase();
	const raw = (s.codec ?? '').toLowerCase();
	const codec = CODEC[raw] ?? raw.replace(/^s_(text\/)?/, '').toUpperCase();
	const format = codec ? `${codec} · ${isImage(s) ? t('imagen') : t('texto')}` : '';
	const kindText = kind === 'forced' ? t('Forzados (solo carteles)') : kind === 'sdh' ? t('Para sordos (describe sonidos)') : t('Diálogo completo');
	return { key: tr.key, id: tr.id, name, kind, kindText, format, isDefault: s.default };
}

/** El recomendado y el resto (en el orden de `nativeRank` para `lang`/`variant`); sin recomendado (p. ej. solo forzados), todo va al resto. */
export function nativeView(tracks: NativeTrack[], lang: string = 'es', variant: SpanishVariant = 'lat'): NativeView {
	const { order, recommended } = nativeRank(tracks.map((x) => x.sub), lang, variant);
	return {
		best: recommended == null ? null : lineOf(tracks[recommended]),
		rest: order.filter((i) => i !== recommended).map((i) => lineOf(tracks[i]))
	};
}
