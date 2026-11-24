// TorBox, como crates/core/src/catalog/torbox.rs: qué hashes están en caché y el link https de uno.
// Fachada: el código vive en `torbox/{client,link,tracks}.ts`.
export { cached, checkFiles, mine, addMagnet, episodeRe, isSpanishSub, pick } from './torbox/client.ts';
export { link, latinoByName } from './torbox/link.ts';
export { tracks, spanishVariant, spanishSubs } from './torbox/tracks.ts';
