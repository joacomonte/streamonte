import { test } from 'node:test';
import assert from 'node:assert/strict';
import EN from '../i18n/en.ts';
import { NET } from './net.ts';

// Los textos de NET se traducen al mostrarlos (`t(n.label)`): i18n.test.ts no los ve porque no son literales en una llamada a t.
test('NET: cada etiqueta y rango tiene su traducción en en.ts', () => {
	const missing = NET.flatMap((n) => [n.label, n.range]).filter((s) => !(s in EN));
	assert.deepEqual(missing, []);
});
