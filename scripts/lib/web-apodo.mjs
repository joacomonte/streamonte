// Sesión de un apodo de prueba en la web local (la cookie firmada `apodo`, ver web/src/lib/server/apodo-session.ts):
// sin ella la web abre la bienvenida con apodo + código de animales. Crea el código la primera vez (base en memoria del
// vite, sin DATABASE_URL) y entra con el mismo las siguientes. Código fijo: lo usa el contrato `web-apodo-login`.
export const TEST_NICK = 'Joaco';
export const TEST_CODE = ['yaguarete', 'okapi'];

/** Valor de la cookie `apodo` para `nick` en la web de `base`. */
export async function apodoCookie(base, nick = TEST_NICK, code = TEST_CODE) {
  for (const mode of ['nuevo', 'login']) {
    const r = await fetch(`${base}/api/nick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick, code, mode }) });
    const value = r.headers.getSetCookie().map((c) => c.match(/^apodo=([^;]+)/)?.[1]).find(Boolean);
    if (r.ok && value) return value;
    if (r.status !== 409) throw new Error(`no se pudo entrar como ${nick} (${r.status})`);
  }
  throw new Error(`no se pudo entrar como ${nick}`);
}
