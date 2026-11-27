// Reproducir (FR-09b): un panel con pasos anclado al botón Ver (reproductor, audio y, en el catálogo,
// subtítulos) y abre el reproductor con lo elegido.
import * as core from './core.ts';
import { activity, live } from './live.svelte.ts';
import { titleOf } from './live.ts';
import { $, el, icon, setStatus, showError, type ElChild } from './dom.ts';
import type { AudioOption, LibraryRow, PlayerKind } from './types.ts';
import { blockTips, wantTip } from './tooltip.ts';
import { dismiss } from '$ui/components/dismiss.ts';
import { t } from './i18n.ts';

/** Una opción de un paso con botones. */
type WizardOpt = { label: string; sub?: string | null; art?: HTMLElement; tip?: string | null; value?: string; eyebrow?: string };
/** Resultados por `id` de paso: índice elegido (paso con `opts`) o lo que pase `next(valor)` un paso propio.
 *  Borde: cada paso propio devuelve lo suyo. */
export type WizardResults = Record<string, any>;
/** Un paso: con `opts` (botones; valor = índice) o `render(next)` (dibuja lo suyo y llama `next(valor)`). */
export type WizardStep = { id: string; title: string; name?: string; opts?: WizardOpt[]; big?: boolean; render?: (next: (value?: unknown) => void) => ElChild; skip?: (r: WizardResults) => boolean };
type Wizard = { steps: WizardStep[]; i: number; results: WizardResults; resolve: (r: WizardResults | undefined) => void; ctx: string | null };
export type PlayStart = (player: PlayerKind | null, audio: { code: string; aid: number | null } | null) => Promise<boolean | undefined> | boolean | undefined;

// ---------- Reproducir: un solo panel con pasos, anclado al ▶ (2026-11-18) ----------
// Reproductor → audio → subtítulos (los que no aplican se saltean). Cada paso entra deslizándose; "‹" vuelve al
// anterior. Elegir en el último cierra el panel y resuelve con lo elegido; cerrar (Esc, clic afuera) cancela.
// Diseño (2026-11-27, docs/mockups/subs-step/index.html?v=A&ui=neu): neumórfico; arriba ‹, título, qué se va a ver y la
// barra de pasos con su nombre; el recomendado es una tarjeta elevada con el primario sólido ámbar (carbón, variante B
// 2026-11-27, docs/mockups/carbon-neu/index.html?v=b) y el resto una lista gris. ‹ = botón redondo neu en su aro hundido.
const pkBack = el('button', { id: 'pk-back', type: 'button', class: 'pk-back nu-round', 'aria-label': t('Paso anterior') }, icon('arrow', 14));
const pkCtx = el('div', { class: 'pk-ctx' });
const pkSteps = el('div', { class: 'pk-steps' });
const pkBody = el('div', { class: 'pk-l' });
const pk = el('div', { id: 'pk', class: 'pk', role: 'dialog', 'aria-labelledby': 'pkh' },
  el('div', { class: 'pk-top' }, el('span', { class: 'pk-ring nu-ring' }, pkBack), el('h2', { class: 'pk-h', id: 'pkh' }), pkCtx, pkSteps), pkBody);
pk.hidden = true;
document.body.append(pk);
let pkBtn: HTMLElement | null = null;
let pkT: ReturnType<typeof setTimeout> | undefined;
/** El flujo abierto. */
let wiz: Wizard | null = null;

function closePk(refocus: boolean, instant?: boolean): void {
  if (!pkBtn) return;
  pk.classList.remove('on');
  pkBtn.setAttribute('aria-expanded', 'false');
  if (refocus) pkBtn.focus({ preventScroll: true });
  pkBtn = null;
  blockTips(false);
  clearTimeout(pkT);
  if (instant) pk.hidden = true; else pkT = setTimeout(() => (pk.hidden = true), 160);
  const w = wiz;
  wiz = null;
  w?.resolve(undefined);
}
/** Cierra el panel de Reproducir si está abierto (cancela). */
export const closeWizard = () => closePk(false);

