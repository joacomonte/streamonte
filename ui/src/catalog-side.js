// Panel lateral del catálogo (2026-11-17, separado de catalog.js): ficha, temporadas, similares y
// migas de pan. Las opciones del video elegido las dibuja `catalog-options.js`.

import { api } from './api.js';
import { openSettings } from './dialogs.js';
import { $, el, icon, setStatus } from './dom.js';
import { loadStreams, renderStreamsOnly } from './catalog-options.js';
import { showError, state, view } from './catalog-state.js';
import { leaveTests } from './catalog-tests.js';
import { reduceMotion } from './catalog.js';

/** Versión chica del gráfico de temporadas para la tarjeta (2026-11-16): las mismas barras que el
 *  panel (`seasonBars`) y qué viene después; con fecha, una cuenta regresiva destacada. */
export function seasonMini(r, o) {
  const out = [seasonBars(r, o, false)];
  if (o?.date) {
    const when = o.days <= 1 ? (o.days ? 'mañana' : 'hoy') : `en ${o.days} días`;
    out.push(el('span', { class: 'cat-mini-next soon' },
      el('span', { class: 'cat-mini-soon' }, icon('clock', 12), when),
      `T${o.season}${o.episode > 1 ? ` E${o.episode}` : ''} · ${new Date(`${o.date}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '')}`));
  } else if (o) {
    const end = o.tone === 'done' || o.tone === 'stop';
    out.push(el('span', { class: `cat-mini-next ${o.tone}` }, el('span', { class: 'show-status-dot', 'aria-hidden': 'true' }),
      end ? `Serie ${o.label.toLowerCase()}` : `${o.label} · sin fecha`));
  }
  return out.filter(Boolean);
}

export async function openSide(kind, id, name) {
  await leaveTests();
  const seq = ++view.sideSeq;
  api.catalogStopStreams().catch(() => {});
  state.side = { kind, id, name, meta: null, season: null, episode: null, videoId: null };
  state.update = null;
  markActiveCard();
  // TMDB (2026-11-17): idioma original, cadenas y similares; sin key, el panel ofrece configurarla.
  api.catalogDetails(kind, id).then((d) => { if (seq === view.sideSeq) { state.side.details = d; renderSide(); } }).catch(() => {});
  // Película: no hace falta la ficha (el título ya se eligió); se piden las opciones directo.
  // De fondo, la ficha: cabecera (póster, año, puntaje) y duración para el aviso de "Pesado".
  if (kind === 'movie') {
    loadStreams(id);
    api.catalogMeta(kind, id).then((m) => {
      if (seq !== view.sideSeq) return;
      state.side.meta = m;
      state.side.runtime = m.runtime_min;
      renderSide();
    }).catch(() => {});
    return;
  }
  renderSide();
  setStatus('Abriendo la serie…');
  try {
    const meta = await api.catalogMeta(kind, id);
    if (seq !== view.sideSeq) return;
    state.side.meta = meta;
    state.side.runtime = meta.runtime_min;
    setStatus('Elegí temporada y episodio.');
    renderSide();
    // Puntaje por temporada de fondo (2026-11-16); la primera vez sin key baja datasets de IMDb.
    api.catalogSeasonRatings(id).then((r) => { if (seq === view.sideSeq) { state.side.seasonRatings = r; renderSide(); } })
      .catch(() => { if (seq === view.sideSeq) { state.side.seasonRatings = null; renderSide(); } });
  } catch (e) { if (seq === view.sideSeq) showError(e); }
}

export async function closeSide() {
  await leaveTests();
  view.sideSeq++;
  api.catalogStopStreams().catch(() => {});
  state.side = null;
  state.update = null;
  markActiveCard();
  renderSide();
}

/** Volver a un paso de la serie (miga de pan): `null` = elegir temporada; número = elegir episodio. */
export async function goSeason(season) {
  await leaveTests();
  api.catalogStopStreams().catch(() => {});
  Object.assign(state.side, { season, episode: null, videoId: null });
  state.update = null;
  renderSide();
  $('#cat-side').scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

export function markActiveCard() {
  document.querySelectorAll('.cat-card').forEach((c) => c.classList.toggle('active', c.dataset.id === state.side?.id));
}

export function crumbs(s) {
  // Serie › Temporada › Episodio como píldoras: las anteriores llevan de vuelta a ese paso.
  const steps = [{ label: s.name, back: s.season != null ? () => goSeason(null) : null, cls: 'root' }];
  if (s.season != null) steps.push({ label: s.season === 0 ? 'Especiales' : `Temporada ${s.season}`, back: s.episode != null ? () => goSeason(s.season) : null });
  if (s.episode != null) steps.push({ label: `Episodio ${s.episode}` });
  const up = steps.at(-2)?.back;
  return el('nav', { class: 'crumbs', 'aria-label': 'Serie' },
    up ? el('button', { id: 'cat-crumb-up', class: 'crumb-up', title: 'Volver', 'aria-label': 'Volver', onclick: up }, '←') : null,
    el('ol', { class: 'crumb-path' }, steps.map((st, i) => el('li', {},
      st.back
        ? el('button', { id: `cat-crumb-${i}`, class: `crumb ${st.cls ?? ''}`, title: st.label, onclick: st.back }, st.label)
        : el('span', { class: `crumb current ${st.cls ?? ''}`, title: st.label, 'aria-current': 'page' }, st.label)))));
}

export function renderSide() {
  const aside = $('#cat-side');
  const s = state.side;
  $('#catalog').classList.toggle('side-open', !!s);
  if (!s) { aside.replaceChildren(); return; }
  // Todo el panel scrollea junto (2026-11-17); se conserva la posición al redibujar.
  const scroll = aside.scrollTop;
  const prev = aside.querySelector('.side-intro');
  const prevH = prev?.offsetHeight ?? 0;
  // Elegida una temporada, la cabecera y la ficha se pliegan: ya se leyeron o no interesan.
  const collapsed = s.season != null;
  const intro = s.meta ? el('div', { class: `side-intro ${collapsed ? 'collapsed' : ''}`, 'aria-hidden': collapsed ? 'true' : null, inert: collapsed || null },
    hero(s.meta), about(s.meta, s)) : null;
  aside.replaceChildren(...[
    el('button', { id: 'cat-side-close', class: 'side-close', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar panel', onclick: closeSide }, '✕'),
    intro,
    // Migas solo en series (2026-11-17): en una película quedaba una franja vacía.
    s.kind === 'series' ? el('div', { class: 'side-head' }, crumbs(s)) : null,
    el('div', { id: 'cat-side-body', class: 'side-body' }, sideBody(s))].filter(Boolean));
  aside.scrollTop = scroll;
  if (intro && prev && prev.classList.contains('collapsed') !== collapsed && !reduceMotion()) {
    const h = collapsed ? 0 : intro.offsetHeight;
    intro.animate([{ height: `${prevH}px`, opacity: prevH ? 1 : 0 }, { height: `${h}px`, opacity: h ? 1 : 0 }],
      { duration: 360, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }
  renderStreamsOnly();
}

/** Géneros de Cinemeta (en inglés) a español; los que no están se muestran tal cual. */
export const GENRE_ES = { Action: 'Acción', Adventure: 'Aventura', Animation: 'Animación', Biography: 'Biografía', Comedy: 'Comedia', Crime: 'Crimen', Documentary: 'Documental', Drama: 'Drama', Family: 'Familia', Fantasy: 'Fantasía', 'Film-Noir': 'Cine negro', History: 'Historia', Horror: 'Terror', Music: 'Música', Musical: 'Musical', Mystery: 'Misterio', Romance: 'Romance', 'Sci-Fi': 'Ciencia ficción', 'Science Fiction': 'Ciencia ficción', Short: 'Corto', Sport: 'Deportes', Thriller: 'Suspenso', War: 'Bélica', Western: 'Western', 'Reality-TV': 'Reality', 'Talk-Show': 'Talk show', 'Game-Show': 'Concurso', News: 'Noticias' };

/** Cabecera de la serie o película: fondo, póster y datos. */
export const compact = new Intl.NumberFormat('es-AR', { notation: 'compact' });
export const LANG_ES = new Intl.DisplayNames(['es'], { type: 'language' });
export function hero(m) {
  // El puntaje es el link a IMDb (2026-11-17: antes un botón aparte que ocupaba una fila).
  const rating = el('button', { id: 'cat-open-imdb', class: 'side-imdb', title: 'Ver en IMDb', onclick: () => api.catalogOpenImdb(m.id).catch(showError) },
    m.imdb_rating ? `★ ${m.imdb_rating}${m.imdb_votes ? ` (${compact.format(m.imdb_votes)} votos)` : ''}` : 'IMDb', icon('external', 12));
  // El de TMDB (el más viejo: temporada 1) si hay; si no, el primero de Cinemeta.
  const yt = state.side?.details?.details?.trailer ?? m.trailer;
  const trailer = yt && el('button', { id: 'cat-open-trailer', class: 'side-imdb', title: 'Ver el tráiler en YouTube', onclick: () => api.catalogOpenTrailer(yt).catch(showError) },
    icon('play', 11), 'Tráiler');
  const facts = [m.year, rating, m.runtime_min && `${m.runtime_min} min`, trailer].filter(Boolean).flatMap((f, i) => (i ? ['  ·  ', f] : [f]));
  return el('div', { class: 'side-hero' },
    m.background ? el('div', { class: 'side-hero-bg', style: `background-image:url("${encodeURI(m.background)}")` }) : null,
    m.poster ? el('img', { class: 'side-hero-poster', src: m.poster, alt: '', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : null,
    el('div', { class: 'side-hero-text' }, el('h2', {}, m.name), el('p', {}, facts)));
}

/** Debajo de la cabecera (pedido 2026-11-15): cadenas y géneros, sinopsis (clic para verla entera),
 *  reparto e idioma original, link a IMDb y similares (2026-11-17). Sin key de TMDB, en lugar de
 *  lo que viene de TMDB se ofrece configurarla. */
export function about(m, s) {
  const tm = s.details?.details;
  const facts = [
    m.cast.length ? ['Reparto', m.cast.join(', ')] : null,
    tm?.original_language ? ['Idioma original', LANG_ES.of(tm.original_language)] : null,
  ].filter(Boolean);
  const desc = m.description ? el('p', {
    class: 'side-desc', tabindex: 0, 'aria-expanded': 'false',
    onclick: (ev) => { const p = ev.currentTarget; p.setAttribute('aria-expanded', String(p.classList.toggle('open'))); },
    onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click(); } },
  }, m.description) : null;
  const badges = [...(tm?.networks ?? []).map((n) => el('span', { class: 'side-genre network' }, n)),
    ...m.genres.map((g) => el('span', { class: 'side-genre' }, GENRE_ES[g] ?? g))];
  return el('div', { class: 'side-about' },
    badges.length ? el('div', { class: 'side-genres' }, badges) : null,
    desc,
    facts.length ? el('dl', { class: 'side-facts' }, facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null,
    s.details && !s.details.has_key ? el('div', { class: 'side-tmdb-teaser' },
      el('p', {}, el('b', {}, 'Más datos con TMDB'), 'Idioma original (elige mejor el audio), cadena de la serie y títulos similares. La key es gratis.'),
      el('button', { id: 'cat-tmdb-setup', class: 'pop-btn', onclick: openSettings }, 'Configurar'))
      : s.details?.has_key ? similarBox(s) : null);
}

/** "Similares" plegado (2026-11-17): se piden recién al abrirlo (cada uno cuesta pedidos a TMDB) y
 *  no ocupan lugar si no interesan. `s.similar`: undefined = sin pedir, null = cargando. */
export function similarBox(s) {
  const open = !!s.similarOpen;
  const list = s.similar;
  const toggle = () => {
    s.similarOpen = !open;
    if (s.similarOpen && list === undefined) {
      s.similar = null;
      api.catalogSimilar(s.kind, s.id).then((l) => { if (state.side === s) { s.similar = l; renderSide(); } })
        .catch(() => { if (state.side === s) { s.similar = []; renderSide(); } });
    }
    renderSide();
  };
  return el('div', { class: `side-similar ${open ? 'open' : ''}` },
    el('button', { id: 'cat-similar-toggle', class: 'side-similar-head', 'aria-expanded': String(open), onclick: toggle },
      el('span', {}, 'Similares'), icon('chev', 16)),
    !open ? null
      : list == null ? el('div', { class: 'side-similar-grid', 'aria-busy': 'true' }, Array.from({ length: 5 }, () => el('span', { class: 'skel side-similar-skel' })))
        : !list.length ? el('p', { class: 'hint' }, 'TMDB no tiene recomendaciones para este título.')
          : el('div', { class: 'side-similar-grid' }, list.map((x) => el('button', {
          id: `cat-similar-${x.id}`, class: 'side-similar-card', title: x.year ? `${x.name} (${x.year})` : x.name, onclick: () => openSide(s.kind, x.id, x.name),
        },
        x.poster ? el('img', { src: x.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (ev) => ev.target.remove() }) : null,
        x.rating ? el('span', { class: `side-similar-score ${seasonTone(x.rating)}` }, `★ ${fmtScore(x.rating)}`) : null,
        el('span', { class: 'side-similar-name' }, x.name)))));
}

/** Puntaje por temporada como barras (2026-11-16), el mismo componente en el panel (`large`) y en
 *  la tarjeta. Alto relativo: la mejor temporada llena la barra y la base es un punto debajo de la
 *  peor, así se ve si sube o baja aunque todas estén entre 8 y 9. Color por nota. Si viene otra
 *  temporada, una barra punteada al final. null = no hay nada que mostrar. */
export const seasonTone = (x) => (x >= 8.5 ? 'great' : x >= 7.5 ? 'good' : x >= 6.5 ? 'meh' : 'bad');
export const fmtScore = (x) => x.toFixed(1).replace('.', ',');
export function seasonBars(r, o, large) {
  const v = r.seasons.map((x) => x.rating);
  const upcoming = o && !(o.tone === 'done' || o.tone === 'stop') && o.season > (r.seasons.at(-1)?.season ?? 0) ? o : null;
  if (v.length < 2 && !(v.length && upcoming)) return null;
  const top = Math.max(...v), floor = Math.min(...v) - 1;
  const height = (x) => `${Math.max(12, ((x - floor) / (top - floor || 1)) * 100)}%`;
  const best = v.indexOf(top);
  const col = (tag, attrs, val, fill, n) => el(tag, attrs, large ? el('span', { class: 'sbar-val' }, val) : null,
    el('span', { class: 'sbar-track' }, fill), large ? el('span', { class: 'sbar-n' }, n) : null);
  const bars = r.seasons.map((x, i) => col(large ? 'button' : 'span', {
    ...(large ? { id: `cat-season-bar-${x.season}`, onclick: () => goSeason(x.season) } : {}),
    class: `sbar ${seasonTone(x.rating)} ${large && i === best ? 'best' : ''}`,
    title: `Temporada ${x.season}: ${fmtScore(x.rating)} (${x.episodes} episodios con puntaje)`,
  }, fmtScore(x.rating), el('i', { style: `height:${height(x.rating)}` }), `T${x.season}`));
  // Lo que viene: punteada, a la altura de la última, con la fecha si se sabe.
  const next = upcoming && col('span', {
    class: `sbar ghost ${upcoming.tone}`, title: `Temporada ${upcoming.season}: ${upcoming.date ? shortDate(upcoming.date) : `${upcoming.label.toLowerCase()}, sin fecha anunciada`}`,
  }, upcoming.date ? new Date(`${upcoming.date}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '') : '?',
  el('i', { style: `height:${height(v.at(-1))}` }), `T${upcoming.season}`);
  return el('span', { class: `sbars ${large ? 'large' : 'small'}` }, bars, next);
}
/** Primera contra última temporada: "Mejoró +0,8" / "Decayó −0,4" / "Estable". */
export function seasonTrend(r) {
  const v = r.seasons.map((x) => x.rating);
  if (v.length < 2) return null;
  const delta = v.at(-1) - v[0];
  if (Math.abs(delta) < 0.3) return { text: 'Estable', icon: 'trend-flat', tone: 'flat' };
  return { text: `${delta > 0 ? 'Mejoró +' : 'Decayó −'}${fmtScore(Math.abs(delta))}`, icon: delta > 0 ? 'trend-up' : 'trend-down', tone: delta > 0 ? 'up' : 'down' };
}

