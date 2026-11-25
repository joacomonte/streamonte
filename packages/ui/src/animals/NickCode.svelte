<script lang="ts">
	// Pantalla del código de animales (la compartida, `AnimalCode.svelte`) sobre un `NickFlow`. Se monta una vez, encima de
	// la bienvenida y de Ajustes; `ondone` corre al crear o acertar el código, antes de devolver el apodo a la bienvenida.
	import AnimalCode from './AnimalCode.svelte';
	import type { NickFlow } from './nick-flow.svelte.ts';

	interface Props {
		flow: NickFlow;
		ondone?: (nick: string) => void | Promise<void>;
	}
	let { flow, ondone }: Props = $props();
</script>

{#if flow.ask.current}
	{@const a = flow.ask.current}
	{#key a}
		<AnimalCode
			nick={a.nick}
			mode={a.mode}
			order={a.order}
			wait={a.wait}
			submit={(code) => flow.sendCode(code)}
			ondone={async () => {
				await ondone?.(a.nick);
				flow.close(true);
			}}
			onback={() => flow.close(false)}
		/>
	{/key}
{/if}
