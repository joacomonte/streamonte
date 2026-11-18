import { tracks } from '#lib/server/torbox.js';
import { Fail, route } from '#lib/server/http.js';
import { episode } from '#lib/server/params.js';

// Subtítulos en español y audios que trae un torrent adentro (encabezado del archivo por el link de descarga).
// Con `tid` y `fid` (de un link ya copiado) no se vuelve a agregar el torrent: un solo pedido a TorBox.
export const GET = route(async ({ url }) => {
	const p = url.searchParams;
	const hash = p.get('hash')?.toLowerCase() ?? '';
	if (!/^[0-9a-f]{40}$/.test(hash)) throw new Fail(400, 'Hash inválido.');
	const { s, e } = episode(url);
	const tid = Number(p.get('tid')), fid = Number(p.get('fid'));
	const ids = Number.isInteger(tid) && tid > 0 && Number.isInteger(fid) && fid >= 0 && p.has('fid') ? { tid, fid } : null;
	return tracks({ hash, name: p.get('name') ?? '', file: p.get('file') || null, s, e }, ids);
});
