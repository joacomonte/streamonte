/** Los idiomas que eligió hooks.server.js, para el primer render (`info`: sinopsis como los títulos o como la app). */
export const load = ({ locals, cookies }) => ({ langs: locals.langs, info: cookies.get('info') === 'app' ? 'app' : 'titles' });
