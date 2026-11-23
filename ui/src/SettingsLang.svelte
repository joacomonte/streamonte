<script lang="ts">
  // Selector de idiomas de Ajustes (el compartido): elegir uno recarga la ventana en el idioma nuevo.
  import LangPicker from '$ui/components/LangPicker.svelte';
  import { langs, setLangs } from './i18n.js';
</script>

<LangPicker id="set-lang" app={langs.app} titles={langs.titles} onpick={(key, value) => langs[key] !== value && setLangs({ [key]: value })} />
