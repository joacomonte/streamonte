// Globales del webview Tauri (withGlobalTauri). Lo mínimo que usa la UI.
interface TauriUpdate {
  version: string;
  downloadAndInstall(): Promise<void>;
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
