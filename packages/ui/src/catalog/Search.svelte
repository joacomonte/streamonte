<script lang="ts">
	// Buscador con sugerencias de actores y directores, y la píldora de la persona elegida.
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { PersonHit } from '../types.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		/** Vuelve al catálogo con los filtros, arriba de todo. */
		onclear: () => void;
		/** Escribió algo: la pantalla vuelve arriba y registra la búsqueda. */
		onquery: (raw: string) => void;
		onpick: (p: PersonHit) => void;
	}
	let { store, onclear, onquery, onpick }: Props = $props();
	const st = $derived(store.st);
	// Las sugerencias no se abren solas (tapaban los resultados): se abren con "Ver sugerencias".
	let open = $state(false);
	const typed = $derived(st.q.trim() !== '');

	function key(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		// Esc: primero cierra las sugerencias; después limpia la búsqueda.
		if (open) open = false;
		else if (st.people.length || st.peopleLoading) store.closePeople();
		else if (st.q) onclear();
	}
</script>

<div class="finder">
	<label class="search">
		<Icon name="search" size={18} />
		<input id="cat-q" type="search" placeholder={t('Título, actor/actriz o director')} autocomplete="off" enterkeyhint="search" value={st.q} oninput={(e) => { open = false; onquery(e.currentTarget.value); }} onblur={() => (open = false)} onkeydown={key} />
		{#if typed && st.people.length}
			<button id="cat-q-people" type="button" class="see-people" aria-expanded={open} aria-controls="people-list" onpointerdown={(e) => e.preventDefault()} onclick={() => (open = !open)}>{t('Ver sugerencias')}</button>
		{/if}
		{#if st.q || st.person}
			<button id="cat-q-clear" type="button" class="clear-q" aria-label={t('Limpiar búsqueda')} onclick={onclear}><Icon name="close" size={14} /></button>
		{/if}
	</label>
	<!-- Actores y directores que coinciden: tocar uno trae lo que actuó o dirigió. pointerdown sin foco: el input no se cierra antes del clic. -->
	{#if open && st.peopleLoading && typed}
		<ul id="people-loading" class="people" aria-busy="true" aria-label={t('Buscando actores y directores…')}>
			{#each Array(3) as _, i (i)}
				<li class="person skel-row" aria-hidden="true"><span class="skel skel-circle sk-face"></span><span class="who"><span class="skel skel-line sk-line"></span><span class="skel skel-line sk-line short"></span></span></li>
			{/each}
		</ul>
	{:else if open && st.people.length && typed}
		<ul id="people-list" class="people" aria-label={t('Actores y directores')}>
			{#each st.people as p, i (p.id)}
				<li style:--i={i}>
					<button id="person-{p.id}" type="button" class="person" onpointerdown={(e) => e.preventDefault()} onclick={() => onpick(p)}>
						{#if p.photo}<img src={p.photo} alt="" width="40" height="40" loading="lazy" />{:else}<span class="ph" aria-hidden="true"><Icon name="user" size={18} /></span>{/if}
						<span class="who"><b>{p.name}</b><small><span class="role">{t(p.role === 'director' ? 'Director' : 'Actúa')}</span>{#if p.known} · {p.known}{/if}</small></span>
						<span class="go" aria-hidden="true"><Icon name="chev" size={16} /></span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
{#if st.person}
	<div id="person-chip" class="person-chip" role="status">
		{#if st.person.photo}<img src={st.person.photo} alt="" width="28" height="28" />{/if}
		<span>{t(st.person.role === 'director' ? 'Dirigidas por {name}' : 'Con {name}', { name: st.person.name })}</span>
		<button id="person-clear" type="button" class="chip-x" aria-label={t('Volver al catálogo')} onclick={onclear}><Icon name="close" size={12} /></button>
	</div>
{/if}

<style>
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		padding: 0 12px;
		height: 44px;
		border-radius: var(--r-card);
		background: var(--surface-2);
		color: var(--muted);
	}
	.search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--text); font-size: 16px; }
	.search input::placeholder { color: var(--muted); }
	/* Sin la cruz nativa: va la propia, igual en todos los navegadores. */
	.search input::-webkit-search-cancel-button { display: none; }
	.clear-q {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-right: -2px;
		padding: 0;
		border: 0;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--muted) var(--tint-4), transparent);
		color: var(--bg);
	}
	.see-people { flex: none; padding: 3px 9px; border: 0; border-radius: var(--r-pill); background: none; color: var(--accent-fg); font: inherit; font-size: 12.5px; font-weight: 600; white-space: nowrap; cursor: pointer; animation: rise-in 0.3s var(--out); }
	.see-people[aria-expanded='true'] { background: color-mix(in srgb, var(--accent) 14%, transparent); }
	/* Se ve de 22px, se toca en 44px. */
	.clear-q::after { content: ''; position: absolute; inset: -11px; }

	/* Buscador con sugerencias de actores y directores: la lista cae justo debajo, sobre el catálogo. */
	.finder { position: relative; }
	.people {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		z-index: 30;
		margin: 0;
		padding: 6px;
		list-style: none;
		border-radius: var(--r-card);
		background: var(--raised);
		box-shadow: 0 12px 32px var(--shadow-lg);
		transform-origin: top center;
		animation: drop 0.28s var(--out);
	}
	.people li { animation: rise-in 0.36s var(--out) calc(var(--i) * 35ms) backwards; }
	.person { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 8px 10px; border: 0; border-radius: var(--r-md); background: none; color: var(--text); text-align: left; font: inherit; cursor: pointer; }
	.person:hover, .person:focus-visible { background: var(--surface-2); }
	.person:active { transform: scale(0.985); }
	.person img, .person .ph { flex: none; width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: var(--surface-3); }
	.person .ph { display: grid; place-items: center; color: var(--muted); }
	.go { flex: none; display: grid; color: var(--muted); transform: rotate(-90deg); }
	.who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.who b { font-size: 15px; font-weight: 650; }
	.who .role { color: var(--accent-fg); font-weight: 600; }
	.who small { overflow: hidden; color: var(--muted); font-size: 12.5px; white-space: nowrap; text-overflow: ellipsis; }
	.skel-row { cursor: default; }
	.sk-face { flex: none; width: 40px; height: 40px; }
	.skel-row .who { gap: 7px; }
	.sk-line { width: 55%; }
	.sk-line.short { width: 80%; height: 9px; }
	@keyframes drop { from { opacity: 0; transform: translateY(-6px) scale(0.98); } }
	@keyframes rise-in { from { opacity: 0; transform: translateY(6px); } }
	/* Actor elegido: una píldora dice de quién son los resultados y se quita con la cruz. */
	.person-chip { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; margin: 10px 0 8px; padding: 4px 4px 4px 4px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent-fg); font-size: 14px; font-weight: 650; animation: rise-in 0.4s var(--out); }
	.person-chip img { flex: none; width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
	.person-chip span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-left: 4px; }
	.chip-x { position: relative; flex: none; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: color-mix(in srgb, var(--accent) 22%, transparent); color: inherit; }
	.chip-x::after { content: ''; position: absolute; inset: -9px; }
	@media (prefers-reduced-motion: reduce) { .people, .people li, .person-chip, .see-people { animation: none; } }
</style>
