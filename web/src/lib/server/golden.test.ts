// Vectores compartidos con el núcleo Rust (/packages/golden/*.json): Rust es la fuente de verdad.
// Un caso con "diverge" es una diferencia conocida: acá se salta y se lista en el reporte. Los tests no corren en Vercel.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// tmdb.ts / keys.ts guardan en `.data` relativo al cwd: se trabaja en un tmp.
const work = mkdtempSync(join(tmpdir(), 'streamonte-golden-'));
const cwd = process.cwd();
process.chdir(work);
process.env.TMDB_KEY = 'x';
delete process.env.VERCEL;
const { detail, peopleOf, providersAr, showStatus } = await import('./tmdb.ts');
const { parse } = await import('./torrents.ts');
const { isSpanishSub } = await import('./torbox.ts');
const { normalize: awardsOf } = await import('./awards.ts');
after(() => {
	process.chdir(cwd);
	rmSync(work, { recursive: true, force: true });
});

type Case = { in: any; out: unknown; nota?: string; diverge?: string };
const load = (name: string): Case[] => JSON.parse(readFileSync(join(import.meta.dirname, '../../../../packages/golden', `${name}.json`), 'utf8'));
const diverged: string[] = [];

function golden(name: string, run: (input: any) => unknown) {
	for (const [i, c] of load(name).entries()) {
		const label = `${name} #${i + 1} ${JSON.stringify(c.in).slice(0, 70)}`;
		if (c.diverge) {
			diverged.push(`${label} → ${c.diverge}`);
			test(label, { skip: c.diverge }, () => {});
		} else test(label, () => assert.deepEqual(run(c.in), c.out));
	}
}

golden('providers_ar', (wp) => providersAr(wp ?? undefined));
golden('people', ({ kind, credits }) => peopleOf(kind === 'movie' ? 'movie' : 'tv', credits));
golden('show_status', (r) => {
	const { status, next } = showStatus(r);
	return { state: status, next };
});
golden('excluded', ({ countries, animation }) => detail({ origin_country: countries, genres: animation ? [{ id: 16, name: 'Animation' }] : [] }).excluded);
golden('sub_lang', (path) => isSpanishSub(path));
golden('awards', (data) => awardsOf(data));
golden('release', (name) => {
	const t = parse({ infoHash: 'a'.repeat(40), title: name }, 'golden')!;
	return { res: t.res, hdr: t.hdr, codec: t.codec, source: t.source, atmos: t.atmos };
});

after(() => {
	if (diverged.length) console.log(`\nDivergencias web ↔ Rust (${diverged.length}):\n${diverged.map((d) => `  - ${d}`).join('\n')}`);
});