/** El botón en la página: la lista del catálogo se redibuja mientras se prepara (2026-11-16) y el tocado ya no está
 *  (su posición daría 0,0). Se usa el que lo reemplazó: mismo `id`, o mismo `data-anchor` (▶ → Cancelar). */
function liveBtn(btn: HTMLElement): HTMLElement {
  if (btn.isConnected) return btn;
  return (btn.id && document.getElementById(btn.id))
    || (btn.dataset?.anchor && document.querySelector<HTMLElement>(`[data-anchor="${btn.dataset.anchor}"]`)) || btn;
}

/** Ubica el panel junto a su botón (abajo, o arriba si no entra); se repite al cambiar de paso. */
function place(): void {
  if (!pkBtn) return;
  pkBtn = liveBtn(pkBtn);
  const r = pkBtn.getBoundingClientRect();
  const w = pk.offsetWidth;
  const hgt = pk.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
  const up = r.bottom + 8 + hgt > innerHeight - 8 && r.top - hgt - 8 > 8;
  pk.classList.toggle('up', up);
  pk.style.left = `${left}px`;
  pk.style.top = `${Math.max(8, up ? r.top - hgt - 8 : r.bottom + 8)}px`;
  pk.style.transformOrigin = `${r.left + r.width / 2 - left}px ${up ? '100%' : '0'}`;
}

/** Dibuja el paso actual. `dir`: 1 = avanzó, -1 = volvió, 0 = mismo paso actualizado (sin animación). */
function renderStep(dir: number): void {
  if (!wiz) return;
  const w = wiz;
  const step = w.steps[w.i];
  pk.querySelector('.pk-h')!.textContent = step.title;
  pk.classList.toggle('big', !!step.big || !!step.render || w.steps.length > 1);
  pkBack.disabled = w.i === 0;
  pkCtx.textContent = w.ctx ?? '';
  pkCtx.hidden = !w.ctx;
  pkSteps.hidden = w.steps.length < 2;
  pkSteps.setAttribute('aria-label', t('Paso {a} de {b}', { a: w.i + 1, b: w.steps.length }));
  pkSteps.replaceChildren(...(w.steps.length > 1 ? w.steps.map((s, i) => el('span', { class: i === w.i ? 'on' : i < w.i ? 'done' : '' }, `${i + 1} · ${s.name ?? s.title}`)) : []));
  // El primero (recomendado o preseleccionado) es la tarjeta con el primario sólido (▶ en el último paso, › antes); el resto,
  // filas grises con "Usar" al pasar el mouse.
  const last = w.i === w.steps.length - 1;
  const content = step.render ? step.render(next) : (step.opts ?? []).map((o, i) => el('button', {
    id: `pk-o-${step.id}-${i}`, class: `pk-o${i ? '' : ' pri'}`, type: 'button', 'data-i': String(i), ...(o.tip ? { 'data-tip': o.tip } : {}),
    onclick: () => next(i),
  }, o.art ?? icon('speaker', 18), el('span', {}, o.eyebrow && !i ? el('em', {}, o.eyebrow) : null, el('b', {}, o.label), o.sub ? el('small', {}, o.sub) : null),
  i ? el('span', { class: 'pk-end', 'aria-hidden': 'true' }, t('Usar')) : el('span', { class: 'pk-go nu-solid' }, icon(last ? 'play' : 'next', 18))));
  pkBody.replaceChildren(...([content].flat(2).filter(Boolean) as (string | Node)[]));
  pkBody.classList.remove('step-next', 'step-prev');
  if (dir) { void pkBody.offsetWidth; pkBody.classList.add(dir > 0 ? 'step-next' : 'step-prev'); }
  place();
  if (dir || !pk.contains(document.activeElement)) (pkBody.querySelector<HTMLElement>('button:not([disabled])') ?? pk).focus({ preventScroll: true });
}
/** El paso siguiente (o anterior, `dir` -1) que aplica con lo elegido hasta ahora (`skip`), o -1. */
function stepFrom(i: number, dir: number): number {
  if (!wiz) return -1;
  for (let j = i + dir; j >= 0 && j < wiz.steps.length; j += dir) if (!wiz.steps[j].skip?.(wiz.results)) return j;
  return -1;
}
function next(value?: unknown): void {
  if (!wiz) return;
  wiz.results[wiz.steps[wiz.i].id] = value;
  const j = stepFrom(wiz.i, 1);
  if (j >= 0) { wiz.i = j; renderStep(1); return; }
  const w = wiz;
  wiz = null;
  closePk(true);
  w.resolve(w.results);
}
pkBack.addEventListener('click', () => { const j = wiz ? stepFrom(wiz.i, -1) : -1; if (wiz && j >= 0) { wiz.i = j; renderStep(-1); } });
// Un paso propio (subtítulos) avisa que cambió lo que muestra: se redibuja sin animar.
document.addEventListener('subs-changed', () => { if (wiz?.steps[wiz.i].render) renderStep(0); });

