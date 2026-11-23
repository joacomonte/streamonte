<script lang="ts">
	// "Buscando torrents…": spinner, subtítulo y barra de avance (`frac` 0..1; null = sin barra).
	interface Props {
		id?: string;
		title: string;
		sub: string;
		frac: number | null;
	}
	let { id, title, sub, frac }: Props = $props();
</script>

<div {id} class="searching" role="status">
	<span class="spin"></span>
	<span>
		<strong>{title}</strong>
		<span class="muted">{sub}</span>
	</span>
</div>
{#if frac !== null}<div class="meter" aria-hidden="true"><i style:width="{frac * 100}%"></i></div>{/if}

<style>
	.searching { display: flex; align-items: center; gap: 12px; padding: 16px 0 10px; font-size: 14px; }
	.searching > span:last-child { display: flex; flex-direction: column; gap: 2px; }
	.meter { height: 4px; border-radius: var(--r-pill); background: var(--surface-3); overflow: hidden; }
	.meter i { display: block; height: 100%; background: var(--accent); border-radius: inherit; transition: width 0.4s var(--out); }
</style>
