// Stub del proxy de TorBox para el desktop ≤ v2.1.4. Desde la v2.1.5 el desktop usa TorBox directo con la key de cada
// usuario (commit d387e13) y esta ruta ya no reenvía nada: los clientes viejos reciben el aviso de abajo.
// Ese cliente solo muestra "error HTTP <status>" y trata un 401 como "código incorrecto" (pide cargarlo en Ajustes).
import type { RequestHandler } from './$types';

const stub: RequestHandler = () =>
	new Response(JSON.stringify({ error: 'TorBox deshabilitado: cargá tu API key de TorBox en Ajustes' }), {
		status: 401,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});

export const GET = stub;
export const POST = stub;
