<!-- Barra superior: lo que baja de fondo (nombre, % y ▶), el botón Descargas (bajado, caché, velocidad, badge), su menú
     (lo que se reproduce o baja, lo pausado, el análisis y el espacio en disco, con todo lo que se puede detener, borrar o
     limpiar) y la barra fina de progreso al pie del toolbar. Lee el estado en vivo de live.svelte.ts. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as core from '../core.ts';
  import { play } from '../audio-picker.ts';
  import { cleanTemp, clearDataCache, openLog, stopAllAndClean } from '../dialog-flows.ts';
  import { icon, showError } from '../dom.ts';
  import { t as tr } from '../i18n.ts';
  import { humanBytes, mbps } from '$ui/format.ts';
  import { playbackText } from '../format.ts';
  import { closePop } from '../top-menus.ts';
  import { live } from '../live.svelte.ts';
  import { titleOf } from '../live.ts';
  import type { PlaybackAction, PlaybackRow, TempUsage } from '../types.ts';

  const ACTIVE = (r: PlaybackRow): boolean => r.state.kind !== 'paused' && r.state.kind !== 'failed';
  /** Estados en que de verdad baja datos (pausada o "solo reproduciendo lo bajado" no). */
  const TRANSFER = new Set(['fetching-metadata', 'preparing', 'playing', 'background']);
  const MB = 1024 ** 2;
  const title = (k: string): string => titleOf(live.v, k);
  const act = (r: PlaybackRow, action: PlaybackAction) => () => core.playbackAction(r.id, action).catch(showError);

  let btn: HTMLButtonElement;
  let pop = $state<HTMLElement>();
  let open = $state(false);
  let pos = $state({ top: 0, right: 0 });
  /** Para el menú: TempUsage y tamaño de la caché de datos, pedidos al abrir y después de limpiar. */
  let usage = $state.raw<TempUsage | null>(null);
  let dataBytes = $state<number | null>(null);
  /** Para el botón: lo borrable sin tocar lo activo ni lo guardado. Recorre carpetas: al abrir la app, cada 30 s y al limpiar. */
  let cache = $state.raw<TempUsage | null>(null);

  const rows = $derived([...live.v.playbacks.values()]);
  const running = $derived(rows.filter(ACTIVE));
  const kept = $derived(rows.filter((r) => !ACTIVE(r)));
  /** Bytes ya bajados: progreso × tamaño del video, o lo que el núcleo midió en disco si es más. Sin tamaño no suma. */
  const downloaded = $derived(rows.reduce((total, r) => {
    const e = live.v.entries.get(r.key);
    const size = e?.video_size ?? e?.live?.file_size ?? 0;
    return total + Math.max(e?.downloaded_bytes ?? 0, (r.progress ?? 0) * size);
  }, 0));
  /** Algo bajando (2026-11-17): velocidad total en el botón y barra al pie del toolbar. */
  const transfer = $derived(rows.filter((r) => TRANSFER.has(r.state.kind) && (r.progress ?? 0) < 1));
  const transferBps = $derived(transfer.reduce((t, r) => t + (r.speed_bps || 0), 0));
  const transferPct = $derived(transfer.length ? Math.round((transfer.reduce((t, r) => t + (r.progress ?? 0), 0) / transfer.length) * 100) : 0);
  /** Lo que baja de fondo, siempre a la vista: el más avanzado y "+N". */
  const background = $derived(rows.filter((r) => r.state.kind === 'background').sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0)));
  const bg = $derived(background[0]);
  const bgPct = $derived(bg ? Math.floor((bg.progress ?? 0) * 100) : 0);
  const analyzer = $derived(live.v.analyzer);
  const total = $derived(usage && dataBytes != null ? humanBytes(usage.bytes + dataBytes) : '…');

  async function refreshCache(): Promise<void> {
    cache = await core.tempUsage().catch(() => null);
  }

  async function toggle(): Promise<void> {
    if (open) { open = false; return; }
    closePop(); // el menú de Velocidad (top-menus.ts), si estaba abierto
    const r = btn.getBoundingClientRect();
    pos = { top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) };
    open = true;
    [usage, dataBytes] = await Promise.all([core.tempUsage().catch(() => null), core.dataCacheSize().catch(() => null)]);
  }

  async function afterClean(fn: () => Promise<unknown>): Promise<void> {
    await fn();
    [usage, dataBytes] = await Promise.all([core.tempUsage().catch(() => usage), core.dataCacheSize().catch(() => dataBytes)]);
    void refreshCache();
  }

  function onPointerDown(ev: PointerEvent): void {
    const target = ev.target as Element;
    if (open && !pop?.contains(target) && !btn.contains(target) && !target.closest('dialog')) open = false;
  }

  /** El menú va en `body` (posición fija, fuera del toolbar). */
  function toBody(node: HTMLElement): () => void {
    document.body.append(node);
    return () => node.remove();
  }

  onMount(() => {
    void refreshCache();
    const timer = setInterval(refreshCache, 30_000);
    return () => clearInterval(timer);
  });
