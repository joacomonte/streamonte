import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardStep, resumeIndex } from './tour-state.ts';
import { welcomeSteps } from './tours.ts';

test('guardStep: sin apodo no pasa del paso del apodo', () => {
	assert.equal(guardStep(3, 1, false), 1);
	assert.equal(guardStep(1, 1, false), 1);
	assert.equal(guardStep(0, 1, false), 0);
	assert.equal(guardStep(5, 1, true), 5);
	assert.equal(guardStep(5, -1, false), 5);
});

test('resumeIndex: acota lo guardado', () => {
	assert.equal(resumeIndex(null, 5), 0);
	assert.equal(resumeIndex('3', 5), 3);
	assert.equal(resumeIndex('99', 5), 4);
	assert.equal(resumeIndex('basura', 5), 0);
	assert.equal(resumeIndex('-2', 5), 0);
});

test('welcomeSteps: tiene un solo paso de apodo, antes de lo que sigue', () => {
	const steps = welcomeSteps('android');
	assert.equal(steps.filter((s) => s.nick).length, 1);
	assert.ok(steps.findIndex((s) => s.nick) < steps.length - 1);
});