/** Gráfico del panel de la serie. `r`: undefined = cargando (esqueleto). */
export function seasonChart(r, o) {
  if (r === undefined) return el('div', { class: 'season-chart', 'aria-busy': 'true' }, el('span', { class: 'skel season-chart-skel' }));
  const bars = r && seasonBars(r, o, true);
  if (!bars) return null;
  const trend = seasonTrend(r), end = o?.tone === 'done' || o?.tone === 'stop';
  return el('div', { class: 'season-chart' },
    el('div', { class: 'season-chart-head' }, el('b', {}, 'Puntaje por temporada'),
      el('span', { class: 'season-chart-meta' },
        end ? el('span', { class: `season-end ${o.tone}`, title: 'No hay más temporadas' }, icon(o.tone === 'done' ? 'flag' : 'ban', 12), o.label) : null,
        trend ? el('span', { class: `season-trend ${trend.tone}` }, icon(trend.icon, 13), trend.text) : null,
        el('span', { class: 'season-chart-src' }, 'IMDb'))),
    bars);
}

/** Qué viene después de la última temporada (2026-11-16): punto fantasma del gráfico y tarjeta
 *  punteada de la lista. `last`: última temporada numerada. null = la fuente no lo sabe. */
export const SHOW_STATES = { returning: 'Renovada', 'in-production': 'En producción', planned: 'Planeada', ended: 'Terminada', canceled: 'Cancelada' };
export function seasonOutlook(st, last) {
  const label = st && SHOW_STATES[st.state];
  if (!label) return null;
  if (st.state === 'ended' || st.state === 'canceled') return { tone: st.state === 'ended' ? 'done' : 'stop', label };
  const next = st.next && new Date(`${st.next.date}T12:00:00`) > new Date() ? st.next : null;
  if (!next) return { tone: 'wait', label, season: last + 1 };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((new Date(`${next.date}T12:00:00`) - today) / 864e5);
  return { tone: 'go', label: 'En emisión', season: next.season, episode: next.episode, date: next.date, days };
}

