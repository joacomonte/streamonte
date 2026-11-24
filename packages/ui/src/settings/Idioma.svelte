<script lang="ts">
	// Sección Idioma, igual en las dos apps; qué pasa al elegir lo decide cada una (`onpick`, ver LangPicker).
	import { t } from '../i18n/runtime.ts';
	import LangPicker from '../components/LangPicker.svelte';
	import type { LangOptions } from '../components/tour-state.ts';
	import Section from './Section.svelte';
	interface Props extends LangOptions {
		id: string;
		headId: string;
		/** Id del selector (`set-lang` en el desktop, `settings-lang` en la web). */
		pickerId: string;
		level?: 2 | 3;
	}
	let { id, headId, pickerId, level, app, titles, onpick }: Props = $props();
</script>

<Section {id} {headId} {level} title={t('Idioma')}>
	<LangPicker id={pickerId} {app} {titles} {onpick} />
</Section>
