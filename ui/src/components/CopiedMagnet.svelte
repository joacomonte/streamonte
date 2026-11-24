<!-- Botón "Reproducir magnet copiado" (2026-11-16): aparece solo si lo último copiado es un magnet y lo reproduce directo,
     sin análisis ni preguntas (la app usada como reproductor de magnets). Ctrl+V lo toca (app.js `onShortcut`). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as core from '../core.ts';
  import { play } from '../audio-picker.ts';
  import { icon, showError } from '../dom.ts';
  import { t } from '../i18n.ts';
  import type { CopiedMagnet } from '../types.ts';

  let copied = $state.raw<CopiedMagnet | null>(null);
  let busy = $state(false);

  async function refresh(): Promise<void> {
    copied = await core.copiedMagnet().catch(() => null);
  }

  async function playCopied(ev: MouseEvent): Promise<void> {
    if (!copied) return;
    const btn = ev.currentTarget as HTMLButtonElement;
    busy = true;
    try {
      await core.addSelected([copied.raw]);
      // Como cualquier ▶: pregunta con qué reproductor (y audio, si se sabe) antes de abrir.
      await play(copied.info_hash, btn);
    } catch (e) { showError(e); } finally { busy = false; }
  }

  // Lo copiado se mira al volver a la app y cada tanto (copiar un magnet afuera y volver).
  onMount(() => {
    void refresh();
    const timer = setInterval(() => { if (document.hasFocus()) void refresh(); }, 3000);
    return () => clearInterval(timer);
  });
</script>

<svelte:window onfocus={refresh} />

<button id="btn-clipboard" class="top-btn play-copied" hidden={!copied} disabled={busy} onclick={playCopied}
  title={t('Reproducir {a} (Ctrl+V)', { a: copied?.name ?? t('el magnet copiado') })}>
  {@html icon('play', 15).outerHTML}<span>{t('Reproducir magnet copiado')}</span>{#if copied?.name}<span class="top-size play-copied-name">· {copied.name}</span>{/if}
</button>
