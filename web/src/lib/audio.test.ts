import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioOf, latStatus } from './audio.ts';

test('audioOf: el mejor español de las pistas', () => {
	assert.equal(audioOf([{ language: 'spa', title: 'Latino DD 5.1' }]), 'lat');
	assert.equal(audioOf([{ language: 'es-419', title: '' }]), 'lat');
	assert.equal(audioOf([{ language: 'spa', title: 'Castellano' }]), 'spain');
	assert.equal(audioOf([{ language: 'spa', title: 'AC3 5.1' }]), 'es');
	assert.equal(audioOf([{ language: 'eng', title: '' }]), 'none');
});

test('latStatus: las pistas leídas ganan; "es" sin variante deja decidir al nombre', () => {
	assert.equal(latStatus({ hint: 'lat' }, { subs: 0, audio: 'es' }), 'lat');
	assert.equal(latStatus({ hint: 'lat' }, { subs: 0, audio: 'spain' }), 'spain');
	assert.equal(latStatus({ hint: null }, { subs: 0, audio: 'es' }), 'check');
	assert.equal(latStatus({ hint: 'likely' }, null), 'likely');
});