export function nextSeasonTile(o) {
  if (!o) return null;
  const end = o.tone === 'done' || o.tone === 'stop';
  const title = end ? `Serie ${o.label.toLowerCase()}` : o.episode > 1 ? `T${o.season} E${o.episode}` : `Temporada ${o.season}`;
  const detail = end ? 'No hay más temporadas'
    : o.date ? `${o.days <= 1 ? `Se estrena ${o.days ? 'mañana' : 'hoy'}` : `Se estrena en ${o.days} días`} · ${shortDate(o.date)}`
    : `${o.label} · sin fecha anunciada`;
  return el('div', { id: 'cat-season-next', class: `season-tile next ${o.tone}` },
    el('span', { class: 'season-tile-num' }, end ? icon(o.tone === 'done' ? 'flag' : 'ban', 22) : String(o.season)),
    el('span', { class: 'season-tile-text' }, el('b', {}, title), el('span', {}, detail)));
}

export const shortDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function sideBody(s) {
  if (s.videoId) return el('div', { id: 'cat-streams' });
  if (!s.meta) return el('div', { class: 'side-skeleton' }, Array.from({ length: 5 }, () => el('span', { class: 'skel' })));
  const eps = s.meta.episodes;
  if (s.season == null) {
    // Temporadas: tarjetas sin imagen (las de episodios pueden spoilear, pedido 2026-11-15).
    const seasons = [...new Set(eps.map((e) => e.season))].sort((a, b) => (a || 999) - (b || 999));
    const outlook = seasonOutlook(s.seasonRatings?.status, Math.max(0, ...seasons));
    const tiles = seasons.map((n) => {
      const list = eps.filter((e) => e.season === n);
      const years = [...new Set(list.map((e) => e.released?.slice(0, 4)).filter(Boolean))];
      return el('button', { class: 'season-tile', id: `cat-season-${n}`, onclick: () => goSeason(n) },
        el('span', { class: 'season-tile-num' }, n === 0 ? '★' : String(n)),
        el('span', { class: 'season-tile-text' },
          el('b', {}, n === 0 ? 'Especiales' : `Temporada ${n}`),
          el('span', {}, [`${list.length} episodios`, years.length && (years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0])].filter(Boolean).join(' · '))));
    });
    // La tarjeta punteada va después de la última temporada, antes de Especiales.
    tiles.splice(seasons.includes(0) ? tiles.length - 1 : tiles.length, 0, nextSeasonTile(outlook));
    return el('div', { class: 'season-grid' }, seasonChart(s.seasonRatings, outlook), tiles);
  }
  // Episodios: número, título, fecha y sinopsis (sin miniatura: puede spoilear).
  return el('ul', { class: 'ep-list' }, eps.filter((e) => e.season === s.season).map((e) => el('li', {},
    el('button', {
      class: 'ep-item', id: `cat-ep-${e.season}-${e.episode}`, disabled: !e.available,
      onclick: async () => { await leaveTests(); s.episode = e.episode; loadStreams(e.id); },
    },
    el('span', { class: 'ep-num' }, e.episode),
    el('span', { class: 'ep-text' },
      el('b', {}, e.title || `Episodio ${e.episode}`),
      el('span', { class: 'ep-date' }, e.available ? shortDate(e.released) : `Se estrena ${shortDate(e.released) || 'pronto'}`),
      e.overview ? el('span', { class: 'ep-overview', title: e.overview }, e.overview) : null,
    )))));
}
