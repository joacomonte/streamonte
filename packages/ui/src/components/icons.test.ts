import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ICONS } from './icons.ts';

const ROOT = new URL('../../../../', import.meta.url);

function sources(dir: URL): URL[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
		if (f.name === 'node_modules' || f.name === 'dist') return [];
		const url = new URL(f.isDirectory() ? `${f.name}/` : f.name, dir);
		return f.isDirectory() ? sources(url) : /\.(svelte|js|ts)$/.test(f.name) && !/\.test\./.test(f.name) ? [url] : [];
	});
}

test('cada ícono con nombre literal (web, ui, packages) existe en el set', () => {
	const used = new Map<string, string>();
	const re = /<Icon\b[^>]*?\bname="([a-z-]+)"|\bicon\('([a-z-]+)'|\bicon: '([a-z-]+)'|\bappIcon[=:] ?["']([a-z-]+)["']/g;
	for (const dir of ['web/src/', 'ui/src/', 'packages/ui/src/']) {
		for (const file of sources(new URL(dir, ROOT))) {
			for (const m of readFileSync(file, 'utf8').matchAll(re)) used.set(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '', file.pathname);
		}
	}
	assert.ok(used.size > 10, 'el escaneo encontró íconos');
	const missing = [...used].filter(([name]) => !(name in ICONS)).map(([name, file]) => `${name} (${file})`);
	assert.deepEqual(missing, []);
});
