<script lang="ts">
	// Buscador (2026-11-24): al escribir, el fondo se desenfoca y cae un desplegable con todo lo que coincide —películas,
	// series, actores y directores— cada uno con su etiqueta; ya no hay grilla de pósters abajo. Tocar un título lo abre;
	// tocar una persona trae lo que actuó o dirigió (la píldora de la persona sigue igual).
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { IconName } from '../components/icons.ts';
	import type { CatalogItem, PersonHit } from '../types.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		/** Vuelve al catálogo con los filtros, arriba de todo. */
		onclear: () => void;
		/** Escribió algo: la pantalla vuelve arriba y registra la búsqueda. */
		onquery: (raw: string) => void;
		onpick: (p: PersonHit) => void;
		/** Abre un título del desplegable. */
		onopen: (item: CatalogItem) => void;
		/** Con `href` el título es un link (clic del medio); el clic simple igual llama a `onopen`. */
		href?: (item: CatalogItem) => string;
		/** Desplegable abierto (el catálogo deja ver la grilla desenfocada detrás). */
		open?: boolean;
	}
	let { store, onclear, onquery, onpick, onopen, href, open = $bindable(false) }: Props = $props();
	const st = $derived(store.st);

	/** Títulos y personas que entran en el desplegable. */
	const MAX_TITLES = 8;
	const MAX_PEOPLE = 4;

	let input = $state<HTMLInputElement>();
	// `open`: se cierra con Esc, tocando el fondo o eligiendo algo; tocar el buscador lo reabre.
	const typed = $derived(st.q.trim() !== '');
	/** Filtro del desplegable (chips de arriba): todo, películas y series, actores o directores. */
	type Only = 'all' | 'titles' | 'actor' | 'director';
	let only = $state<Only>('all');
	const allTitles = $derived(store.mode() === 'search' ? store.visible() : []);
	const allPeople = $derived(typed ? st.people : []);
	const count: Record<Only, number> = $derived({
		all: allTitles.length + allPeople.length,
		titles: allTitles.length,
		actor: allPeople.filter((x) => x.role !== 'director').length,
		director: allPeople.filter((x) => x.role === 'director').length,
	});
	const FILTERS: { v: Only; label: string; icon: IconName }[] = [
		{ v: 'all', label: 'Todo', icon: 'search' },
		{ v: 'titles', label: 'Películas y series', icon: 'film' },
		{ v: 'actor', label: 'Actores', icon: 'user' },
		{ v: 'director', label: 'Directores', icon: 'video' },
	];
	/** Chips con algo para mostrar ("Todo" siempre; el elegido también, aunque quede en 0 mientras busca). */
	const chips = $derived(FILTERS.filter((f) => f.v === 'all' || f.v === only || count[f.v] > 0));
	/** Con "Todo": los primeros títulos y personas; con un filtro, todos los de ese tipo. */
	const titles = $derived(
		only === 'all' ? allTitles.slice(0, MAX_TITLES) : only === 'titles' ? allTitles : [],
	);
	const people = $derived(
		only === 'all' ? allPeople.slice(0, MAX_PEOPLE) : only === 'actor' ? allPeople.filter((x) => x.role !== 'director') : only === 'director' ? allPeople.filter((x) => x.role === 'director') : [],
	);
	const busy = $derived(typed && (st.pending || st.loading || st.peopleLoading));
	const empty = $derived(typed && !busy && !titles.length && !people.length);
	const show = $derived(open && typed);

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		open = true;
		onquery(e.currentTarget.value);
	}
	function close() {
		open = false;
		input?.blur();
	}
	function key(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		// Sin esto, el input type=search se vacía solo con Esc y queda distinto de `st.q`.
		e.preventDefault();
		// Esc: primero cierra el desplegable; después limpia la búsqueda.
		if (open) close();
		else if (st.q || st.person) onclear();
	}
	function openItem(e: MouseEvent, it: CatalogItem) {
		if (href && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
		e.preventDefault();
		close();
		onopen(it);
	}
	function pickPerson(p: PersonHit) {
		close();
		onpick(p);
	}
	function clear() {
		open = false;
		only = 'all';
		onclear();
		input?.focus();
	}
</script>

{#if show}
	<!-- Fondo desenfocado: tocarlo cierra el desplegable (la búsqueda queda escrita). -->
	<button id="cat-q-backdrop" type="button" class="blur" aria-label={t('Cerrar')} onclick={close}></button>
{/if}

<div class="finder" class:open={show}>
	<label class="search">
		<span class="lead" aria-hidden="true">{#if busy}<span class="spin"></span>{:else}<Icon name="search" size={18} />{/if}</span>
		<input bind:this={input} id="cat-q" type="search" placeholder={t('Título, actor/actriz o director')} autocomplete="off" enterkeyhint="search" role="combobox" aria-expanded={show} aria-controls="cat-q-results" aria-autocomplete="list" value={st.q} {oninput} onfocus={() => typed && (open = true)} onkeydown={key} />
		{#if st.q || st.person}
			<button id="cat-q-clear" type="button" class="clear-q" aria-label={t('Limpiar búsqueda')} onpointerdown={(e) => e.preventDefault()} onclick={clear}><Icon name="close" size={14} /></button>
		{/if}
		{#if busy}<span class="bar" aria-hidden="true"></span>{/if}
	</label>

	{#if show}
		<div id="cat-q-results" class="drop" role="listbox" aria-label={t('Resultados')} aria-busy={busy}>
			<!-- Qué se está buscando: tocar un chip deja solo ese tipo (pointerdown sin foco: el teclado del celu no se cierra). -->
			<div class="filters" role="radiogroup" aria-label={t('Mostrar')}>
				{#each chips as f (f.v)}
					<button id="q-only-{f.v}" type="button" class="filter" role="radio" aria-checked={only === f.v} onpointerdown={(e) => e.preventDefault()} onclick={() => (only = f.v)}>
						<Icon name={f.icon} size={14} />{t(f.label)}{#if f.v !== 'all' && count[f.v]}<span class="n">{count[f.v]}</span>{/if}
					</button>
				{/each}
			</div>
			{#if titles.length || people.length}
				<ul>
					{#each titles as it, i (it.id)}
						<li style:--i={i}>
							{#if href}
								<a id="q-title-{it.id}" class="row" href={href(it)} data-sveltekit-preload-data="tap" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={(e) => openItem(e, it)}>{@render titleRow(it)}</a>
							{:else}
								<button id="q-title-{it.id}" type="button" class="row" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={(e) => openItem(e, it)}>{@render titleRow(it)}</button>
							{/if}
						</li>
					{/each}
					{#each people as p, i (p.id)}
						<li style:--i={titles.length + i}>
							<button id="q-person-{p.id}" type="button" class="row" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pickPerson(p)}>
								<span class="bg" aria-hidden="true" style:background-image={p.photo ? `url('${p.photo}')` : null}></span>
								{#if p.photo}<img class="face" src={p.photo} alt="" width="76" height="76" loading="lazy" />{:else}<span class="face ph" aria-hidden="true"><Icon name="user" size={22} /></span>{/if}
								<span class="who"><b>{p.name}</b><small>{[t(p.role === 'director' ? 'Director' : 'Actor/actriz'), p.known].filter(Boolean).join(' · ')}</small></span>
								<span class="go" aria-hidden="true"><Icon name="next" size={18} /></span>
							</button>
						</li>
					{/each}
				</ul>
				{#if busy}<p class="more" aria-live="polite">{t('Buscando…')}</p>{/if}
			{:else if busy}
				<ul aria-hidden="true">
					{#each Array(4) as _, i (i)}
						<li class="sk" style:--i={i}><span class="skel sk-thumb"></span><span class="who"><span class="skel skel-line sk-l"></span><span class="skel skel-line sk-s"></span></span></li>
					{/each}
				</ul>
				<p class="more" aria-live="polite">{t('Buscando títulos y personas…')}</p>
			{:else if empty}
				<p id="cat-q-empty" class="none" aria-live="polite"><Icon name="search" size={20} />{only === 'all' ? t('Nada para «{q}». Probá con el título en inglés.', { q: st.q.trim() }) : t('Nada de este tipo. Probá con «Todo».')}</p>
			{/if}
		</div>
	{/if}
</div>

{#snippet titleRow(it: CatalogItem)}
	<span class="bg" aria-hidden="true" style:background-image={it.poster ? `url('${it.poster}')` : null}></span>
	{#if it.poster}<img class="thumb" src={it.poster} alt="" width="66" height="99" loading="lazy" />{:else}<span class="thumb ph" aria-hidden="true"><Icon name={it.kind === 'tv' ? 'tv' : 'film'} size={20} /></span>{/if}
	<span class="who"><span class="kind" class:tv={it.kind === 'tv'}><Icon name={it.kind === 'tv' ? 'tv' : 'film'} size={11} />{t(it.kind === 'tv' ? 'Serie' : 'Película')}</span><b>{it.title}</b><small>{[it.year, it.rating ? `★ ${it.rating}` : null].filter(Boolean).join(' · ')}</small></span>
	<span class="go" aria-hidden="true"><Icon name="next" size={18} /></span>
{/snippet}

{#if st.person}
	<div id="person-chip" class="person-chip" role="status">
		{#if st.person.photo}<img src={st.person.photo} alt="" width="28" height="28" />{/if}
		<span>{t(st.person.role === 'director' ? 'Dirigidas por {name}' : 'Con {name}', { name: st.person.name })}</span>
		<button id="person-clear" type="button" class="chip-x" aria-label={t('Volver al catálogo')} onclick={onclear}><Icon name="close" size={12} /></button>
	</div>
{/if}

<style>
	/* ── Fondo desenfocado (debajo del buscador, encima de todo lo demás) ── */
	.blur { position: fixed; inset: 0; z-index: 30; border: 0; padding: 0; background: rgb(5 7 10 / 0.22); backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); cursor: default; animation: fade 0.3s var(--out); }

	.finder { position: relative; z-index: 31; }
	.search {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		padding: 0 12px;
		height: 48px;
		overflow: hidden;
		border-radius: var(--r-card);
		background: var(--surface-2);
		color: var(--muted);
		transition: box-shadow 0.3s var(--out), background 0.3s var(--out);
	}
	.search:focus-within { background: var(--surface-3, var(--surface-2)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-fg) 55%, transparent), 0 10px 30px rgb(0 0 0 / 0.35); }
	.lead { display: grid; place-items: center; width: 20px; height: 20px; flex: none; }
	.spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent-fg) 25%, transparent); border-top-color: var(--accent-fg); animation: spin 0.7s linear infinite; }
	/* Barrita que corre abajo del buscador mientras busca. */
	.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--accent-fg), transparent); background-size: 40% 100%; background-repeat: no-repeat; animation: run 1.1s ease-in-out infinite; }
	.search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--text); font-size: 16px; }
	.search input::placeholder { color: var(--muted); }
	/* Sin la cruz nativa: va la propia, igual en todos los navegadores. */
	.search input::-webkit-search-cancel-button { display: none; }
	.clear-q {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		margin-right: -2px;
		padding: 0;
		border: 0;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--muted) var(--tint-4), transparent);
		color: var(--bg);
		animation: pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	/* Se ve de 24px, se toca en 44px. */
	.clear-q::after { content: ''; position: absolute; inset: -10px; }

	/* ── Desplegable: cae justo debajo, alto máximo hasta el borde de la pantalla (celu: con el teclado abierto) ── */
	.drop {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		right: 0;
		max-height: min(560px, calc(100dvh - 140px));
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 6px;
		border-radius: var(--r-card);
		background: color-mix(in srgb, var(--raised) 94%, transparent);
		box-shadow: 0 24px 60px rgb(0 0 0 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.06);
		transform-origin: top center;
		animation: drop 0.32s var(--out);
		scrollbar-width: thin;
	}
	.drop ul { margin: 0; padding: 0; list-style: none; }
	/* Chips de tipo: fila fija arriba del desplegable (se desliza de costado en celu si no entra). */
	.filters { position: sticky; top: -6px; z-index: 1; display: flex; gap: 6px; margin: -6px -6px 4px; padding: 10px 10px 8px; overflow-x: auto; scrollbar-width: none; background: color-mix(in srgb, var(--raised) 96%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid rgb(255 255 255 / 0.06); }
	.filters::-webkit-scrollbar { display: none; }
	.filter { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 0; border-radius: var(--r-pill); background: rgb(255 255 255 / 0.06); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08); color: var(--muted); font: inherit; font-size: 13px; font-weight: 650; white-space: nowrap; cursor: pointer; animation: rise-in 0.3s var(--out) backwards; transition: background 0.2s, color 0.2s, box-shadow 0.2s, scale 0.15s var(--out); }
	.filter:hover { color: var(--text); }
	.filter:active { scale: 0.95; }
	.filter[aria-checked='true'] { background: var(--text); color: var(--bg); box-shadow: 0 4px 14px rgb(0 0 0 / 0.3); }
	.filter .n { min-width: 18px; padding: 0 5px; border-radius: 9px; background: rgb(255 255 255 / 0.1); font-size: 11px; line-height: 18px; text-align: center; font-variant-numeric: tabular-nums; }
	.filter[aria-checked='true'] .n { background: rgb(0 0 0 / 0.12); }
	.filter:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.drop li { animation: rise-in 0.38s var(--out) calc(var(--i) * 30ms) backwards; }
	/* Cada opción es una tarjeta: el póster (o la foto) desenfocado de fondo con fade a negro de izquierda a derecha. */
	.drop ul { display: grid; gap: 8px; }
	.row { position: relative; isolation: isolate; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 124px; padding: 12px 16px 12px 12px; overflow: hidden; border: 0; border-radius: 16px; background: #11151a; color: #fff; text-align: left; text-decoration: none; font: inherit; cursor: pointer; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 6px 18px rgb(0 0 0 / 0.35); transition: box-shadow 0.2s, scale 0.2s var(--out); }
	.row::before { content: ''; position: absolute; inset: 0; z-index: -1; background: linear-gradient(to right, rgb(0 0 0 / 0.92) 0%, rgb(0 0 0 / 0.8) 45%, rgb(0 0 0 / 0.5) 100%); }
	.bg { position: absolute; inset: -20px; z-index: -2; background: #1a1f27 center 30% / cover; filter: blur(16px) saturate(1.4); transform: scale(1.05); transition: transform 0.5s var(--out); }
	.row:hover, .row:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.35), 0 10px 26px rgb(0 0 0 / 0.45); }
	.row:hover .bg { transform: scale(1.12); }
	.row:active { scale: 0.985; }
	.thumb { flex: none; width: 66px; height: 99px; border-radius: 8px; object-fit: cover; background: var(--surface-3); box-shadow: 0 8px 20px rgb(0 0 0 / 0.55), inset 0 0 0 0.5px rgb(255 255 255 / 0.15); }
	.face { flex: none; width: 76px; height: 76px; margin: 0 -4px; border-radius: 50%; object-fit: cover; background: var(--surface-3); box-shadow: 0 8px 20px rgb(0 0 0 / 0.55), 0 0 0 2px rgb(255 255 255 / 0.12); }
	.ph { display: grid; place-items: center; color: var(--muted); }
	.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
	.who b { overflow: hidden; font-size: 19px; font-weight: 750; letter-spacing: -0.01em; white-space: nowrap; text-overflow: ellipsis; }
	.who small { overflow: hidden; color: rgb(255 255 255 / 0.65); font-size: 14px; white-space: nowrap; text-overflow: ellipsis; }
	/* Película o serie: etiqueta chica arriba del título. */
	.kind { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 6px; border-radius: var(--r-pill); background: rgb(122 176 255 / 0.18); box-shadow: inset 0 0 0 1px rgb(122 176 255 / 0.4); color: #a9cbff; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; backdrop-filter: blur(8px); }
	.kind.tv { background: rgb(196 161 255 / 0.18); box-shadow: inset 0 0 0 1px rgb(196 161 255 / 0.4); color: #d6c2ff; }
	.go { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: rgb(255 255 255 / 0.1); color: rgb(255 255 255 / 0.75); backdrop-filter: blur(8px); transition: background 0.2s, translate 0.2s var(--out); }
	.row:hover .go { background: rgb(255 255 255 / 0.2); color: #fff; translate: 2px 0; }
	.more { margin: 4px 0 2px; color: var(--muted); font-size: 12.5px; text-align: center; animation: pulse 1.4s ease-in-out infinite; }
	.none { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 0; padding: 22px 16px; color: var(--muted); font-size: 14px; text-align: center; animation: rise-in 0.3s var(--out); }
	/* Esqueleto mientras llega la primera respuesta. */
	.sk { display: flex; align-items: center; gap: 14px; min-height: 124px; padding: 12px; border-radius: 16px; background: rgb(255 255 255 / 0.03); }
	.sk-thumb { flex: none; width: 66px; height: 99px; border-radius: 8px; }
	.sk .who { gap: 8px; }
	.sk-l { width: 60%; }
	.sk-s { width: 35%; height: 9px; }

	@keyframes fade { from { opacity: 0; } }
	@keyframes drop { from { opacity: 0; transform: translateY(-8px) scale(0.98); } }
	@keyframes rise-in { from { opacity: 0; transform: translateY(8px); } }
	@keyframes pop { from { transform: scale(0); } }
	@keyframes spin { to { transform: rotate(360deg); } }
	@keyframes run { from { background-position: -40% 0; } to { background-position: 140% 0; } }
	@keyframes pulse { 50% { opacity: 0.5; } }

	/* Celu: filas más altas para el dedo y el desplegable hasta casi abajo. */
	@media (max-width: 639px) {
		.drop { max-height: calc(100dvh - 120px); }
		.row { min-height: 112px; }
	}

	/* Actor elegido: una píldora dice de quién son los resultados y se quita con la cruz. */
	.person-chip { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; margin: 10px 0 8px; padding: 4px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent-fg); font-size: 14px; font-weight: 650; animation: rise-in 0.4s var(--out); }
	.person-chip img { flex: none; width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
	.person-chip span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-left: 4px; }
	.chip-x { position: relative; flex: none; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: color-mix(in srgb, var(--accent) 22%, transparent); color: inherit; }
	.chip-x::after { content: ''; position: absolute; inset: -9px; }
	@media (prefers-reduced-motion: reduce) { .filter, .blur, .drop, .drop li, .person-chip, .clear-q, .bar, .more, .none { animation: none; } .spin { animation-duration: 2s; } }
</style>
