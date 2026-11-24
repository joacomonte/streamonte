import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, checkCode, enter, hashCode, isAlert, loginOrder, memoryStore, parseCode, pickHelp } from './apodos.ts';
import { canSign, sign, unsign, verifiedNick } from './apodo-session.ts';
import { ANIMAL_IDS, HELP_SIZE } from '../../../../packages/ui/src/animals/animals.ts';

test('parseCode: 2 ids distintos y conocidos, en orden', () => {
	assert.deepEqual(parseCode(['okapi', 'yaguarete']), [12, 0]);
	assert.equal(parseCode(['okapi', 'okapi']), null);
	assert.equal(parseCode(['okapi']), null);
	assert.equal(parseCode(['okapi', 'gato']), null);
	assert.equal(parseCode('okapi,yaguarete'), null);
});

test('hash: acierta el mismo código, en el mismo orden; sal distinta cada vez', async () => {
	const a = await hashCode([3, 7]);
	const b = await hashCode([3, 7]);
	assert.notEqual(a.hash, b.hash);
	assert.ok(await checkCode([3, 7], a.hash, a.sal));
	assert.ok(!(await checkCode([7, 3], a.hash, a.sal)));
	assert.ok(!(await checkCode([3, 8], a.hash, a.sal)));
	assert.ok(!(await checkCode([3, 7], b.hash, a.sal)));
});

test('ayuda: 12 cartas distintas con los 2 del código adentro', () => {
	for (let n = 0; n < 200; n++) {
		const code = [n % 20, (n * 7 + 3) % 20 === n % 20 ? (n + 1) % 20 : (n * 7 + 3) % 20];
		const help = pickHelp(code);
		assert.equal(help.length, HELP_SIZE);
		assert.equal(new Set(help).size, HELP_SIZE);
		for (const c of code) assert.ok(help.includes(c));
		assert.ok(help.every((i) => i >= 0 && i < ANIMAL_IDS.length));
	}
});

