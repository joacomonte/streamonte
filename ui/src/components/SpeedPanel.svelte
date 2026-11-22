<!-- Menú "Tu conexión": velocidad de internet, aporte por seeder (calibración), entrantes, fidelidad y mediciones.
     Se monta dentro del popover de top-menus.js y se redibuja con el medidor y con `health-calib-changed`. -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ago, mbps, nf1 } from '$ui/format.ts';
  import { setStatus } from '../dom.js';
  import { t } from '../i18n.js';
  import {
    DEFAULT_SEED_MBPS, MIN_SAMPLES, TRACKER_MIN, fidelity, healthCalibration, incomingStatus, measuringNow, predict, recalibrate, resetCalibration, setSeedMbps
  } from '../health-calib.js';
  import { fmtMbps } from '../speed-model.ts';
  import { speedStore } from '../speed-instance.ts';
  import { state as appState } from '../state.js';
  import type * as Raw from '../types.js';
  import Gauge from './Gauge.svelte';

  let snap = $state(speedStore.snapshot());
  /** Sube con cada `health-calib-changed`: la calibración vive en localStorage, no es reactiva. */
  let version = $state(0);
  let seedInput = $state('');
  onMount(() => {
    const off = speedStore.subscribe(() => (snap = speedStore.snapshot()));
    const bump = (): number => version++;
    window.addEventListener('health-calib-changed', bump);
    return () => { off(); window.removeEventListener('health-calib-changed', bump); };
  });

  const view = $derived(snap.view);
  const measuring = $derived(view.kind === 'measuring');
  const cal = $derived.by(() => { void version; return healthCalibration(appState.entries.values()); });
  const now = $derived.by(() => { void version; return measuringNow(); });
  const inc = $derived.by(() => { void version; return incomingStatus(); });
  const fid = $derived(fidelity(cal.learnable, cal.capFrom === 'test' ? cal.capMbps : null));
  const fidOk = $derived(!!fid && fid.n >= 8 && Math.abs(fid.biasAfter) <= Math.log(1.5) && fid.hits / fid.n >= 0.75 && fid.pessimistic / fid.n <= 0.1);
  const tracks = $derived(calibTracks(cal));
  const doneCount = $derived(tracks.filter((x) => x.have >= x.goal).length);

  /** Progreso de cada calibración: segmentos hasta la meta, que es cuando esa evidencia pasa a confiarse (MIN_SAMPLES)
   *  o, la de trackers, a mostrar salud sola (TRACKER_MIN). */
  function calibTracks(c: Raw.HealthCalibration): { id: Raw.HealthKind; label: string; value: string; goal: number; reward: string; have: number }[] {
    const list = [
      { id: 'counted' as const, label: t('Seeders contados'), value: t('{a} Mbps c/u', { a: nf1(c.seedMbps) }), goal: MIN_SAMPLES, reward: t('Calibrado') },
      { id: 'tracker' as const, label: t('Seeders de trackers'), value: t('{a} Mbps c/u', { a: nf1(c.trackerSeedMbps) }), goal: TRACKER_MIN, reward: t('Ya estima salud') },
      { id: 'measured' as const, label: t('Medición del análisis'), value: `×${nf1(c.measuredFactor)}`, goal: MIN_SAMPLES, reward: t('Calibrado') }
    ];
    return list.map((x) => ({ ...x, have: Math.min(x.goal, Math.round(c.bias[x.id]?.nEff ?? 0)) }));
  }

  /** Nombre de una medición: el del torrent en la biblioteca (las viejas guardaban el hash). */
  function nameOf(l: Raw.HealthMeasurement): string {
    const e = [...appState.entries.values()].find((x) => x.info_hash === l.hash);
    const name = e?.torrent_name || e?.name || l.name;
    return !name || /^[0-9a-f]{40}$/i.test(name) ? t('Torrent sin nombre') : name;
  }

  function sampleText(l: Raw.HealthMeasurement): string {
    if (!l.ev) return t('{seeds} seeders · {a} · {b} por seeder · {c}', { seeds: l.seeds, a: mbps(l.avg_speed_bps), b: nf1((l.avg_speed_bps * 8) / 1e6 / (l.seeds ?? 0)), c: ago(l.measured_at) });
    const p = predict(l.ev, { bias: {}, capMbps: null })?.p50;
    const real = l.real_mbps ?? 0;
    if (p == null) return t('real {a} Mbps · sin predicción · {b}', { a: nf1(real), b: ago(l.measured_at) });
    return t('predijo {a} → real {b} Mbps (×{c}) · reales {real_seeds} seeders / {real_peers} peers ({real_incoming} entrantes){d} · {e}', { a: nf1(p), b: nf1(real), c: nf1(real / p), real_seeds: l.real_seeds, real_peers: l.real_peers, real_incoming: l.real_incoming, d: l.short ? t(' · corta') : '', e: ago(l.measured_at) });
  }

  const dir = (x: number): string => (x < 0 ? t('pesimista ×{a}', { a: nf1(Math.exp(-x)) }) : t('optimista ×{a}', { a: nf1(Math.exp(x)) }));

  async function startEdit(): Promise<void> {
    seedInput = String(Math.round(cal.seedMbps * 10) / 10);
    speedStore.setEditing(true);
    await tick();
    document.getElementById('speed-seed-input')?.focus();
  }
  function fixSeed(): void {
    const v = Number(seedInput);
    if (!(v > 0)) { setStatus(t('Poné un número mayor a 0.')); return; }
    speedStore.setEditing(false);
    setSeedMbps(v);
  }
  function useMeasured(): void {
    speedStore.setEditing(false);
    recalibrate();
  }
  function forget(): void {
    speedStore.setEditing(false);
    resetCalibration();
    setStatus(t('Mediciones olvidadas: se vuelve a calibrar con las próximas reproducciones.'));
  }
