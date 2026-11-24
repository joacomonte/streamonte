<!-- Actividad de fondo (2026-11-14/15): píldora en la barra inferior con lo último que pasa (spinner mientras algo corre,
     hasta 8 s después de lo último; después un circulito con el contador de novedades). Al tocarla se abre el panel con
     "Resumen" (líneas amigables, filtrables por tipo) y "Detallado" (log del núcleo, por nivel), más "Descargar logs".
     Escape, tocar afuera (salvo fijado) o "Cerrar" lo cierran. Las líneas vienen de live.svelte.ts (`activityLog`). -->
<script lang="ts">
  import { tick } from 'svelte';
  import * as core from '../core.ts';
  import { t as tr } from '../i18n.ts';
  import { activity, activityLog, live } from '../live.svelte.ts';
  import { AREA, busyText } from '../activity-feed.ts';

  /** `detached`: ventana propia de Actividad (`?logs`, 2026-11-23): el panel ocupa toda la ventana, siempre abierto,
   *  y el Detallado se actualiza solo cada 2 s. */
  let { detached = false }: { detached?: boolean } = $props();

  type View = 'friendly' | 'detail';
  const RECENT_MS = 8000;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ICON = {
    pin: '<path d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M12 15v5"/>',
    clear: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    min: '<path d="M6 9l6 6 6-6"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
    detach: '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
  };
  const svg = (paths: string, size = 14): string =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const hhmmss = (d: Date): string => d.toLocaleTimeString('es-AR', { hour12: false });
  const LEVELS: [string, string][] = [['all', tr('Todos los niveles')], ['warn', tr('Avisos y errores')], ['info', tr('Info')], ['debug', tr('Debug / verbose')]];
  /** Nivel de una línea del log de tracing ("2026-…Z  INFO streamonte_core::…: mensaje"). */
  const levelOf = (l: string): string => (/\b(ERROR|WARN)\b/.test(l) ? 'warn' : /\b(DEBUG|TRACE)\b/.test(l) ? 'debug' : 'info');

  let root: HTMLElement;
  let line: HTMLButtonElement;
  let list = $state<HTMLElement>();
  let detail = $state<HTMLElement>();
  let view = $state<View>('friendly');
  let filter = $state('all');
  let pinned = $state(false);
  let newChip = $state(false);
  let groups = $state.raw<{ line: string; n: number }[]>([]);
  /** "Limpiar" del Detallado: solo se muestran las líneas con fecha igual o posterior (el archivo no se toca). */
  let detailSince = '';
  /** Reloj para "pasó hace poco": se adelanta con un timer al vencer los 8 s. */
  let now = $state(Date.now());

  const lines = $derived(activityLog.lines);
  const last = $derived(activityLog.last);
  const busy = $derived(busyText(live.v));
  const recent = $derived(now - activityLog.lastAt < RECENT_MS);
  const panel = $derived(activityLog.open ? 'open' : busy || recent ? 'line' : lines.length ? 'mini' : 'hidden');
  /** Lo último que pasó (si fue hace poco); si no, el resumen de lo que corre. */
  const text = $derived((recent && last?.text) || busy || last?.text || '');
  const area = $derived(last?.area ?? 'general');
  const options = $derived<[string, string][]>(view === 'friendly'
    ? [['all', tr('Todos los tipos')], ...Object.entries(AREA).filter(([a]) => lines.some((x) => x.area === a)).map(([a, [name]]): [string, string] => [a, name])]
    : LEVELS);
  const unseen = $derived(activityLog.unseen);

  $effect(() => {
    const wait = activityLog.lastAt + RECENT_MS - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => (now = Date.now()), wait + 50);
    return () => clearTimeout(timer);
  });

  // Señal visual chica de que llegó algo nuevo (sin abrir nada).
  $effect(() => {
    if (!activityLog.added || reduceMotion) return;
    line.classList.remove('bump');
    void line.offsetWidth;
    line.classList.add('bump');
  });

  const atBottom = (): boolean => !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 12;
  function stickToBottom(force: boolean): void {
    if (!list) return;
    if (force || atBottom()) { list.scrollTop = list.scrollHeight; newChip = false; } else newChip = true;
  }
  // Con el panel abierto, cada línea nueva baja la lista si ya estaba abajo; si no, aparece "↓ nuevas".
  $effect.pre(() => {
    void activityLog.lines;
    if (!activityLog.open) return;
    const keep = atBottom();
    void tick().then(() => stickToBottom(keep));
  });

  function setView(v: View): void {
    view = v;
    filter = 'all';
    if (v === 'detail') void loadDetail();
    else void tick().then(() => stickToBottom(true));
  }

  /** Trae el log del núcleo; las líneas seguidas con el mismo mensaje se agrupan en una con ×N. */
  async function loadDetail(): Promise<void> {
    const all: string[] = await core.logsTail(2000).catch(() => []);
    // Las líneas sin fecha (continuación de un mensaje largo) siguen a la anterior.
    let keep = !detailSince;
    const raw = all.filter((l) => { const at = /^\d{4}-\d\d-\d\dT\S+/.exec(l)?.[0]; if (at) keep = !detailSince || at >= detailSince; return keep; });
    const msg = (l: string): string => l.replace(/^\S+\s+/, ''); // sin la fecha: así se ven iguales las repetidas
    const out: { line: string; n: number }[] = [];
    for (const l of raw) {
      const prev = out[out.length - 1];
      if (prev && msg(prev.line) === msg(l)) { prev.n += 1; prev.line = l; } else out.push({ line: l, n: 1 });
    }
    groups = out;
    await tick();
    if (detail) detail.scrollTop = detail.scrollHeight;
  }

  /** "Descargar logs": el núcleo copia sus logs y esto (lo que se ve en Resumen) a Descargas. */
  async function exportLogs(): Promise<void> {
    const friendly = lines.map((x) => `${hhmmss(x.at)} [${AREA[x.area][0]}] ${x.text}${x.n > 1 ? ` ×${x.n}` : ''}`).join('\n');
    try {
      const dir = await core.exportLogs(friendly);
      activity.push({ area: 'general', text: tr('Logs guardados en {dir}', { dir }) });
    } catch (e) {
      activity.push({ area: 'general', level: 'error', text: (e as { message?: string } | null)?.message ?? String(e) });
    }
  }

  function openPanel(): void {
    activityLog.open = true;
    activityLog.unseen = 0;
    setView(view);
    void tick().then(() => { stickToBottom(true); (view === 'friendly' ? list : detail)?.focus({ preventScroll: true }); });
  }
  function close(refocus: boolean): void {
    activityLog.open = false;
    now = Date.now();
    if (refocus) line.focus();
  }
  function clear(): void {
    activityLog.clear();
    newChip = false;
    list?.focus();
  }
  function clearDetail(): void {
    detailSince = new Date().toISOString();
    groups = [];
    detail?.focus();
  }
  /** Ventana aparte con solo la Actividad (si ya está abierta, la trae al frente). */
  async function detach(): Promise<void> {
    try {
      await core.openLogsWindow();
      close(false);
    } catch (e) {
      activity.push({ area: 'general', level: 'error', text: (e as { message?: string } | null)?.message ?? String(e) });
    }
  }
  if (detached) openPanel();
  // En la ventana aparte el Detallado sigue en vivo (se lee el log cada 2 s, sin mover la vista si no está abajo).
  $effect(() => {
    if (!detached || view !== 'detail') return;
    const timer = setInterval(() => { if (!detail || detail.scrollHeight - detail.scrollTop - detail.clientHeight < 12) void loadDetail(); }, 2000);
    return () => clearInterval(timer);
  });

  function onFilter(ev: Event): void {
    filter = (ev.currentTarget as HTMLSelectElement).value;
    if (view === 'friendly') void tick().then(() => stickToBottom(true));
    else if (detail) detail.scrollTop = detail.scrollHeight;
  }

  const pinTip = $derived(pinned ? tr('Fijada: tocá para que se cierre al tocar afuera') : tr('Fijar: que no se cierre al tocar afuera'));
