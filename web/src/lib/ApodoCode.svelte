<script lang="ts">
	// Pantalla del código de animales de la web (la compartida, `$ui/animals/AnimalCode.svelte`) sobre /api/nick.
	import { invalidateAll } from '$app/navigation';
	import AnimalCode from '$ui/animals/AnimalCode.svelte';
	import { t } from '#lib/i18n.svelte.ts';
	import { closeCode, codeAsk, sendCode } from '#lib/apodo.svelte.ts';

	const submit = async (code: string[]) => {
		const r = await sendCode(code);
		return r.ok ? r : { ...r, error: t(r.error) };
	};
	const ondone = async () => {
		const nick = codeAsk.current?.nick;
		await invalidateAll();
		closeCode({ nick });
	};
</script>

{#if codeAsk.current}
	{@const a = codeAsk.current}
	{#key a}
		<AnimalCode nick={a.nick} mode={a.mode} order={a.order} wait={a.wait} {submit} {ondone} onback={() => closeCode({ error: '' })} />
	{/key}
{/if}
