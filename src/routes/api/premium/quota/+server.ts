import { premiumQuota } from '#lib/server/subs.ts';
import { route } from '#lib/server/http.ts';

/** Cuota de Premium sin pedir nada (se sabe recién con la primera descarga). */
export const GET = route(() => premiumQuota());
