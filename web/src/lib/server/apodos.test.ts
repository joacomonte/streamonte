import { test } from 'node:test';
import { randomBytes, scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { ask, checkCode, enter, hashCode, isAlert, loginOrder, memoryStore, parseCode, pickHelp } from './apodos.ts';
import { openCode, sealCode } from './apodo-cifrado.ts';
import { canSign, ownAnimals, sign, unsign, verifiedNick } from './apodo-session.ts';
import { ANIMAL_IDS, HELP_SIZE } from '../../../../packages/ui/src/animals/animals.ts';

test('parseCode: 2 ids distintos y conocidos', () => {
	assert.deepEqual(parseCode(['okapi', 'yaguarete']), [12, 0]);
	assert.equal(parseCode(['okapi', 'okapi']), null);
	assert.equal(parseCode(['okapi']), null);
	assert.equal(parseCode(['okapi', 'gato']), null);
	assert.equal(parseCode('okapi,yaguarete'), null);
});

test('hash: acierta el mismo código en cualquier orden; sal distinta cada vez', async () => {
	const a = await hashCode([7, 3]);
	const b = await hashCode([3, 7]);
	assert.notEqual(a.hash, b.hash);
	assert.deepEqual(await checkCode([3, 7], a.hash, a.sal), { ok: true, legacy: false });
	assert.deepEqual(await checkCode([7, 3], a.hash, a.sal), { ok: true, legacy: false });
	assert.equal((await checkCode([3, 8], a.hash, a.sal)).ok, false);
	assert.equal((await checkCode([3, 7], b.hash, a.sal)).ok, false);
});

test('entrar sin orden: el par invertido entra; uno equivocado no', async () => {
	let now = 0;
	const s = memoryStore(() => now);
	await enter(s, 'Zoe', [9, 4], 'nuevo');
	assert.ok((await enter(s, 'Zoe', [4, 9], 'login')).ok);
	now += 15_000;
	assert.ok((await enter(s, 'Zoe', [9, 4], 'login')).ok);
	now += 15_000;
	assert.deepEqual(await enter(s, 'Zoe', [4, 8], 'login'), { ok: false, reason: 'wrong', wait: 15 });
});

test('código viejo hasheado en orden: entra con cualquiera de los 2 órdenes y queda re-hasheado canónico', async () => {
	// Hash viejo: scrypt sobre el par en el orden elegido (mismo formato que antes).
	const old = (code: number[]) => {
		const sal = randomBytes(16);
		return { hash: scryptSync(code.join('.'), sal, 32, { N: 2 ** 14 }).toString('base64'), sal: sal.toString('base64') };
	};
	for (const [apodo, elegido, intento] of [['V1', [9, 4], [9, 4]], ['V2', [9, 4], [4, 9]], ['V3', [4, 9], [9, 4]], ['V4', [4, 9], [4, 9]]] as [string, number[], number[]][]) {
		const s = memoryStore();
		const { hash, sal } = old(elegido);
		await s.create(apodo, hash, sal, pickHelp(elegido), sealCode(elegido));
		const antes = (await s.get(apodo))!;
		assert.ok((await enter(s, apodo, intento, 'login')).ok, apodo);
		const row = (await s.get(apodo))!;
		assert.equal(row.creado.getTime(), antes.creado.getTime());
		assert.deepEqual(openCode(row.cifrado!), [4, 9]);
		if (elegido[0] === 9) {
			// El hash viejo invertido ya no vale: ahora es el canónico (con sal nueva).
			assert.notEqual(row.hash, hash);
			assert.ok((await checkCode([4, 9], row.hash, row.sal)).ok && !(await checkCode([4, 9], row.hash, row.sal)).legacy);
		}
	}
	// Un par equivocado no entra ni cambia nada.
	const s = memoryStore();
	const { hash, sal } = old([9, 4]);
	await s.create('V5', hash, sal, pickHelp([9, 4]), '');
	assert.equal((await enter(s, 'V5', [4, 8], 'login')).ok, false);
	assert.equal((await s.get('V5'))!.hash, hash);
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
	assert.deepEqual(await enter(s, 'Bea', [5, 7], 'login'), { ok: false, reason: 'wrong', wait: 15 });
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
		await enter(s, 'Cata', [2, 3], 'login');
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
		await enter(s, 'Fede', [2, 3], 'login');
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

test('cifrado: vuelve al par; otro APODO_SECRET no lo abre; IV al azar', () => {
	const a = sealCode([3, 17], 'secreto-a');
	assert.deepEqual(openCode(a, 'secreto-a'), [3, 17]);
	assert.equal(openCode(a, 'secreto-b'), null);
	assert.notEqual(a, sealCode([3, 17], 'secreto-a'));
	assert.equal(openCode('basura', 'secreto-a'), null);
});

test('cifrado: se guarda al crear; acertar completa un código viejo; resetear lo borra', async () => {
	const s = memoryStore();
	await enter(s, 'Gus', [4, 9], 'nuevo');
	assert.deepEqual(openCode((await s.get('Gus'))!.cifrado!), [4, 9]);
	// Código viejo: fila sin cifrado.
	const { hash, sal } = await hashCode([2, 5]);
	await s.create('Vieja', hash, sal, pickHelp([2, 5]), '');
	assert.ok(!(await s.get('Vieja'))!.cifrado);
	assert.ok((await enter(s, 'Vieja', [2, 5], 'login')).ok);
	assert.deepEqual(openCode((await s.get('Vieja'))!.cifrado!), [2, 5]);
	await s.reset('Vieja');
	assert.equal(await s.get('Vieja'), null);
});

test('ownAnimals: solo el dueño con sesión; sin sesión o con la de otro apodo, nada', async () => {
	const s = memoryStore();
	const a = await enter(s, 'Hugo', [0, 12], 'nuevo');
	const b = await enter(s, 'Ines', [1, 2], 'nuevo');
	assert.ok(a.ok && b.ok);
	const hugo = sign('Hugo', a.version);
	assert.deepEqual(await ownAnimals((n) => (n === 'apodo' ? hugo : undefined), s), { nick: 'Hugo', animals: [ANIMAL_IDS[0], ANIMAL_IDS[12]] });
	assert.equal(await ownAnimals(() => undefined, s), null);
	// Cookie de Hugo con la versión de Ines, o sin firma: nada.
	assert.equal(await ownAnimals((n) => (n === 'apodo' ? sign('Hugo', b.version + 1) : undefined), s), null);
	assert.equal(await ownAnimals((n) => (n === 'apodo' ? 'Ines' : undefined), s), null);
	// Código viejo sin cifrado: sesión válida, animales null.
	const { hash, sal } = await hashCode([2, 5]);
	const v = (await s.create('Vieja', hash, sal, pickHelp([2, 5]), ''))!;
	assert.deepEqual(await ownAnimals((n) => (n === 'apodo' ? sign('Vieja', v.getTime()) : undefined), s), { nick: 'Vieja', animals: null });
	await s.reset('Hugo');
	assert.equal(await ownAnimals((n) => (n === 'apodo' ? hugo : undefined), s), null);
});