</script>

<svelte:document onpointerdown={onPointerDown} onkeydown={(ev) => { if (ev.key === 'Escape' && open && !document.querySelector('dialog[open]')) open = false; }} />
<svelte:window onresize={() => (open = false)} />

{#snippet item(r: PlaybackRow)}
  {@const pct = Math.floor((r.progress ?? 0) * 100)}
  {@const paused = r.state.kind === 'paused'}
  {@const still = paused || r.state.kind === 'failed'}
  <li class="pop-item">
    <div class="pop-item-text">
      <span class="pop-item-title">{title(r.key)}</span>
      <span class="pop-item-sub">{still ? playbackText(r) : `${playbackText(r)} · ${pct} %${r.speed_bps > 0 ? ` · ${mbps(r.speed_bps)}` : ''}${r.peers ? ` · ${r.peers} peers` : ''}`}</span>
      {#if !still}<span class="pop-bar"><i style:width="{pct}%"></i></span>{/if}
    </div>
    <div class="pop-actions">
      {#if paused}<button id="dl-resume-{r.id}" class="btn btn-sm btn-pill pop-btn" onclick={() => play(r.key, null)}>{tr('Retomar')}</button>{/if}
      {#if ACTIVE(r)}<button id="dl-stop-{r.id}" class="btn btn-sm btn-pill pop-btn" title={tr('Cierra mpv y el motor; lo bajado queda guardado')} onclick={act(r, 'stop')}>{tr('Detener')}</button>{/if}
      <button id="dl-folder-{r.id}" class="btn btn-sm btn-pill pop-btn icon" title={tr('Abrir carpeta')} aria-label={tr('Abrir carpeta')} onclick={act(r, 'open-folder')}>📂</button>
      <button id="dl-log-{r.id}" class="btn btn-sm btn-pill pop-btn icon" title={tr('Ver log')} aria-label={tr('Ver log')} onclick={() => openLog(r)}>≡</button>
      <button id="dl-delete-{r.id}" class="btn btn-sm btn-pill pop-btn danger" title={tr('Detener y borrar lo descargado')} onclick={act(r, 'stop-and-delete')}>{tr('Borrar')}</button>
    </div>
  </li>
{/snippet}

{#if bg}
  <span id="top-bg" class="top-bg">
    <span class="top-bg-info" title={tr('Bajando de fondo: {a} · {pct} %{b}', { a: title(bg.key), pct: bgPct, b: bg.speed_bps > 0 ? ` · ${mbps(bg.speed_bps)}` : '' })}>
      {@html icon('download', 14).outerHTML}<span class="top-bg-name">{title(bg.key)}</span><b>{bgPct} %</b>
      {#if background.length > 1}<span class="top-bg-more">+{background.length - 1}</span>{/if}
      <span class="top-bg-bar" aria-hidden="true"><i style:width="{Math.max(bgPct, 2)}%"></i></span>
    </span>
    <button id="top-bg-play" class="top-bg-play" aria-label={tr('Ver {a}', { a: title(bg.key) })} title={tr('Verla ahora (sigue bajando mientras la ves)')}
      onclick={(ev) => play(bg.key, ev.currentTarget)}>{@html icon('play', 14).outerHTML}</button>
  </span>
{/if}

<button id="btn-downloads" class="top-btn" class:active={open} bind:this={btn} aria-haspopup="dialog" aria-expanded={open}
  title={tr('Lo descargado, lo que se reproduce o baja de fondo, y limpieza')} onclick={toggle}>{tr('Descargas')}<span
    id="downloads-size" class="top-size" hidden={downloaded < MB}>{tr('· {a} bajados', { a: humanBytes(downloaded) })}</span><span
    id="downloads-cache" class="top-size" hidden={!cache || cache.bytes < MB}>{cache ? tr('· {a} de caché', { a: humanBytes(cache.bytes) }) : ''}</span><span
    id="downloads-speed" class="top-speed" hidden={!transfer.length}>↓ {mbps(transferBps)}</span><span
    id="downloads-badge" class="top-badge" hidden={!running.length}>{running.length}</span></button>

<div id="top-dl" class="top-dl" class:waiting={transferPct === 0} role="progressbar" aria-label={tr('Descargando')} aria-valuenow={transferPct}
  hidden={!transfer.length} title={transfer.length ? tr('Bajando {a} · {pct} % · {b}', { a: transfer.length === 1 ? transfer[0].name : `${transfer.length} videos`, pct: transferPct, b: mbps(transferBps) }) : undefined}>
  <i style:width="{Math.max(transferPct, 2)}%"></i>
</div>

{#if open}
  <div id="downloads-pop" class="top-pop" role="dialog" aria-label={tr('Descargas')} style:top="{pos.top}px" style:right="{pos.right}px" bind:this={pop} {@attach toBody}>
    <div class="pop-head">
      <div><h3>{tr('Descargas')}</h3><p class="pop-sub">{tr('{total} en disco', { total })}</p></div>
      <button id="dl-open-folder" class="btn btn-sm btn-pill pop-btn" onclick={() => core.openDownloadsFolder().catch(showError)}>{@html icon('folder', 15).outerHTML}{tr('Abrir carpeta')}</button>
    </div>
    <ul class="disk-list">
      <li class="disk-row">
        <span class="disk-row-text"><b>{tr('Caché')}</b><span>{tr('Lo analizado y restos sin uso')}</span></span>
        <span class="disk-row-size">{usage ? humanBytes(usage.bytes) : '…'}</span>
        <button id="dl-clean" class="btn btn-sm btn-pill pop-btn" title={tr('Borra lo analizado y los restos que no están en uso (no toca lo activo ni lo guardado)')}
          disabled={usage?.bytes === 0} onclick={() => afterClean(cleanTemp)}>{tr('Borrar')}</button>
      </li>
    </ul>
    <!-- Datos guardados: discreto a propósito, sirven para abrir todo más rápido y no conviene invitar a borrarlos. -->
    <p class="pop-data-line">
      {tr('Datos guardados · {a} · aceleran el catálogo, no hace falta borrarlos · ', { a: dataBytes == null ? '…' : humanBytes(dataBytes) })}<button
        id="dl-clear-data" type="button" title={tr('Borra fichas, portadas y puntajes guardados (se vuelven a bajar cuando hagan falta)')}
        onclick={() => afterClean(clearDataCache)}>{tr('borrar')}</button>
    </p>
    <!-- Las secciones vacías no se muestran (2026-11-17). -->
    {#if running.length}
      <section class="pop-section"><h4>{tr('En curso · {n}', { n: running.length })}</h4><ul class="pop-list">{#each running as r (r.id)}{@render item(r)}{/each}</ul></section>
    {/if}
    {#if kept.length}
      <section class="pop-section"><h4>{tr('Guardadas · {n}', { n: kept.length })}</h4><ul class="pop-list">{#each kept as r (r.id)}{@render item(r)}{/each}</ul></section>
    {/if}
    {#if analyzer.kind !== 'idle'}
      <section class="pop-section">
        <h4>{tr('Análisis')}</h4>
        <div class="pop-item">
          <div class="pop-item-text">
            <span class="pop-item-title">{analyzer.kind === 'paused' ? tr('En pausa') : analyzer.kind === 'measuring' ? tr('Midiendo {a}', { a: title(analyzer.current ?? '') })
              : analyzer.kind === 'scraping' ? tr('Consultando trackers') : tr('Leyendo metadatos')}</span>
            <span class="pop-item-sub">{tr('{queued} en cola · cada medición usa un motor propio', { queued: live.v.queued.length })}</span>
          </div>
          <div class="pop-actions">
            {#if analyzer.kind === 'paused'}
              <button id="dl-analyzer-resume" class="btn btn-sm btn-pill pop-btn" onclick={() => core.analyzerResume().catch(showError)}>{tr('Reanudar')}</button>
            {:else}
              <button id="dl-analyzer-pause" class="btn btn-sm btn-pill pop-btn" title={tr('Corta lo que se está midiendo y pausa la cola')} onclick={() => core.analyzerPause().catch(showError)}>{tr('Pausar')}</button>
            {/if}
          </div>
        </div>
      </section>
    {/if}
    <!-- Solo hace algo distinto de "Borrar caché" cuando hay reproducciones o descargas guardadas. -->
    {#if rows.length}
      <div class="pop-foot">
        <button id="dl-stop-all" class="btn btn-sm btn-pill pop-btn danger" title={tr('Detiene todo y borra todo lo descargado, también lo pausado')} onclick={() => afterClean(stopAllAndClean)}>{tr('Detener y borrar todo')}</button>
      </div>
    {/if}
  </div>
{/if}