</script>

<svelte:document onpointerdowncapture={(ev) => { if (!detached && activityLog.open && !pinned && !root.contains(ev.target as Node)) close(false); }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div id="act" class="act" class:detached class:is-busy={!!busy} class:warn={!busy && last?.level === 'warn'} class:error={!busy && last?.level === 'error'}
  data-state={panel} bind:this={root} onkeydown={(ev) => { if (ev.key === 'Escape' && activityLog.open && !detached) { ev.stopPropagation(); close(true); } }}>
  <button type="button" id="btn-activity" class="act-line" aria-expanded={activityLog.open} aria-controls="act-panel" bind:this={line}
    aria-label={tr('Actividad: {a}{b}. {c}', { a: text || tr('nada en curso'), b: unseen ? tr(', {unseen} nuevas', { unseen }) : '', c: activityLog.open ? tr('Cerrar') : tr('Ver detalle') })}
    data-tip={activityLog.open ? tr('Cerrar la actividad') : tr('Ver todo lo que pasa de fondo')}
    onclick={() => (activityLog.open ? close(false) : openPanel())}>
    <i class="act-dot" aria-hidden="true"></i>
    <span class="act-ic {area}">{@html busy ? '' : svg(AREA[area][1], 13)}</span>
    <span class="act-sum">{text}</span>
    <b class="act-n" hidden={!unseen || activityLog.open}>{unseen > 99 ? '99+' : unseen}</b>
    <span class="act-chev" aria-hidden="true">{@html svg('<path d="M6 9l6 6 6-6"/>', 12)}</span>
  </button>
  <div class="act-panel" id="act-panel" role="region" aria-labelledby="act-title">
    <div class="act-h">
      <span class="act-title" id="act-title">{tr('Actividad')}</span>
      <div class="act-tabs" role="tablist">
        <button type="button" id="act-tab-friendly" class="act-tab" role="tab" aria-selected={view === 'friendly'} onclick={() => setView('friendly')}>{tr('Resumen')}</button>
        <button type="button" id="act-tab-detail" class="act-tab" role="tab" aria-selected={view === 'detail'} onclick={() => setView('detail')}>{tr('Detallado')}</button>
      </div>
      <span class="act-sum">{busy}</span>
      <select id="act-filter" class="act-filter" aria-label={tr('Filtrar')} value={filter} onchange={onFilter}>
        {#each options as [value, label] (value)}<option {value}>{label}</option>{/each}
      </select>
      <button type="button" id="act-refresh" class="act-b" hidden={view !== 'detail'} aria-label={tr('Actualizar el log detallado')} data-tip={tr('Actualizar el log detallado')} onclick={loadDetail}>{@html svg(ICON.refresh)}</button>
      <button type="button" id="act-export" class="act-b" aria-label={tr('Descargar logs (para debuguear)')} data-tip={tr('Descargar logs (para debuguear)')} onclick={exportLogs}>{@html svg(ICON.download)}</button>
      <button type="button" id="act-detach" class="act-b" hidden={detached} aria-label={tr('Abrir en otra ventana')} data-tip={tr('Abrir en otra ventana')} onclick={detach}>{@html svg(ICON.detach)}</button>
      <button type="button" id="act-pin" class="act-b" hidden={detached} aria-pressed={pinned} aria-label={pinTip} data-tip={pinTip} onclick={() => (pinned = !pinned)}>{@html svg(ICON.pin)}</button>
      <button type="button" id="act-clear" class="act-b" hidden={view !== 'friendly'} aria-label={tr('Vaciar la lista')} data-tip={tr('Vaciar la lista')} onclick={clear}>{@html svg(ICON.clear)}</button>
      <button type="button" id="act-clear-detail" class="act-b" hidden={view !== 'detail'} aria-label={tr('Limpiar la vista (el archivo de log no se borra)')} data-tip={tr('Limpiar la vista (el archivo de log no se borra)')} onclick={clearDetail}>{@html svg(ICON.clear)}</button>
      <button type="button" id="act-close" class="act-b" hidden={detached} aria-label={tr('Cerrar')} data-tip={tr('Cerrar')} onclick={() => close(true)}>{@html svg(ICON.min)}</button>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <ol class="act-list" tabindex="0" aria-label={tr('Lo que está pasando, lo más nuevo abajo')} aria-live="off" hidden={view !== 'friendly'} bind:this={list}
      onscroll={() => { if (atBottom()) newChip = false; }}>
      {#each lines as x (x.id)}
        <li class="act-l {x.level}" class:in={!reduceMotion} data-area={x.area} hidden={filter !== 'all' && x.area !== filter}>
          <time datetime={x.at.toISOString()}>{hhmmss(x.at)}</time>
          <span class="act-ic {x.area}" role="img" aria-label={AREA[x.area][0]}>{@html svg(AREA[x.area][1])}</span>
          <span class="act-msg">{x.text}</span>
          <span class="act-rep">{x.n > 1 ? `×${x.n}` : ''}</span>
        </li>
      {/each}
    </ol>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <ol class="act-list act-detail" tabindex="0" aria-label={tr('Log detallado del núcleo, lo más nuevo abajo')} hidden={view !== 'detail'} bind:this={detail}>
      {#each groups as g, i (i)}
        <li class="act-d {levelOf(g.line)}" data-level={levelOf(g.line)} hidden={filter !== 'all' && levelOf(g.line) !== filter}>{g.line}{#if g.n > 1}<span class="act-rep"> ×{g.n}</span>{/if}</li>
      {/each}
    </ol>
    <button type="button" id="act-new" class="act-new" hidden={!newChip} onclick={() => stickToBottom(true)}>{tr('↓ nuevas')}</button>
  </div>
  <div class="sr" aria-live="polite">{activityLog.said}</div>
</div>
