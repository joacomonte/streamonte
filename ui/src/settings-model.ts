// Ajustes sin DOM: qué comando llama cada guardado, validaciones y textos de estado. `Settings.svelte` solo pinta.
// Las funciones tiran lo que tire el núcleo (la UI lo muestra con `showError`); devuelven el mensaje para la barra de estado.
import { t } from '../../packages/ui/src/i18n/runtime.ts';
import type { DesktopApi } from './desktopApi.ts';
import type * as Raw from './types.js';

export type KeyService = 'tmdb' | 'torbox' | 'wyzie' | 'opensubtitles';
export type KeyEvent = 'streamonte:tmdb-key' | 'streamonte:torbox-key';
export type Net = { incoming: boolean; upnp: boolean; announce: boolean };

const SERVICE_NAMES: Record<string, string> = { wyzie: 'Wyzie', opensubtitles: 'OpenSubtitles', tmdb: 'TMDB', torbox: 'TorBox' };
export type KeySaved = { cleared: boolean; event: KeyEvent | null; status: string; done: string };
/** Guarda la key (vacía = la borra). TMDB y TorBox avisan al resto de la app con un evento del documento. */
export async function saveKey(api: Pick<DesktopApi, 'setApiKey'>, service: string, raw: string): Promise<KeySaved> {
	const value = raw.trim();
	await api.setApiKey(service, value);
	const name = SERVICE_NAMES[service] ?? service;
	const event = service === 'tmdb' ? 'streamonte:tmdb-key' : service === 'torbox' ? 'streamonte:torbox-key' : null;
	if (!value) return { cleared: true, event, status: t('Key de {a} borrada.', { a: name }), done: '' };
	return {
		cleared: false,
		event,
		status: t('Key de {a} guardada en el almacén seguro.', { a: name }),
		done: service === 'tmdb' ? t('¡TMDB conectada! El catálogo se recarga con filtros por votos, idioma y géneros.') : t('¡{a} conectada!', { a: name })
	};
}

export async function saveLatTeamToken(api: Pick<DesktopApi, 'setApiKey'>, raw: string): Promise<string> {
	await api.setApiKey('latteam', raw.trim());
	return t('Token de Lat-Team guardado en el almacén seguro.');
}
export const toggleLatTeam = (api: Pick<DesktopApi, 'catalogSetAddonEnabled'>, on: boolean): Promise<void> => api.catalogSetAddonEnabled('latteam', on);

/** Usuario y contraseña de OpenSubtitles.com (vacíos = borrar). */
export const saveOsLogin = (api: Pick<DesktopApi, 'setOpensubtitlesLogin'>, user: string, pass: string): Promise<void> => api.setOpensubtitlesLogin(user.trim(), pass);

export async function saveEqualizer(api: Pick<DesktopApi, 'setEqualizer'>, eq: Raw.Equalizer, intensity: number): Promise<string> {
	await api.setEqualizer(eq, intensity);
	return t('Sonido guardado: rige desde la próxima reproducción.');
}

/** ADR-30: entrantes / UPnP. El motor se crea por reproducción, así que aplica en la próxima. */
export async function saveNetwork(api: Pick<DesktopApi, 'setNetwork'>, n: Net): Promise<string> {
	await api.setNetwork(n.incoming, n.upnp, n.announce);
	return t('Red guardada: aplica desde la próxima reproducción.');
}

/** Estado de la cuenta de OpenSubtitles.com: conectada (con su cuota), login fallido o sin cuenta. */
export function osLoginText(q: Raw.PremiumQuota | null): string {
	if (!q?.has_login) return t('Sin cuenta: la cuota se sabe con la primera descarga.');
	if (q.login_error) return t('No se pudo entrar: {login_error}', { login_error: q.login_error });
	return t('Cuenta conectada{a}.', { a: q.remaining != null ? t(' · quedan {remaining} de {per_day} descargas hoy', { remaining: q.remaining, per_day: q.per_day }) : '' });
}