test('login: las 12 de la ayuda primero (fijas por apodo), después las otras 8', async () => {
	const s = memoryStore();
	const r = await enter(s, 'Ana', [4, 9], 'nuevo');
	assert.ok(r.ok);
	const first = await ask(s, 'Ana');
	assert.equal(first.mode, 'login');
	assert.equal(first.order.length, ANIMAL_IDS.length);
	assert.equal(new Set(first.order).size, ANIMAL_IDS.length);
	const top = first.order.slice(0, HELP_SIZE);
	assert.ok(top.includes(ANIMAL_IDS[4]) && top.includes(ANIMAL_IDS[9]));
	// Los señuelos no cambian entre intentos (fallidos o no).
	await enter(s, 'Ana', [1, 2], 'login');
	assert.deepEqual((await ask(s, 'Ana')).order, first.order);
	// Las 8 restantes, en el orden de siempre.
	const rest = first.order.slice(HELP_SIZE);
	assert.deepEqual(rest, ANIMAL_IDS.filter((id) => rest.includes(id)));
	assert.deepEqual(loginOrder([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), [...ANIMAL_IDS]);
});

test('apodo sin código: modo nuevo con las 20 en orden; crear dos veces no pisa', async () => {
	const s = memoryStore();
	assert.deepEqual(await ask(s, 'Leo'), { mode: 'nuevo', order: [...ANIMAL_IDS], wait: 0 });
	assert.ok((await enter(s, 'Leo', [0, 1], 'nuevo')).ok);
	assert.deepEqual(await enter(s, 'Leo', [2, 3], 'nuevo'), { ok: false, reason: 'taken' });
	assert.deepEqual(await enter(s, 'Otro', [2, 3], 'login'), { ok: false, reason: 'taken' });
});

test('espera: después de un error se rechaza todo intento por 15 s (también el bueno); sin bloqueo', async () => {
	let now = 1_000_000;
	const s = memoryStore(() => now);
	await enter(s, 'Bea', [5, 6], 'nuevo');
	assert.deepEqual(await enter(s, 'Bea', [6, 5], 'login'), { ok: false, reason: 'wrong', wait: 15 });
	now += 5_000;
	assert.deepEqual(await enter(s, 'Bea', [5, 6], 'login'), { ok: false, reason: 'wait', wait: 10 });
	assert.equal((await ask(s, 'Bea', now)).wait, 10);
	now += 10_000;
	// Muchos fallos seguidos (cada 15 s) no bloquean: el bueno entra.
	for (let n = 0; n < 6; n++) {
		assert.equal((await enter(s, 'Bea', [1, 2], 'login')).ok, false);
		now += 15_000;
	}
	assert.equal((await s.get('Bea'))?.fallos, 7);
	const ok = await enter(s, 'Bea', [5, 6], 'login');
	assert.ok(ok.ok);
	assert.equal((await s.get('Bea'))?.fallos, 7);
	assert.equal((await s.get('Bea'))?.esperaHasta, null);
});

test('alerta: con más de 3 fallos; vista se va hasta un fallo nuevo; acertar no la borra, resetear sí', async () => {
	let now = 0;
	const s = memoryStore(() => now);
	await enter(s, 'Cata', [0, 1], 'nuevo');
	const fail = async () => {
		await enter(s, 'Cata', [1, 0], 'login');
		now += 15_000;
	};
	for (let n = 0; n < 3; n++) await fail();
	assert.equal((await s.alerts()).length, 0);
	await fail();
	assert.deepEqual((await s.alerts()).map((r) => [r.apodo, r.fallos]), [['Cata', 4]]);
	await s.markSeen('Cata');
	assert.equal((await s.alerts()).length, 0);
	await fail();
	assert.equal((await s.alerts()).length, 1);
	for (let n = 0; n < 3; n++) await fail();
	assert.equal((await s.alerts()).length, 1);
	await s.reset('Cata');
	assert.equal((await s.alerts()).length, 0);
	assert.equal((await ask(s, 'Cata')).mode, 'nuevo');
	assert.ok(isAlert({ fallos: 4, vistaFallos: 0 }) && !isAlert({ fallos: 3, vistaFallos: 0 }));
});

test('alerta: 4 fallos y después un acierto, la alerta sigue (y el acierto no espera)', async () => {
	let now = 0;
	const s = memoryStore(() => now);
	await enter(s, 'Fede', [0, 1], 'nuevo');
	for (let n = 0; n < 4; n++) {
		await enter(s, 'Fede', [1, 0], 'login');
		now += 15_000;
	}
	assert.ok((await enter(s, 'Fede', [0, 1], 'login')).ok);
	assert.deepEqual((await s.alerts()).map((r) => [r.apodo, r.fallos]), [['Fede', 4]]);
	assert.equal((await ask(s, 'Fede', now)).wait, 0);
	await s.markSeen('Fede');
	assert.equal((await s.alerts()).length, 0);
});

test('sesión: firma que no se puede forjar y que vence al resetear el código', async () => {
	const key = 'clave-de-prueba';
	const v = sign('Dani', 123, key);
	assert.deepEqual(unsign(v, key), { nick: 'Dani', version: 123 });
	assert.equal(unsign(v, 'otra-clave'), null);
	const [n, , m] = v.split('.');
	assert.equal(unsign(`${n}.124.${m}`, key), null);
	assert.equal(unsign(`${Buffer.from('Eva').toString('base64url')}.123.${m}`, key), null);
	assert.equal(unsign('Dani', key), null);
	assert.equal(unsign(undefined, key), null);

	const s = memoryStore();
	const r = await enter(s, 'Dani', [0, 1], 'nuevo');
	assert.ok(r.ok);
	const cookie = sign('Dani', r.version);
	assert.equal(await verifiedNick(() => cookie, s), 'Dani');
	assert.equal(await verifiedNick(() => undefined, s), null);
	await s.reset('Dani');
	assert.equal(await verifiedNick(() => cookie, s), null);
});

test('sin APODO_SECRET en Vercel no se puede firmar (y /api/nick no crea el código)', () => {
	const prev = { v: process.env.VERCEL, s: process.env.APODO_SECRET };
	try {
		process.env.VERCEL = '1';
		delete process.env.APODO_SECRET;
		assert.equal(canSign(), false);
		process.env.APODO_SECRET = 'algo';
		assert.equal(canSign(), true);
	} finally {
		if (prev.v === undefined) delete process.env.VERCEL;
		else process.env.VERCEL = prev.v;
		if (prev.s === undefined) delete process.env.APODO_SECRET;
		else process.env.APODO_SECRET = prev.s;
	}
});
