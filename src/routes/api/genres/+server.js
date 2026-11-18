import { genres } from '#lib/server/tmdb.js';
import { route } from '#lib/server/http.js';

export const GET = route(({ url }) => genres(url.searchParams.get('kind') === 'tv' ? 'tv' : 'movie'));
