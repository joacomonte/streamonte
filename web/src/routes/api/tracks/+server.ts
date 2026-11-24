import { tracks } from '#lib/server/torbox.ts';
import { route } from '#lib/server/http.ts';
import { episode, hash40 } from '#lib/server/params.ts';

// Subtítulos en español y audios que trae un torrent adentro (encabezado del archivo por el link de descarga).
// Con `tid` y `fid` (de un link ya copiado) no se vuelve a agregar el torrent: un solo pedido a TorBox.
export const GET = route(async ({ url }) => {
	const p = url.searchParams;
	const hash = hash40(url);
	const { s, e } = episode(url);
	const tid = Number(p.get('tid')), fid = Number(p.get('fid'));
	const ids = Number.isInteger(tid) && tid > 0 && Number.isInteger(fid) && fid >= 0 && p.has('fid') ? { tid, fid } : null;
	return tracks({ hash, name: p.get('name') ?? '', file: p.get('file') || null, s, e }, ids);
});
