<script lang="ts">
  // Bienvenida del desktop, una sola vez: el Tour compartido con sus pasos (idiomas → qué es → keys → reproductor).
  // Cambiar el idioma recarga la ventana: el paso queda guardado y se retoma ahí.
  import { onMount } from 'svelte';
  import Icon from '$ui/components/Icon.svelte';
  import Tour from '$ui/components/Tour.svelte';
  import { resumeIndex, type LangCode, type Step } from '$ui/components/tour-state.ts';
  import { langSteps } from '$ui/components/tours.ts';
  import * as core from './core.ts';
  import { safeGet, safeSet } from './catalog-state.ts';
  import { langs, setLangs, t } from './i18n.ts';
  import type { PlayersStatus } from './types.ts';
  import { setTouring, STORE } from './welcome-state.ts';

  const saved = safeGet(STORE);
  const steps: Step[] = [
    ...langSteps(),
    { icon: 'play', title: t('Bienvenido a Streamonte'), body: t('Elegís una peli o un episodio y lo mirás al instante en esta compu: por torrent o desde TorBox, con audio latino o el original y subtítulos en español.') },
    { icon: 'key', title: t('Dos keys para sacarle todo'), body: t('Se pegan en Ajustes y quedan en el almacén seguro del sistema.'), extra: 'keys' },
    { icon: 'monitor', title: t('Se ve en mpv o VLC'), body: t('Los videos se abren en un reproductor de esta compu. mpv viene recomendado: anda mejor, gasta menos y combina subtítulos.'), extra: 'players' },
  ];
  let open = $state(saved !== 'done');
  let index = $state(0);
  let configured = $state<string[]>([]);
  let players = $state<PlayersStatus | null>(null);

  onMount(() => {
    if (!open) return;
    core.apiKeys().then((ks: { service: string; configured: boolean }[]) => (configured = ks.filter((k) => k.configured).map((k) => k.service))).catch(() => {});
    core.playersStatus().then((p: PlayersStatus) => (players = p)).catch(() => {});
  });
  $effect(() => {
    if (open) safeSet(STORE, String(index));
  });

  // Elegir idioma pasa de paso solo: si cambió, la ventana recarga y retoma en el siguiente; si no, avanza tras ver el tilde.
  function pick(key: 'app' | 'titles', value: LangCode) {
    if (langs[key] !== value) {
      safeSet(STORE, String(index + 1));
      void setLangs({ [key]: value });
    } else setTimeout(() => (index = Math.min(index + 1, steps.length - 1)), 250);
  }
  const mpvText = (s: string | null | undefined) => (s === 'bundled' ? t('Incluido en la app') : s ? t('Instalado') : t('No está: lo instalás desde Ajustes → Reproductor'));
</script>

{#snippet ok()}<span class="tour-ok"><Icon name="check" size={12} />{t('Lista')}</span>{/snippet}

{#snippet extra(key: string)}
  <ul class="tour-list">
    {#if key === 'keys'}
      {#each [['tmdb', t('TMDB · gratis'), t('El catálogo con filtros por fecha, votos, idioma y géneros, pósters que faltan y dónde verla.')], ['torbox', t('TorBox · pago, opcional'), t('Ve al instante desde sus servidores, sin depender de los seeds, y baja lo que todavía no tiene.')]] as [service, name, what] (service)}
        <li class="tour-item">
          <span class="tour-item-text"><b>{name}{#if configured.includes(service)}{@render ok()}{/if}</b><small>{what}</small></span>
          {#if !configured.includes(service)}
            <button id="welcome-key-{service}" type="button" onclick={() => core.openKeyPage(service).catch(() => {})}><Icon name="external" size={14} />{t('Pedirla')}</button>
          {/if}
        </li>
      {/each}
    {:else}
      <li class="tour-item"><span class="tour-item-text"><b>mpv{#if players?.mpv}{@render ok()}{/if}</b><small>{players ? mpvText(players.mpv) : '…'}</small></span></li>
      <li class="tour-item"><span class="tour-item-text"><b>VLC{#if players?.vlc}{@render ok()}{/if}</b><small>{players ? (players.vlc ? t('Instalado') : t('No está instalado (opcional)')) : '…'}</small></span></li>
    {/if}
  </ul>
{/snippet}

{#if open}
  <Tour
    id="welcome"
    label={t('Bienvenida')}
    open
    {steps}
    start={resumeIndex(saved, steps.length)}
    bind:index
    langs={{ app: langs.app, titles: langs.titles, onpick: pick }}
    {extra}
    confetti
    onleave={() => {
      setTouring(false);
      safeSet(STORE, 'done');
      window.dispatchEvent(new CustomEvent('welcome-done'));
    }}
    onclose={() => (open = false)}
  />
{/if}

<style>
  .tour-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .tour-item { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--border-strong); border-radius: 18px; background: var(--surface); }
  .tour-item-text { flex: 1; display: grid; gap: 3px; min-width: 0; }
  .tour-item-text b { display: inline-flex; align-items: center; gap: 8px; font-size: 15.5px; }
  .tour-item-text small { font-size: 13px; color: var(--muted); line-height: 1.4; }
  .tour-item button { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  .tour-ok { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 700; color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
</style>
