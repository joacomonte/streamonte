// btih de un magnet (puro, sin DOM).

/** btih de un magnet en hex de 40 (minúsculas); base32 (32) se pasa a hex. null si no es un magnet. */
export function magnetHash(text: string): string | null {
	const m = text.trim().match(/^magnet:\?.*?xt=urn:btih:([0-9a-z]{32,40})/i);
	const h = m?.[1];
	if (!h) return null;
	if (/^[0-9a-f]{40}$/i.test(h)) return h.toLowerCase();
	if (!/^[a-z2-7]{32}$/i.test(h)) return null;
	let bits = '';
	for (const ch of h.toUpperCase()) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5, '0');
	return (bits.match(/.{4}/g) ?? []).map((b) => parseInt(b, 2).toString(16)).join('');
}
