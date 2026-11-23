// Globales del webview Tauri (withGlobalTauri). Lo mínimo que usa la UI.
type TauriDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };
interface TauriUpdate {
  version: string;
  downloadAndInstall(onEvent?: (e: TauriDownloadEvent) => void): Promise<void>;
}
interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(name: string, handler: (e: { payload: T }) => void): Promise<() => void> };
  updater: { check(opts?: { timeout?: number }): Promise<TauriUpdate | null> };
  process: { relaunch(): Promise<void> };
}
interface Window {
  __TAURI__: TauriGlobal;
}
// Los tipos mínimos de Node para los tests (node:test, node:assert/strict, node:fs) viven en packages/ui/src/globals.d.ts.
// Para vite.config.ts (sin @types/node).
declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string;
}
