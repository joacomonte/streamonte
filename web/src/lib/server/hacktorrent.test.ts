import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromDownloads, isMatch } from './hacktorrent.ts';

// Mismos casos que crates/core/src/catalog/wpreact.rs (ficha real de hacktorrent.cc recortada: Los locos Addams 1991).
test('fromDownloads: magnet → torrent con idioma, resolución y tamaño', () => {
	const list = fromDownloads([
		{ quality: 'Dual 1080p', size: '2.91 GB', download_link: 'magnet:?xt=urn:btih:11D28409E84E630AFA6F105F5746CC3B168CBE6B&dn=Los.locos.Addams.1991.1080p-dual-lat&tr=udp%3a%2f%2ftracker.opentrackr.org%3a1337%2fannounce', language: 'Latino/Inglés' },
		{ quality: 'WEB-DL 4k DV HDR', size: '18.4 GB', download_link: 'magnet:?xt=urn:btih:47F3ACFCE7A0B580047EA64598BB2FC3963867BE&dn=Arthur.2024.2160p', language: 'Castellano' },
		{ quality: 'DVD Rip', size: '498 MB', download_link: 'magnet:?xt=urn:btih:22526157035B7E798D4815C15D7F7F53331D5F7D&dn=Los.locos.Addams.1991.DVDrip-lat', language: 'Latino' },
		{ quality: 'HD', download_link: 'https://sitio/no-es-magnet', language: 'Latino' }
	]);
	assert.equal(list.length, 3); // el link que no es magnet se descarta
	assert.equal(list[0].hash, '11d28409e84e630afa6f105f5746cc3b168cbe6b');
	assert.equal(list[0].release, 'Los.locos.Addams.1991.1080p-dual-lat');
	assert.deepEqual(list[0].addons, ['Hacktorrent']);
	assert.equal(list[0].res, '1080p');
	assert.equal(list[0].hint, 'lat');
	assert.equal(list[0].size, Math.round(2.91 * 1024 ** 3));
	assert.equal(list[1].hint, 'spain');
	assert.equal(list[1].res, '2160p');
	assert.deepEqual(list[1].hdr, ['HDR', 'DV']);
	assert.equal(list[2].hint, 'lat');
});

test('isMatch: por TMDB id o, sin él, por año y título', () => {
	const hits = [
		{ slug: 'a', title: 'Los Locos Addams', year: '2019', tmdb_id: '481084', type: 'pelicula' },
		{ slug: 'b', title: 'Los Locos Addams', year: '1991', tmdb_id: 2907, type: 'pelicula' },
		{ slug: 'c', title: 'Los Locos Addams', year: '1991', tmdb_id: '2907', type: 'serie' }
	];
	assert.equal(hits.find((h) => isMatch(h, { titles: ['Los locos Addams'], tmdb: 2907, year: 1991 }))?.slug, 'b');
	assert.equal(hits.find((h) => isMatch(h, { titles: ['Los locos Addams'], tmdb: null, year: 2019 }))?.slug, 'a');
});
