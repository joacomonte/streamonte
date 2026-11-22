// Entorno mínimo de webview para correr módulos de la UI con `deno test --no-check`: se importa PRIMERO
// (i18n.js lee la config con un await al cargar y usa `document`). No es un test.
const g = /** @type {any} */ (globalThis);
g.window = globalThis;
g.__TAURI__ = {
  core: { invoke: () => Promise.resolve({ language: { app: 'es', titles: 'es' } }) },
  event: { listen: () => Promise.resolve(() => {}) },
};
g.document = { documentElement: {}, dispatchEvent() { return true; } };
/** @type {Map<string, string>} */
const store = new Map();
g.localStorage = {
  getItem: (/** @type {string} */ k) => store.get(k) ?? null,
  setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, String(v)),
  removeItem: (/** @type {string} */ k) => void store.delete(k),
};
