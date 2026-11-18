import { premiumQuota } from '#lib/server/subs.js';
import { route } from '#lib/server/http.js';

/** Cuota de Premium sin pedir nada (se sabe recién con la primera descarga). */
export const GET = route(() => premiumQuota());