/** Abre el panel junto a `btn` con sus pasos y resuelve con `{[id]: valor}` o `undefined` (se cerró). Cada paso:
 *  `{id, title, name?, opts: [{label, sub?, art?, tip?, eyebrow?}], big?}` (valor = índice elegido) o `{id, title, name?, render(next)}`
 *  (dibuja lo suyo y llama `next(valor)` para seguir); `skip(resultados)`: no aplica con lo elegido antes. `name`: en la
 *  barra de pasos. `ctx`: qué se va a ver (título · calidad), debajo del título. */
export function openWizard(btn: HTMLElement, steps: WizardStep[], ctx: string | null = null): Promise<WizardResults | undefined> {
  const anchor = liveBtn(btn);
  if (pkBtn) closePk(false, true);
  wantTip(null);
  clearTimeout(pkT);
  pk.hidden = false;
  pk.classList.remove('on', 'up');
  pkBtn = anchor;
  blockTips(true);
  anchor.setAttribute('aria-expanded', 'true');
  const done = new Promise<WizardResults | undefined>((resolve) => { wiz = { steps, i: 0, results: {}, resolve, ctx }; });
  renderStep(0);
  void pk.offsetWidth; // arranca la transición desde el estado cerrado
  pk.classList.add('on');
  return done;
}

pk.addEventListener('keydown', (ev) => {
  const os = [...pk.querySelectorAll<HTMLElement>('.pk-o')];
  const i = os.indexOf(document.activeElement as HTMLElement);
  if (os.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    ev.preventDefault();
    os[(i + (ev.key === 'ArrowDown' ? 1 : -1) + os.length) % os.length].focus();
  }
});
dismiss(pk, {
  onDismiss: (by) => (by === 'escape' ? (pkBtn ? closePk(true) : wantTip(null)) : closePk(false)),
  active: (by) => by === 'escape' || !!pkBtn,
  ignore: (target) => !!pkBtn && liveBtn(pkBtn).contains(target),
});
// Scroll de la página (no el de adentro del panel): el ▶ se movió y el panel lo sigue. Cerrarlo acá lo cerraba solo:
// la lista del catálogo se redibuja mientras se prepara y al restaurar su scroll dispara este evento (2026-11-18).
document.addEventListener('scroll', (ev) => { if (pkBtn && !pk.contains(ev.target as Node)) place(); }, { capture: true, passive: true });

// Idioma original (2026-11-16): va primero en el selector. Manda el de TMDB (con key); sin él, se
// adivina por el país de Cinemeta. Solo los casos que el selector ofrece (Latino / Inglés /
// Español); el resto no cambia el orden.
const EN = ['United States', 'USA', 'United Kingdom', 'UK', 'Canada', 'Australia', 'Ireland', 'New Zealand'];
const LAT = ['Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Venezuela', 'Uruguay', 'Paraguay', 'Bolivia', 'Ecuador', 'Cuba', 'Guatemala', 'Costa Rica', 'Puerto Rico', 'Dominican Republic'];
/** Código de audio del idioma original (`en`, `lat`, `es`) o null. `lang`: ISO 639-1 de TMDB;
 *  el país (primero de la lista) solo decide si falta, o entre Latino y España si es español. */
