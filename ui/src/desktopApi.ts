// Comandos solo del desktop (Ajustes, limpieza, velocidad, cierre): salen de `api.js`, que sigue siendo la única puerta al
// núcleo. NO están en `Api` de packages/ui (la web no los tiene). Los modelos reciben `DesktopApi` por parámetro para probarse sin Tauri.
import { api } from './api.js';

export type DesktopApi = Pick<typeof api,
	| 'apiKeys' | 'setApiKey' | 'openKeyPage' | 'config' | 'setEqualizer' | 'setNetwork' | 'setTorboxShared' | 'setOpensubtitlesLogin' | 'premiumQuota'
	| 'catalogAddons' | 'catalogSetAddonEnabled' | 'playersStatus' | 'installMpv' | 'checkIncoming'
	| 'tempUsage' | 'cleanTemp' | 'dataCacheSize' | 'clearDataCache' | 'stopAllAndClean' | 'onClose' | 'playbackLog' | 'playbackAction' | 'speedTest'>;

export const desktop: DesktopApi = api;
