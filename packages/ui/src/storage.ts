// localStorage a prueba de fallas (vista previa, almacenamiento bloqueado, modo privado): nunca rompe la UI.

/** Lee `k`; null si no hay o no se puede leer. */
export const safeGet = (k: string): string | null => {
	try {
		return localStorage.getItem(k);
	} catch {
		return null;
	}
};

/** Guarda `v` en `k`; sin storage no queda guardado. */
export const safeSet = (k: string, v: string): void => {
	try {
		localStorage.setItem(k, v);
	} catch {
		/* sin almacenamiento */
	}
};

/** Lee `k` como JSON; `fallback` si falta, no parsea o no es un objeto. */
export function safeJson<T extends object>(k: string, fallback: T): T {
	try {
		const v: unknown = JSON.parse(localStorage.getItem(k) ?? 'null');
		return v && typeof v === 'object' ? (v as T) : fallback;
	} catch {
		return fallback;
	}
}
