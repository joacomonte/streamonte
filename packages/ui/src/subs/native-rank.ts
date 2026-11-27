// Orden de los subtítulos nativos (los que trae el video) para el idioma preferido del usuario, y cuál se recomienda.
// Misma regla que `crates/core/src/subtitles/native_rank.rs` (golden `packages/golden/native_rank.json`).
// Criterios, en este orden: 1) forzados al fondo; 2) idioma preferido y su variante (la preferida, sin variante, la otra);
// 3) completo antes que para sordos (SDH); 4) texto antes que imagen (PGS/VobSub); 5) el marcado default; 6) orden original.
import { spanishVariant, type SpanishVariant } from '../latino.ts';

/** Lo que la regla lee de un sub nativo (`NativeSub` del desktop lo cumple). */
export type RankSub = { lang: string | null; title: string | null; codec: string | null; forced: boolean; sdh: boolean; default: boolean };
/** `order`: índices de `subs`, del mejor al peor. `recommended`: el primero no forzado del idioma preferido (null si no hay). */
export type NativeRank = { order: number[]; recommended: number | null };

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Para sordos: el flag de la pista o lo que dice el nombre. */
export function isSdh(s: RankSub): boolean {
	const w = words(s.title ?? '');
	return s.sdh || w.some((x) => ['sdh', 'cc', 'hi', 'sordos', 'hearing'].includes(x)) || w.some((x, i) => x === 'closed' && (w[i + 1] ?? '').startsWith('caption'));
}

/** Forzado: el flag de la pista o lo que dice el nombre. */
export const isForced = (s: RankSub): boolean => s.forced || words(s.title ?? '').some((x) => ['forced', 'forzados', 'signs', 'carteles'].includes(x));

/** Subtítulo de imagen (PGS, VobSub…). */
export function isImage(s: RankSub): boolean {
	const codec = (s.codec ?? '').toLowerCase();
	return ['hdmv_pgs_subtitle', 'pgs', 'dvd_subtitle', 'dvdsub', 'vobsub', 'dvb_subtitle'].includes(codec) || codec.startsWith('s_hdmv') || codec.startsWith('s_vobsub');
}

const ISO3: Record<string, string> = { spa: 'es', esp: 'es', eng: 'en', por: 'pt', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', jpn: 'ja', zho: 'zh', chi: 'zh', rus: 'ru', kor: 'ko' };
/** Código de idioma de 2 letras (`spa`, `es-419`, `eng` → `es`, `es`, `en`). */
const langCode = (lang: string): string => {
	const primary = lang.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
	return ISO3[primary] ?? primary;
};

/** ¿Sub en español, y de qué variante? Igual que `audio::spanish_track` de Rust (región distinta de `es` = latino). */
function spanishTrack(langRaw: string | null, titleRaw: string | null): SpanishVariant | null {
	const lang = (langRaw ?? '').trim().toLowerCase().replace(/_/g, '-');
	const title = (titleRaw ?? '').toLowerCase();
	const variant = spanishVariant(title);
	const spanishLang = lang === 'spa' || lang === 'es' || lang === 'esp' || lang.startsWith('es-');
	const spanishTitle = variant !== 'unknown' || ['español', 'espanol', 'spanish'].some((w) => title.includes(w));
	if (!spanishLang && !spanishTitle) return null;
	const region = lang.startsWith('es-') ? lang.slice(3) : '';
	if (variant === 'lat' || (region !== '' && region !== 'es')) return 'lat';
	if (variant === 'spain' || region === 'es') return 'spain';
	return 'unknown';
}

/** 0 = idioma preferido con la variante preferida (o sin preferencia de variante), 1 = sin variante, 2 = la otra; null = otro idioma. */
function languageTier(s: RankSub, lang: string, variant: SpanishVariant): number | null {
	if (lang === 'es') {
		const got = spanishTrack(s.lang, s.title);
		if (got === null) return null;
		return variant === 'unknown' || got === variant ? 0 : got === 'unknown' ? 1 : 2;
	}
	return langCode(s.lang ?? '') === lang ? 0 : null;
}

/** Ordena `subs` para el idioma preferido `lang` (`es`, `en`, `spa`…; null = sin preferencia) y su `variant`
 * (solo cuenta en español; 'unknown' = sin preferencia de variante). */
export function nativeRank(subs: RankSub[], lang: string | null, variant: SpanishVariant = 'unknown'): NativeRank {
	const want = lang ? langCode(lang) : '';
	const tiers = subs.map((s) => (want ? languageTier(s, want, variant) : null));
	const key = (i: number): number[] => [Number(isForced(subs[i])), tiers[i] ?? 3, Number(isSdh(subs[i])), Number(isImage(subs[i])), Number(!subs[i].default), i];
	const order = subs.map((_, i) => i).sort((a, b) => {
		const [ka, kb] = [key(a), key(b)];
		const at = ka.findIndex((v, n) => v !== kb[n]);
		return at === -1 ? 0 : ka[at] - kb[at];
	});
	const recommended = order.find((i) => tiers[i] !== null && !isForced(subs[i])) ?? null;
	return { order, recommended };
}
