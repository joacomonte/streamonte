import { genres } from '#lib/server/tmdb.ts';
import { route } from '#lib/server/http.ts';

export const GET = route(({ url }) => genres(url.searchParams.get('kind') === 'tv' ? 'tv' : 'movie'), { cdn: 86400, perLang: true });
