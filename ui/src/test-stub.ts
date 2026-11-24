// Entorno mínimo de webview para correr módulos de la UI con `node --test`: se importa PRIMERO
// (i18n.ts lee la config con un await al cargar y usa `document`). No es un test.
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.__TAURI__ = {
  core: { invoke: () => Promise.resolve({ language: { app: 'es', titles: 'es' } }) },
  event: { listen: () => Promise.resolve(() => {}) },
};
g.document = { documentElement: {}, dispatchEvent() { return true; } };
const store = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
