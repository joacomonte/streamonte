import { test } from 'node:test';
import assert from 'node:assert/strict';
import { members, results, seconds, utf8 } from './subs.ts';

test('members: string/int/double, trim de nombre y entidades XML', () => {
	const xml = '<struct><member><name> token </name><value><string>a&amp;b&lt;c</string></value></member><member><name>n</name><value><int>42</int></value></member><member><name>f</name><value><double>1.5</double></value></member></struct>';
	assert.deepEqual(members(xml), { token: 'a&b<c', n: '42', f: '1.5' });
});

test('members: valor sin tipo y vacío', () => {
	assert.deepEqual(members('<member><name>x</name><value>plano</value></member><member><name>y</name><value><string></string></value></member>'), { x: 'plano', y: '' });
});

test('results: una fila por struct después de "data"; sin data -> []', () => {
	const row = (id: string) => `<struct><member><name>IDSubtitleFile</name><value><string>${id}</string></value></member></struct>`;
	const xml = `<name>status</name><value><string>200 OK</string></value><name>data</name><array><data><value>${row('1')}</value><value>${row('2')}</value></data></array>`;
	assert.deepEqual(results(xml), [{ IDSubtitleFile: '1' }, { IDSubtitleFile: '2' }]);
	assert.deepEqual(results('<name>status</name>'), []);
});

test('seconds: hh:mm:ss, con milis y sin dato', () => {
	assert.equal(seconds('01:02:03'), 3723);
	assert.equal(seconds('00:00:09,500'), 9);
	assert.equal(seconds(undefined), null);
	assert.equal(seconds('basura'), null);
});

test('utf8: UTF-8 válido, Windows-1252 de respaldo y BOM', () => {
	assert.equal(utf8(Buffer.from('mañana')), 'mañana');
	assert.equal(utf8(Buffer.from([0x6d, 0x61, 0xf1, 0x61, 0x6e, 0x61])), 'mañana');
	assert.equal(utf8(Buffer.from('﻿hola')), 'hola');
});