</script>

<div class="pop-head"><div><h3>{t('Tu conexión')}</h3>
  <p class="pop-sub">{t('Con esto se estima si cada torrent va a andar bien: el ícono de señal y el orden de las opciones.')}</p></div></div>

<div class="conn-card">
  <span class="conn-gauge" aria-hidden="true"><Gauge v={view.mbps ?? 0} size={56} /></span>
  <span class="conn-main">
    <span class="conn-big">{view.kind === 'done' || measuring ? t('{a} Mbps', { a: fmtMbps(view.mbps ?? 0) }) : t('Sin medir')}</span>
    <span class="conn-sub">{#if measuring}{t('Midiendo tu internet…')}{:else if view.kind === 'done'}{t('Tu internet en esta red · medida {a}', { a: ago(view.at) })}{:else if view.kind === 'failed'}{view.message}{:else}{t('Todavía no se midió')}{/if}</span>
  </span>
  <button id="speed-retest" class="pop-btn" disabled={measuring} onclick={() => speedStore.measure(true)}>{measuring ? t('Midiendo…') : t('Medir de nuevo')}</button>
</div>

<div class="conn-card">
  <span class="conn-main">
    <span class="conn-big">{t('{a} Mbps ', { a: nf1(cal.seedMbps) })}<small>{t('por seeder')}</small></span>
    <span class="conn-sub">{cal.source === 'manual' ? t('Fijado a mano') : t('Se aprende solo en esta red (arranca en {DEFAULT_SEED_MBPS} Mbps)', { DEFAULT_SEED_MBPS })}</span>
    <div id="calib-tracks" class="calib">
      <span class="calib-head" class:all={doneCount === tracks.length}>{t('Calibración {doneCount}/{n}', { doneCount, n: tracks.length })}</span>
      {#each tracks as tr (tr.id)}
        {@const done = tr.have >= tr.goal}
        <div id="calib-{tr.id}" class="calib-row" class:done>
          <span class="calib-label">{tr.label}<b>{tr.value}</b></span>
          <span class="calib-steps" role="progressbar" aria-valuenow={tr.have} aria-valuemin={0} aria-valuemax={tr.goal} aria-label={tr.label}>
            {#each Array.from({ length: tr.goal }, (_, i) => i) as i (i)}<i class:on={i < tr.have}></i>{/each}
          </span>
          <span class="calib-state">{done ? tr.reward : t('faltan {a} reprod.', { a: tr.goal - tr.have })}</span>
        </div>
      {/each}
    </div>
    {#if now.length}
      <span class="conn-live"><i aria-hidden="true"></i>{t('Midiendo: {a} · {b}{c}', { a: now[0].name, b: mbps(now[0].avg_speed_bps), c: now[0].ev ? '' : t(' (sin datos del análisis: no cuenta)') })}</span>
    {/if}
  </span>
  {#if snap.editing}
    <span class="conn-edit">
      <input id="speed-seed-input" type="number" min="0.1" step="0.5" inputmode="decimal" aria-label={t('Mbps por seeder')} bind:value={seedInput}>
      <button id="speed-seed-fix" class="pop-btn" onclick={fixSeed}>{t('Fijar')}</button>
      {#if cal.source === 'manual'}<button id="speed-seed-auto" class="pop-btn" onclick={useMeasured}>{t('Usar lo medido')}</button>{/if}
    </span>
  {:else}
    <button id="speed-seed-edit" class="pop-btn" onclick={startEdit}>{t('Cambiar')}</button>
  {/if}
</div>

<div class="conn-card conn-incoming {inc ? (inc.open ? 'open' : 'closed') : ''}">
  <span class="conn-main">
    <span class="conn-title">{inc ? (inc.open ? t('Entrantes: sí') : t('Entrantes: no')) : t('Entrantes: sin datos')}</span>
    <span class="conn-sub">{!inc ? t('Se sabe después de reproducir algo 2 minutos en esta red.')
      : inc.open ? t('Otros peers se conectan a vos: más fuentes para cada torrent. Visto {a}.', { a: ago(inc.at) })
        : t('Tu router no deja entrar conexiones: anda igual, pero con menos peers. Preferí opciones con buena salud; si podés, activá UPnP en el router.')}</span>
  </span>
</div>

<div id="conn-fidelity" class="conn-card" class:ok={fidOk}>
  <span class="conn-main">
    <span class="conn-title">{fid ? t('Fidelidad: acertó {hits} de {n} niveles', { hits: fid.hits, n: fid.n }) : t('Fidelidad: sin datos')}</span>
    <span class="conn-sub">{fid
      ? t('Sin aprender: {a} (error típico ×{b}). Con lo aprendido: {c} (×{d}). Dijo menos de lo que anduvo {pessimistic} veces y más {optimistic}; lo real cayó dentro del rango {inBand} de {n}.', { a: dir(fid.biasBefore), b: nf1(Math.exp(fid.typBefore)), c: dir(fid.biasAfter), d: nf1(Math.exp(fid.typAfter)), pessimistic: fid.pessimistic, optimistic: fid.optimistic, inBand: fid.inBand, n: fid.n })
      : t('Se calcula al reproducir 2 minutos algo cuya salud se mostró.')}</span>
  </span>
</div>

<div class="conn-how">
  <p class="conn-formula">
    <span>{t('seeders × {a}', { a: nf1(cal.seedMbps) })}</span> + <span>{t('leechers × {a}', { a: nf1(cal.seedMbps / 6) })}</span>
    {#if cal.capMbps}{t(' · máx. ')}<span>{t('{a} Mbps', { a: fmtMbps(cal.capMbps) })}</span>{/if}
    ÷ <span>{t('lo que pide el video')}</span>
  </p>
  <p class="conn-legend">
    <b class="good">{t('Buena')}</b>{t(' sobra el doble · ')}<b class="fair">{t('Puede cortarse')}</b>{t(' alcanza apenas · ')}<b class="risky">{t('Mala')}</b>{t(' no alcanza')}
  </p>
  <p class="hint">{t('"Lo que pide" = tamaño del episodio o película ÷ duración. Si ese torrent ya se midió (reproduciendo, cargando en background o al analizarlo), manda lo medido. Cada reproducción (minutos 2 a 5) compara lo que mostró la salud con lo que bajó de verdad y corrige la estimación, aparte para cada red (casa, trabajo…).')}</p>
</div>

<details class="conn-samples">
  <summary>{t('Mediciones ({n})', { n: cal.samples.length })}</summary>
  {#if cal.samples.length}
    <ul class="calib-list">
      {#each cal.samples as l (l.hash + l.measured_at)}<li><b>{nameOf(l)}</b><span>{sampleText(l)}</span></li>{/each}
    </ul>
    <button id="speed-reset" class="link" onclick={forget}>{t('Olvidar mediciones y volver a calibrar')}</button>
  {:else}
    <p class="hint">{t('Todavía ninguna. Se mide sola al ver una opción ya analizada.')}</p>
  {/if}
</details>
