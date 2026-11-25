<script lang="ts">
	// Internet → Router → Esta PC. `state`: idle/off (sin verificar), busy (probando), ok (abierto), bad (cerrado).
	import { t } from '../../../i18n/runtime.ts';
	export type NetState = 'idle' | 'off' | 'busy' | 'ok' | 'bad';
	let { state }: { state: NetState } = $props();
</script>

<svg class="art art-net" viewBox="0 0 300 92" data-state={state} aria-hidden="true">
	<path class="link l1" d="M58 44 H124" /><path class="flow" d="M58 44 H124" />
	<path class="link l2" d="M178 44 H232" /><path class="flow" d="M178 44 H232" />
	<circle class="node" cx="36" cy="44" r="20" /><path class="st" d="M16 44 H56 M36 24 C 26 34, 26 54, 36 64 M36 24 C 46 34, 46 54, 36 64" />
	<path class="st" d="M136 36 L131 22 M166 36 L171 22" /><rect class="node" x="126" y="34" width="50" height="22" rx="7" />
	<circle class="led" cx="140" cy="45" r="2.4" /><circle class="led" cx="151" cy="45" r="2.4" /><circle class="led" cx="162" cy="45" r="2.4" />
	<rect class="node" x="234" y="27" width="46" height="32" rx="5" /><path class="st" d="M250 67 H264 M257 59 V67" />
	<g class="mark m-ok"><circle cx="91" cy="44" r="9" fill="#1f4d33" stroke="#4ade80" stroke-width="1.4" /><path d="M87 44.5 l3 3 l5.5 -6" fill="none" stroke="#b7f5cd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></g>
	<g class="mark m-bad"><circle cx="91" cy="44" r="9" fill="#4d1f22" stroke="#f87171" stroke-width="1.4" /><path d="M87.5 40.5 l7 7 M94.5 40.5 l-7 7" stroke="#ffd0d0" stroke-width="2" stroke-linecap="round" /></g>
	<g class="mark m-idle"><circle cx="91" cy="44" r="9" fill="var(--hole)" stroke="var(--ill)" stroke-width="1.2" /><text x="91" y="48.5" text-anchor="middle">?</text></g>
	<g fill="var(--dim)" font-size="10.5" font-family="system-ui, sans-serif" text-anchor="middle"><text x="36" y="84">Internet</text><text x="151" y="84">Router</text><text x="257" y="84">{t('Esta PC')}</text></g>
</svg>