export function originalAudio(country: string | null | undefined, lang: string | null | undefined): string | null {
  const first = country?.split(',')[0].trim() ?? '';
  if (lang === 'es') return first === 'Spain' ? 'es' : 'lat';
  if (lang) return lang === 'en' ? 'en' : null;
  return EN.includes(first) ? 'en' : LAT.includes(first) ? 'lat' : first === 'Spain' ? 'es' : null;
}

/** Audios para elegir si el video trae más de uno (si no, `null`): ordenados y con etiquetas cortas por el núcleo
 *  (`audio::play_options`); `original`, el código del idioma original, va primero (el preseleccionado). */
function audioOptions(e: LibraryRow | undefined | null, original: string | null): AudioOption[] | null {
  const base = e?.audio_options ?? [];
  const opts = original ? [...base].sort((a, b) => Number(b.code === original) - Number(a.code === original)) : base;
  return opts.length < 2 ? null : opts;
}

/** Qué se va a ver, debajo del título del panel: "Dune · 2160p BluRay REMUX". */
export function wizardCtx(entry: LibraryRow): string {
  const r = entry.release;
  const ep = r?.season != null && r?.episode != null ? ` T${r.season}·E${r.episode}` : '';
  return [`${r?.title || entry.name}${ep}`, (r?.quality ?? []).join(' ')].filter(Boolean).join(' · ');
}

/** Con VLC instalado y un mpv que anda (2026-11-17), con cuál: se pregunta en CADA ▶, también al retomar
 *  (2026-11-20, no se recuerda). Con uno solo no hay qué elegir: `null` (el núcleo usa el que haya). mpv primero. */
async function playerOptions(): Promise<(WizardOpt & { value: PlayerKind })[] | null> {
  const p = await core.playersStatus().catch(() => null);
  if (!p?.vlc || !p.mpv) return null;
  return [
    { value: 'mpv', label: 'mpv', eyebrow: t('Recomendado'), sub: t('Más liviano · combina subtítulos · ecualizador'), art: playerArt('mpv') },
    { value: 'vlc', label: 'VLC', sub: t('El clásico, sin subtítulos combinados'), art: playerArt('vlc') },
  ];
}
/** Dibujito de cada reproductor (inline, sin archivos): mpv, un disco con ▶; VLC, el cono naranja. */
function playerArt(kind: PlayerKind): HTMLSpanElement {
  const span = el('span', { class: `pk-art ${kind}`, 'aria-hidden': 'true' });
  span.innerHTML = kind === 'mpv'
    ? '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#4b2a8a"/><circle cx="24" cy="24" r="15" fill="#6a3fc4"/><path d="M20 16v16l13-8z" fill="#fff"/></svg>'
    : '<svg viewBox="0 0 48 48"><path d="M19 6h10l9 34H10z" fill="#ff8800"/><path d="M16.4 16h15.2l1.6 6H14.8zM13.8 26h20.4l1.6 6H12.2z" fill="#fff"/><rect x="6" y="38" width="36" height="5" rx="2.5" fill="#d96f00"/></svg>';
  return span;
}

/** El audio ya decidido en el catálogo (2026-11-18), sin preguntar: `prefer` 'original' = el del idioma original
 *  (si no se reconoce, el primero que no es español); 'lat' = el latino confirmado en las pistas (si no hay, se
 *  pregunta). Índice en `opts` o -1. */