export type PlayersView = { mpvNote: string; vlcNote: string; mpvMissing: boolean; missingText: string; installLabel: string };
/** Reproductores de esta compu: mpv incluido (o el instalado) y VLC si está; sin mpv que corra se recomienda instalarlo. */
export function playersView(p: Raw.PlayersStatus): PlayersView {
	const mpvNotes: Record<string, string> = {
		bundled: t('Incluido en la app. Recomendado: anda mejor y gasta menos.'),
		installed: t('El que tenés instalado. Recomendado: anda mejor y gasta menos.'),
		configured: t('El de la ruta que elegiste.')
	};
	return {
		vlcNote: p.vlc ? t('Sin subtítulos combinados ni ecualizador.') : t('No está instalado en esta compu.'),
		mpvNote: mpvNotes[p.mpv ?? ''] ?? t('Esta compu no puede usar el que trae la app (pide macOS 15 o más nuevo).'),
		mpvMissing: !p.mpv,
		missingText: p.vlc ? t('Mientras tanto se usa VLC. Te recomendamos instalar mpv: anda mejor y gasta menos.') : t('Sin mpv ni VLC no se puede reproducir. Instalá mpv (recomendado).'),
		installLabel: p.can_install_mpv ? t('Instalar mpv') : t('Cómo instalarlo')
	};
}

/** Con Homebrew instala mpv (minutos); si no, abre la guía. Devuelve el mensaje de estado. */
export async function installMpv(api: Pick<DesktopApi, 'installMpv'>): Promise<string> {
	return (await api.installMpv()) ? t('mpv instalado: se usa desde la próxima reproducción.') : t('Abrí la guía de instalación de mpv.');
}

/** Resultado de "Verificar puerto" (2026-11-15): por qué está cerrado, según lo que respondió el router a UPnP. */
export function netCheckView(r: Raw.IncomingCheck): { cls: 'ok' | 'bad' | ''; text: string } {
	const ip = r.local_ip ? t(' · IP de esta PC: {local_ip}', { local_ip: r.local_ip }) : '';
	const why = !r.upnp_on ? t('UPnP está apagado: abrilo a mano en el router (pasos de arriba)')
		: r.upnp === false ? t('el router rechazó abrirlo por UPnP. Suele ser porque otra PC de la casa ya tiene ese puerto, o el router lo bloquea')
		: r.upnp === true ? t('el router aceptó abrirlo, pero igual no llega: puede ser el firewall de esta PC o que tu proveedor comparta la IP pública (CGNAT)')
		: t('el router no respondió a UPnP (puede tenerlo apagado): activalo en el router o abrí el puerto a mano');
	if (r.reachable === true) return { cls: 'ok', text: t('Abierto: el puerto {port} llega desde internet{a}{ip}', { port: r.port, a: r.upnp ? t(' (lo abrió UPnP)') : '', ip }) };
	if (r.reachable === false) return { cls: 'bad', text: t('Cerrado: el puerto {port} no llega desde internet; {why}{ip}', { port: r.port, why, ip }) };
	return { cls: '', text: `${r.problem ?? t('No se pudo probar.')}${ip}` };
}

export type SettingsSnapshot = { keys: Raw.ApiKeyStatus[]; eq: Raw.Equalizer; eqIntensity: number; net: Net; latteamOn: boolean; players: Raw.PlayersStatus };
/** Todo lo que muestra Ajustes al abrirse. */
export async function loadSettings(api: Pick<DesktopApi, 'apiKeys' | 'config' | 'catalogAddons' | 'playersStatus'>): Promise<SettingsSnapshot> {
	const keys = await api.apiKeys();
	const { engine, player } = await api.config();
	const addons = await api.catalogAddons();
	const players = await api.playersStatus();
	return {
		keys,
		eq: player.equalizer,
		eqIntensity: player.equalizer_intensity ?? 100,
		net: { incoming: engine.incoming, upnp: engine.upnp, announce: engine.announce_early },
		latteamOn: addons.some((a) => a.id === 'latteam' && a.enabled),
		players
	};
}
