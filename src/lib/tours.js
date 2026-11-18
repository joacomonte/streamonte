// Contenido de los tutoriales (bienvenida y cómo mandarlo a la tele) y qué ya vio el usuario en este navegador.
// Los textos se arman al abrir el tutorial, en el idioma elegido.
import { t } from './i18n.svelte.js';

/** @typedef {{label: string, store: string, href: string}} StoreLink */
/** @typedef {{icon: 'play' | 'phone' | 'cast' | 'wifi' | 'link' | 'subs', title: string, body: string, links?: StoreLink[]}} Step */

const JUST_PLAYER = { label: 'Just Player', store: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.brouken.player' };
const SENPLAYER = { label: 'SenPlayer', store: 'App Store', href: 'https://apps.apple.com/app/id6443975850' };
const WVC_IOS = { label: 'Web Video Caster', store: 'App Store', href: 'https://apps.apple.com/app/id1400866497' };
const WVC_ANDROID = { label: 'Web Video Caster', store: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.instantbits.cast.webvideo' };
const WVC_RECEIVER = { label: 'Web Video Caster Receiver', store: 'Android TV · Google Play', href: 'https://play.google.com/store/apps/details?id=com.instantbits.cast.receiver' };

/** @returns {'ios' | 'android' | 'desktop'} */
export function device() {
	const ua = navigator.userAgent;
	// iPadOS se presenta como Mac: lo delata la pantalla táctil.
	if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
	return /Android/.test(ua) ? 'android' : 'desktop';
}

/** @param {ReturnType<typeof device>} d */
const casterFor = (d) => (d === 'ios' ? [WVC_IOS] : d === 'android' ? [WVC_ANDROID] : [WVC_IOS, WVC_ANDROID]);

/** Bienvenida: qué es, con qué verlo en el celu (según el dispositivo) y qué hace falta para la tele.
 * @param {ReturnType<typeof device>} d @returns {Step[]} */
export function welcomeSteps(d) {
	const player =
		d === 'ios'
			? { title: t('En el iPhone, SenPlayer'), body: t('Abrís el link copiado y lo ves en 4K y HDR, con el audio y los subtítulos que elijas.'), links: [SENPLAYER] }
			: d === 'android'
				? { title: t('En el celu, Just Player'), body: t('Gratis y sin publicidad. Abrís el link copiado y elegís el audio y los subtítulos.'), links: [JUST_PLAYER] }
				: { title: t('Para verlo en el celu'), body: t('En iPhone, SenPlayer; en Android, Just Player. Abrís el link copiado y elegís el audio y los subtítulos.'), links: [SENPLAYER, JUST_PLAYER] };
	return [
		{ icon: 'play', title: t('Bienvenido a Streamonte'), body: t('Elegís una peli o un episodio, copiás el link y lo mirás al instante, en el celu o en la tele.') },
		{ icon: 'phone', ...player },
		{
			icon: 'cast',
			title: t('¿En la tele? Web Video Caster'),
			body: t('Va en el celu y en la tele: el celu le manda el video. Chromecast, Samsung y LG la encuentran solas; en Android TV o Fire TV instalá el Receiver.'),
			links: [...casterFor(d), WVC_RECEIVER]
		}
	];
}

/** Cómo mandar el link a la tele con Web Video Caster. @param {ReturnType<typeof device>} d @returns {Step[]} */
export function castSteps(d) {
	return [
		{ icon: 'phone', title: t('Instalala en el celu'), body: t('Web Video Caster es gratis y manda el link del celu a la tele, sin bajar nada.'), links: casterFor(d) },
		{
			icon: 'cast',
			title: t('Preparala en la tele'),
			body: t('En Android TV o Fire TV instalá Web Video Caster Receiver. Chromecast, Roku y las Samsung o LG la encuentran sin instalar nada.'),
			links: [WVC_RECEIVER]
		},
		{ icon: 'wifi', title: t('Conectá'), body: t('Celu y tele en el mismo Wi-Fi. En la app tocá el ícono de transmitir y elegí la tele.') },
		{ icon: 'link', title: t('Pegá el link'), body: t('Pegalo en la barra de direcciones del navegador de la app: detecta el video y tocás Reproducir.') },
		{
			icon: 'subs',
			title: t('Subtítulos en español'),
			body: t('Copiá uno desde Subtítulos en español. Mientras se reproduce, tocá CC → agregar por link y pegalo. Si no coincide, probá el siguiente.')
		}
	];
}

/** Marcas que quedan en este navegador (`welcome`: ya vio la bienvenida; `cast-never`: no ofrecer el de la tele).
 * Sin storage no se recuerda: se vuelve a mostrar, nada se rompe. @param {string} name */
export function seen(name) {
	try {
		return localStorage.getItem(`tour:${name}`) === '1';
	} catch {
		return false;
	}
}
/** @param {string} name */
export function markSeen(name) {
	try {
		localStorage.setItem(`tour:${name}`, '1');
	} catch {
		// Sin storage: no queda guardado.
	}
}