function preferredAudio(opts: AudioOption[], prefer: string | null, original: string | null): number {
  if (prefer === 'lat') return opts.findIndex((o) => o.code === 'lat' && o.confirmed);
  if (prefer !== 'original') return -1;
  const i = original ? opts.findIndex((o) => o.code === original) : -1;
  return i >= 0 ? i : Math.max(0, opts.findIndex((o) => !['lat', 'cast', 'es'].includes(o.code)));
}
const SPANISH = new Set(['lat', 'cast', 'es']);

/** Preparar la reproducción en un solo panel con pasos: reproductor → audio → subtítulos → abrirlo. Es el único
 *  camino al reproductor. `entry`: la fila, si el que llama la tiene antes de que llegue su evento (catálogo).
 *  `original`: código de audio del idioma original (`originalAudio`), primero. `subsStep(next)`: el paso de
 *  subtítulos (catálogo, 2026-11-18). `start(player, audio)`: cómo se abre (catálogo: motor o TorBox); sin él, por
 *  el motor. `prefer` ('original' | 'lat' | null): el audio ya elegido en el catálogo (`preferredAudio`); con audio
 *  en español no hay paso de subtítulos (el núcleo los deja ocultos). Devuelve `true` si el núcleo aceptó el pedido
 *  (no si se canceló o falló). */
export async function play(key: string, anchor: HTMLElement | null | undefined, entry: LibraryRow | null | undefined = live.v.entries.get(key),
  original: string | null = null, subsStep: WizardStep['render'] | null = null, start: PlayStart | null = null, prefer: string | null = null): Promise<boolean | undefined> {
  try {
    // Si ESTE video ya está en el panel (pausado) se retoma con el audio que se eligió la otra
    // vez (el reproductor se pregunta igual). Otro episodio del mismo pack no cuenta: es otra clave.
    const resuming = [...live.v.playbacks.values()].some((p) => p.key === key);
    const players = await playerOptions();
    const audios = resuming ? null : audioOptions(entry, original);
    const decided = audios ? preferredAudio(audios, prefer, original) : -1;
    const audioOf = (r: WizardResults): AudioOption | null => audios?.[r.audio ?? decided] ?? null;
    const stepsRaw: (WizardStep | null | false)[] = [
      players && { id: 'player', title: t('¿Con qué lo abrimos?'), name: t('Reproductor'), big: true, opts: players },
      // Solo se aclara lo confirmado por el análisis (2026-11-17: "adivinado por el nombre" era ruido).
      audios && decided < 0 && { id: 'audio', title: t('Elegí el audio'), name: t('Audio'), opts: audios.map((o) => ({ label: o.label, sub: o.confirmed ? t('Pista confirmada') : null,
        tip: SPANISH.has(o.code) ? t('En español: va sin subtítulos (S los muestra).') : null })) },
      !resuming && subsStep && { id: 'subs', title: t('Subtítulos'), name: t('Subtítulos'), render: subsStep, skip: (r) => SPANISH.has(audioOf(r)?.code ?? '') },
    ];
    const steps = stepsRaw.filter(Boolean) as WizardStep[];
    const shown = steps.filter((s) => !s.skip?.({}));
    const got = shown.length ? await openWizard(anchor ?? $('.topbar'), shown, entry ? wizardCtx(entry) : null) : {};
    if (!got) return;
    const player = got.player != null && players ? players[got.player].value : null;
    const a = audioOf(got);
    const audio = a ? { code: a.code, aid: a.aid } : null;
    anchor?.classList.add('busy');
    activity.push({ area: 'reproduccion', text: t(resuming ? 'Retomando {a}{b}…' : 'Abriendo {a}{b}…', { a: titleOf(live.v, key), b: audio?.code ? audio.code === 'lat' ? t(' con audio latino') : audio.code === 'en' ? t(' con audio en inglés') : t(' con audio {a}', { a: audio.code }) : '' }) });
    if (start) return await start(player, audio);
    await core.play(key, player, null, audio);
    setStatus('Cargando…');
    return true;
  } catch (e) {
    showError(e);
  } finally {
    anchor?.classList.remove('busy');
  }
}
