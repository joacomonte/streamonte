<script lang="ts">
	// Ícono del set compartido (`icons.ts`); hereda el color del texto.
	import { ICONS, type IconName } from './icons.ts';

	interface Props {
		name: IconName;
		size?: number;
	}
	let { name, size = 20 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[name]}</svg>
