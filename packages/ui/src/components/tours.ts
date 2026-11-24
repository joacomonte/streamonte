// Contenido de los tutoriales (bienvenida y cómo mandarlo a la tele) y qué ya vio el usuario en este navegador.
// Los textos se arman al abrir el tutorial, en el idioma elegido.
import { t } from '../i18n/runtime.ts';
import { safeGet, safeSet } from '../storage.ts';
import type { Step, StoreLink } from './tour-state.ts';

// Íconos: artworkUrl512 de itunes.apple.com/lookup (iOS) y og:image de la ficha de Google Play (tamaño =s256).
const JUST_PLAYER = { label: 'Just Player', store: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.brouken.player', icon: 'https://play-lh.googleusercontent.com/1du5nvD4DXIf1h4S_ip5MuRZHHfpPlJl0EEzJ915TAGJws1H8E9Hi-NRPSw0gUfhOn-SRzqQsoQ4Yz-7kbQflQ=s256' };
const SENPLAYER = { label: 'SenPlayer', store: 'App Store', href: 'https://apps.apple.com/app/id6443975850', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/84/60/3f/84603fd5-c264-8712-6d6c-3d8bf92680ab/AppIcon-0-0-1x_U007epad-0-1-0-85-220.png/256x256bb.jpg' };
const WVC_IOS = { label: 'Web Video Caster', store: 'App Store', href: 'https://apps.apple.com/app/id1400866497', icon: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/00/e3/12/00e31239-6d9d-5ed1-647f-3cdea788246f/AppIcon-0-0-1x_U007epad-0-0-0-11-0-0-85-220.png/256x256bb.jpg' };
const WVC_ANDROID = { label: 'Web Video Caster', store: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.instantbits.cast.webvideo', icon: 'https://play-lh.googleusercontent.com/WJ8t0dcoBL8_6BonyM6196e1MI7xZ0t6iE61HOqRdWmEoVWaOsgzP3eFfjLfH3MUJ4muEt2kDI7IbyGC8aCsVQ=s256' };
// Se instala desde la tienda del televisor, no desde el celu: sin link. Función porque el texto se traduce al abrir.
const wvcReceiver = () => ({ label: 'Web Video Caster Receiver', store: t('En la tele: buscalo en la tienda de apps del televisor (Android TV o Fire TV)'), icon: 'https://play-lh.googleusercontent.com/I74WHG4_Nr6PJXn-501CD7pw19t9DTDL2dfdjDYigT0byoBpbHOEiuWZ4uWPYM0W90rsB0OL_-jGJ1Zqmpe7Ow=s256' });

export type Device = 'ios' | 'android' | 'desktop';

export function device(): Device {
	const ua = navigator.userAgent;
	// iPadOS se presenta como Mac: lo delata la pantalla táctil.
	if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
	return /Android/.test(ua) ? 'android' : 'desktop';
}

export const casterFor = (d: Device): StoreLink[] => (d === 'ios' ? [WVC_IOS] : d === 'android' ? [WVC_ANDROID] : [WVC_IOS, WVC_ANDROID]);

/** El paso del apodo: en la bienvenida y solo, para quien ya la vio sin tener apodo. */
export const nickStep = (): Step => ({ icon: 'user', title: t('¿Cómo te decimos?'), body: '', nick: true });

/** Con qué verlo en el celu según el dispositivo (va al copiar un video, no en la bienvenida). */
export function playerStep(d: Device): Step {
	const player =
		d === 'ios'
			? { title: t('Para verlo en el celular vas a necesitar bajar {app}', { app: 'SenPlayer' }), body: t('Abrís el link copiado y lo ves en 4K y HDR, con el audio y los subtítulos que elijas.'), links: [SENPLAYER] }
			: d === 'android'
				? { title: t('Para verlo en el celular vas a necesitar bajar {app}', { app: 'Just Player' }), body: t('Gratis y sin publicidad. Abrís el link copiado y elegís el audio y los subtítulos.'), links: [JUST_PLAYER] }
				: { title: t('Para verlo en el celular vas a necesitar bajar SenPlayer (iPhone) o Just Player (Android)'), body: t('Abrís el link copiado y elegís el audio y los subtítulos.'), links: [SENPLAYER, JUST_PLAYER] };
	return { icon: 'phone', ...player };
}

/** Los pasos de idioma de la bienvenida (app y títulos), iguales en web y desktop. */
export const langSteps = (): Step[] => [
	{ icon: 'globe', title: t('Idioma de la app'), body: '', picker: 'app' },
	{ icon: 'film', title: t('Títulos de películas y series'), body: t('Elegí en qué idioma ver sus nombres: tocá y mirá el póster.'), picker: 'titles' }
];

/** Bienvenida: apodo, idiomas y qué es (con qué verlo en el celu y la tele va al copiar un video). */
export function welcomeSteps(): Step[] {
	return [
		nickStep(),
		...langSteps(),
		{ icon: 'play', logo: true, title: t('Bienvenido a Streamonte'), body: t('Elegís una peli o un episodio, copiás el link y lo mirás al instante, en el celu o en la tele.') },
	];
}

/** Cómo mandar el link a la tele con Web Video Caster. */
export function castSteps(d: Device): Step[] {
	return [
		{ icon: 'phone', title: t('Instalala en el celu'), body: t('Web Video Caster es gratis y manda el link del celu a la tele, sin bajar nada.'), links: casterFor(d) },
		{
			icon: 'cast',
			title: t('Preparala en la tele'),
			body: t('En Android TV o Fire TV instalá Web Video Caster Receiver. Chromecast, Roku y las Samsung o LG la encuentran sin instalar nada.'),
			links: [wvcReceiver()]
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
 * Sin storage no se recuerda: se vuelve a mostrar, nada se rompe. */
export const seen = (name: string): boolean => safeGet(`tour:${name}`) === '1';
export const markSeen = (name: string): void => safeSet(`tour:${name}`, '1');
