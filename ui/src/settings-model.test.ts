// Ajustes sin DOM: qué comando llama cada guardado y las validaciones, con un `DesktopApi` falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMpv, loadSettings, netCheckView, osLoginText, playersView, saveEqualizer, saveKey, saveLatTeamToken, saveNetwork, saveOsLogin, saveTorboxCode, setTorboxShared, toggleLatTeam } from './settings-model.ts';
import type * as Raw from './types.js';

/** Registra cada comando como "nombre(args)"; el resto de la API no se toca. */
function fake() {
	const calls: string[] = [];
	const rec = (name: string) => (...args: unknown[]): Promise<void> => (calls.push(`${name}(${args.map(String).join(',')})`), Promise.resolve());
	return {
		calls,
		api: {
			setApiKey: rec('setApiKey'), setNetwork: rec('setNetwork'), setEqualizer: rec('setEqualizer'), setTorboxShared: rec('setTorboxShared'),
			setOpensubtitlesLogin: rec('setOpensubtitlesLogin'), catalogSetAddonEnabled: rec('catalogSetAddonEnabled'),
			installMpv: (): Promise<boolean> => (calls.push('installMpv()'), Promise.resolve(true))
		}
	};
}

test('saveKey: recorta, guarda con setApiKey y avisa solo para TMDB/TorBox', async () => {
	const f = fake();
	const tmdb = await saveKey(f.api, 'tmdb', '  abc ');
	assert.deepEqual(f.calls, ['setApiKey(tmdb,abc)']);
	assert.equal(tmdb.event, 'streamonte:tmdb-key');
	assert.equal(tmdb.cleared, false);
	assert.equal((await saveKey(f.api, 'torbox', 'k')).event, 'streamonte:torbox-key');
	assert.equal((await saveKey(f.api, 'wyzie', 'k')).event, null);
	assert.ok((await saveKey(f.api, 'torbox', 'k')).done.includes('TorBox'));
});

test('saveKey: vacía = borrar (setApiKey con "")', async () => {
	const f = fake();
	const r = await saveKey(f.api, 'wyzie', '   ');
	assert.deepEqual(f.calls, ['setApiKey(wyzie,)']);
	assert.equal(r.cleared, true);
	assert.equal(r.done, '');
});

test('saveTorboxCode: 3 dígitos; inválido no llama al núcleo; vacío borra', async () => {
	const f = fake();
	for (const bad of ['12', '1234', 'abc', '12a']) assert.deepEqual(await saveTorboxCode(f.api, bad), { error: 'Son 3 dígitos.' });
	assert.deepEqual(f.calls, []);
	assert.equal((await saveTorboxCode(f.api, ' 123 ')).error, null);
	assert.equal((await saveTorboxCode(f.api, '')).error, null);
	assert.deepEqual(f.calls, ['setApiKey(streamonte-code,123)', 'setApiKey(streamonte-code,)']);
});

test('cada guardado llama a su comando', async () => {
	const f = fake();
	await setTorboxShared(f.api, true);
	await toggleLatTeam(f.api, false);
	await saveLatTeamToken(f.api, ' tok ');
	await saveOsLogin(f.api, ' user ', ' p ');
	await saveEqualizer(f.api, 'voices');
	await saveNetwork(f.api, { incoming: true, upnp: false, announce: true });
	assert.deepEqual(f.calls, [
		'setTorboxShared(true)', 'catalogSetAddonEnabled(latteam,false)', 'setApiKey(latteam,tok)',
		'setOpensubtitlesLogin(user, p )', 'setEqualizer(voices)', 'setNetwork(true,false,true)'
	]);
	assert.ok((await installMpv(f.api)).startsWith('mpv instalado'));
});

test('loadSettings arma el estado desde config, keys, addons y reproductores', async () => {
	const s = await loadSettings({
		apiKeys: () => Promise.resolve([{ service: 'tmdb', configured: true }]),
		config: () => Promise.resolve({ engine: { incoming: true, upnp: false, announce_early: true }, player: { equalizer: 'flat' }, catalog: { torbox_shared: true } } as Raw.Config),
		catalogAddons: () => Promise.resolve([{ id: 'latteam', enabled: true }, { id: 'x', enabled: false }] as Raw.AddonView[]),
		playersStatus: () => Promise.resolve({ mpv: null, vlc: true, can_install_mpv: true })
	});
	assert.deepEqual(s.net, { incoming: true, upnp: false, announce: true });
	assert.equal(s.eq, 'flat');
	assert.equal(s.shared, true);
	assert.equal(s.latteamOn, true);
	assert.equal(s.keys.length, 1);
});

test('playersView: sin mpv se recomienda instalarlo (con VLC o sin nada)', () => {
	const none = playersView({ mpv: null, vlc: false, can_install_mpv: false });
	assert.equal(none.mpvMissing, true);
	assert.ok(none.missingText.startsWith('Sin mpv ni VLC'));
	assert.equal(none.installLabel, 'Cómo instalarlo');
	const vlc = playersView({ mpv: null, vlc: true, can_install_mpv: true });
	assert.ok(vlc.missingText.startsWith('Mientras tanto se usa VLC'));
	assert.equal(vlc.installLabel, 'Instalar mpv');
	const ok = playersView({ mpv: 'bundled', vlc: false, can_install_mpv: false });
	assert.equal(ok.mpvMissing, false);
	assert.ok(ok.mpvNote.startsWith('Incluido'));
});

test('osLoginText: sin cuenta, error y conectada con cuota', () => {
	const q = { has_key: false, has_login: true, login_error: null, remaining: 7, per_day: 20, resets_at: null };
	assert.ok(osLoginText(null).startsWith('Sin cuenta'));
	assert.ok(osLoginText({ ...q, has_login: false }).startsWith('Sin cuenta'));
	assert.equal(osLoginText({ ...q, login_error: 'mala clave' }), 'No se pudo entrar: mala clave');
	assert.equal(osLoginText(q), 'Cuenta conectada · quedan 7 de 20 descargas hoy.');
	assert.equal(osLoginText({ ...q, remaining: null }), 'Cuenta conectada.');
});

test('netCheckView: abierto, cerrado (con la causa según UPnP) y sin prueba', () => {
	const base = { port: 41850, reachable: null, upnp_on: true, upnp: null, local_ip: '192.168.0.5', problem: null } as Raw.IncomingCheck;
	assert.deepEqual(netCheckView({ ...base, reachable: true, upnp: true }), { cls: 'ok', text: 'Abierto: el puerto 41850 llega desde internet (lo abrió UPnP) · IP de esta PC: 192.168.0.5' });
	const closed = netCheckView({ ...base, reachable: false, upnp_on: false });
	assert.equal(closed.cls, 'bad');
	assert.ok(closed.text.includes('UPnP está apagado'));
	assert.ok(netCheckView({ ...base, reachable: false, upnp: false }).text.includes('rechazó'));
	assert.deepEqual(netCheckView({ ...base, problem: 'sin red', local_ip: null }), { cls: '', text: 'sin red' });
});
