// Tarjeta "Audio latino" del paso de audio (web `Torrents.svelte` y desktop `catalog-flow.ts`), variante A de
// docs/mockups/audio-latino: chips cortos en vez de párrafos.
import { t } from '../i18n/runtime.ts';
import type { FlowChip } from './types.ts';

/** Chips de la tarjeta de latino (web y desktop arman los mismos): seguras, a revisar, "tarda más" y la resolución típica
 * (el latino suele venir en 1080p o 720p; en 4K es raro). */
export function latChips(sure: number, maybe: number, slow: boolean, slowTitle: string): FlowChip[] {
	const chips: (FlowChip | null)[] = [
		sure ? { kind: 'ok', text: String(sure), title: t(sure === 1 ? '{n} lo dice en el nombre' : '{n} lo dicen en el nombre', { n: sure }) } : null,
		maybe ? { kind: 'maybe', text: String(maybe), title: t(maybe === 1 ? '{n} dudosa (MULTI / Dual)' : '{n} dudosas (MULTI / Dual)', { n: maybe }) } : null,
		slow ? { kind: 'slow', text: t('Tarda más'), title: slowTitle } : null,
		{ kind: 'res', text: t('hasta 1080p'), title: t('El audio latino suele venir en 1080p o 720p; en 4K es raro') },
	];
	return chips.filter((c): c is FlowChip => c !== null);
}
