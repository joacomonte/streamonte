// Sidecar webtorrent de Streamonte — implementa docs/engine-protocol.md.
// JSON-RPC 2.0 por stdin/stdout (una línea por mensaje). stderr = log libre (→ diag::engine).
// Lecciones aplicadas: 1 (pieza por archivo), 3 (arranca sin selección + rangos con streams),
// 4 (trackers como announce), 5 (maxConns), 6 (stdin cerrado ⇒ detener y salir; sin borrar datos, FR-06d).
import fs from 'node:fs'
import { createInterface } from 'node:readline'
import WebTorrent from 'webtorrent'
import { makePieceStore } from './piecestore.mjs'

const VERSION = '0.3.0'
const args = process.argv.slice(2)
const argValue = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def
}

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
const notify = (method, params) => send({ method, params })
const log = (...a) => process.stderr.write(a.join(' ') + '\n')

// Sale cuando stdout entregó lo ya escrito: en macOS el pipe es asíncrono y process.exit lo perdería.
function exitFlushed (code) {
  setTimeout(() => process.exit(code), 2000) // por si stdout está roto y el callback nunca llega
  process.stdout.write('', () => process.exit(code))
}

process.on('uncaughtException', (e) => {
  log('uncaughtException:', e?.stack || e)
  notify('error', { message: `el motor falló: ${e?.message || e}` })
  exitFlushed(1)
})
process.on('unhandledRejection', (e) => log('unhandledRejection:', e?.stack || e))

const client = new WebTorrent({ maxConns: Number(argValue('--max-conns', 100)) })
client.on('error', (e) => notify('error', { message: String(e?.message || e) }))

/** @type {Map<number, {torrent: any, dir: string, streams: any[], ranges: any[], fileIndex: number|null, error: Error|null}>} */
const handles = new Map()
let nextHandle = 1

// ---------- servidor HTTP (solo 127.0.0.1, NFR-16) ----------
const server = client.createServer({}, 'node').server
const httpPort = await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})

// ---------- utilidades ----------
function rpcError (code, message, userMessage) {
  return Object.assign(new Error(message), { code, userMessage })
}

function getHandle (id) {
  const h = handles.get(id)
  if (!h) throw rpcError(-32001, `handle desconocido: ${id}`)
  return h
}

function getFile (h, fileIndex) {
  const f = h.torrent.files[fileIndex]
  if (!f) throw rpcError(-32002, `archivo ${fileIndex} no existe`)
  return f
}

/** Después de un `error` el torrent ya está destruido: no va a emitir más eventos. */
function whenReady (h) {
  if (h.error) return Promise.reject(h.error)
  if (h.torrent.ready) return Promise.resolve()
  return new Promise((resolve, reject) => {
    h.torrent.once('ready', resolve)
    h.torrent.once('error', reject)
  })
}

function metadataOf (t) {
  return {
    infoHash: t.infoHash,
    name: t.name,
    files: t.files.map((f, index) => ({ index, name: f.path, size: f.length, offset: f.offset })),
    pieceLength: t.pieceLength,
    pieceCount: t.pieces.length,
    torrentFileBase64: Buffer.from(t.torrentFile).toString('base64')
  }
}

/** Rango de bytes [start, end) dentro de un archivo → piezas [a, b] del torrent. */
function piecesOf (t, file, range) {
  const pl = t.pieceLength
  return [Math.floor((file.offset + range.start) / pl), Math.floor((file.offset + range.end - 1) / pl)]
}

function rangeProgress (t, file, range) {
  const [a, b] = piecesOf(t, file, range)
  let done = 0
  let peersWithMissing = 0
  const wires = t.wires || []
  for (let i = a; i <= b; i++) {
    if (t.bitfield.get(i)) { done++; continue }
    peersWithMissing = Math.max(peersWithMissing, wires.filter((w) => w.peerPieces?.get(i)).length)
  }
  return { range, piecesDone: done, piecesTotal: b - a + 1, peersWithMissing }
}

function destroyStreams (h) {
  for (const s of h.streams) { try { s.destroy() } catch {} }
  h.streams = []
}

async function removeHandle (id, deleteData) {
  const h = handles.get(id)
  if (!h) return
  handles.delete(id)
  destroyStreams(h)
  // Tras un `error` webtorrent ya lo destruyó y lo quitó: client.remove rechazaría sin llamar al callback.
  if (!h.torrent.destroyed) {
    await new Promise((resolve) => {
      // destroyStore borra las piezas; después borramos la carpeta entera (FR-12).
      Promise.resolve(client.remove(h.torrent, { destroyStore: deleteData }, () => resolve()))
        .catch((e) => { log(`[${id}] remove:`, e?.message || e); resolve() })
    })
  }
  if (deleteData) await fs.promises.rm(h.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}

// ---------- métodos ----------
const methods = {
  async add ({ source, trackers = [], downloadDir }) {
    if (!downloadDir) throw rpcError(-32602, 'downloadDir requerido')
    await fs.promises.mkdir(downloadDir, { recursive: true })
    const src = source?.magnet ?? (source?.torrentFile ? await fs.promises.readFile(source.torrentFile) : null)
    if (!src) throw rpcError(-32602, 'source inválido')

    const handle = nextHandle++
    const torrent = client.add(src, {
      path: downloadDir,
      announce: trackers,
      deselect: true, // lección 3: nada se baja hasta prioritizeRanges/selectFile
      store: makePieceStore(downloadDir)
    })
    const h = { torrent, dir: downloadDir, streams: [], ranges: [], fileIndex: null, error: null }
    handles.set(handle, h)
    const t0 = Date.now()
    torrent.on('ready', () => {
      notify('log', { handle, line: `metadatos en ${((Date.now() - t0) / 1000).toFixed(1)} s · ${torrent.files.length} archivos · peers ${torrent.numPeers}` })
    })
    torrent.on('error', (e) => {
      h.error = e instanceof Error ? e : new Error(String(e))
      notify('error', { handle, message: String(e?.message || e) })
    })
    torrent.on('warning', (w) => log(`[${handle}] warning:`, w?.message || w))
    return { handle }
  },

  async metadata ({ handle }) {
    const h = getHandle(handle)
    await whenReady(h)
    return metadataOf(h.torrent)
  },

  /** Lección 3: seleccionar SOLO estas piezas (exclusivas), marcarlas críticas y leerlas con streams. */
  async prioritizeRanges ({ handle, fileIndex, ranges }) {
    const h = getHandle(handle)
    await whenReady(h)
    const t = h.torrent
    const file = getFile(h, fileIndex)
    destroyStreams(h)
    h.ranges = ranges
    h.fileIndex = fileIndex
    for (const r of ranges) {
      const [a, b] = piecesOf(t, file, r)
      t.select(a, b, 10)
      t.critical(a, b)
      // Leer el rango es lo que más empuja los pedidos en webtorrent. 'end' ⇒ piezas verificadas.
      const s = file.createReadStream({ start: r.start, end: r.end - 1 })
      s.on('data', () => {})
      s.on('end', () => notify('rangeReady', { handle, fileIndex, range: r }))
      s.on('error', (e) => notify('log', { handle, line: `rango ${r.start}-${r.end}: ${e?.message || e}` }))
      h.streams.push(s)
    }
    return null
  },

  async selectFile ({ handle, fileIndex }) {
    const h = getHandle(handle)
    await whenReady(h)
    h.torrent.files.forEach((f, i) => (i === fileIndex ? f.select() : f.deselect()))
    h.fileIndex = fileIndex
    return null
  },

  async streamUrl ({ handle, fileIndex }) {
    const h = getHandle(handle)
    await whenReady(h)
    return { url: `http://127.0.0.1:${httpPort}${getFile(h, fileIndex).streamURL}` }
  },

  async stats ({ handle }) {
    const h = getHandle(handle)
    const t = h.torrent
    const file = t.ready && h.fileIndex != null ? t.files[h.fileIndex] : null
    return {
      downloadedBytes: file ? file.downloaded : t.downloaded,
      // Recibido de la red (verificado o no): para medir velocidad sin depender del tamaño de pieza.
      receivedBytes: t.received,
      downloadSpeedBps: t.downloadSpeed,
      uploadSpeedBps: t.uploadSpeed,
      peers: t.numPeers,
      // Seeders reales conectados (tienen todas las piezas), no los que informa el tracker.
      seeds: (t.wires || []).filter((w) => w.isSeeder).length,
      progress: file ? file.progress : t.progress,
      paused: t.paused,
      ranges: file ? h.ranges.map((r) => rangeProgress(t, file, r)) : []
    }
  },

  /** Pausa la descarga de fondo; lo que el reproductor pide sigue llegando (lee con prioridad crítica). */
  async pause ({ handle }) {
    const h = getHandle(handle)
    if (h.torrent.ready && h.fileIndex != null) h.torrent.files[h.fileIndex].deselect()
    h.torrent.pause()
    return null
  },

  async resume ({ handle }) {
    const h = getHandle(handle)
    h.torrent.resume()
    if (h.torrent.ready && h.fileIndex != null) h.torrent.files[h.fileIndex].select()
    return null
  },

  async remove ({ handle, deleteData = true }) {
    await removeHandle(handle, deleteData)
    return null
  },

  async shutdown () {
    await stopAll()
    // La respuesta se escribe en esta misma vuelta; exitFlushed espera a que salga.
    setImmediate(() => exitFlushed(0))
    return null
  }
}

/** Detiene todo SIN borrar datos (FR-06d, igual que rqbit): borrar es `remove(deleteData)` o `cleanup`. */
let stopping = null
function stopAll () {
  stopping ??= (async () => {
    const safety = setTimeout(() => process.exit(0), 8000)
    await Promise.allSettled([...handles.keys()].map((id) => removeHandle(id, false)))
    await new Promise((resolve) => client.destroy(() => resolve()))
    clearTimeout(safety)
  })()
  return stopping
}
const shutdown = () => stopAll().then(() => exitFlushed(0))

// ---------- bucle JSON-RPC ----------
const rl = createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  let req
  try {
    req = JSON.parse(line.replace(/^﻿/, '')) // tolera BOM (p. ej. pipes de PowerShell)
  } catch {
    return send({ id: null, error: { code: -32700, message: 'JSON inválido' } })
  }
  const fn = methods[req.method]
  if (!fn) return send({ id: req.id, error: { code: -32601, message: `método desconocido: ${req.method}` } })
  try {
    send({ id: req.id, result: (await fn(req.params ?? {})) ?? null })
  } catch (e) {
    const data = e.userMessage ? { userMessage: e.userMessage } : undefined
    send({ id: req.id, error: { code: e.code ?? -32000, message: String(e.message || e), data } })
  }
})

// stdin cerrado = la app murió o nos soltó → detener todo y salir (NFR-11, lección 6).
rl.on('close', () => {
  log('stdin cerrado: deteniendo y saliendo')
  shutdown()
})
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, shutdown)

notify('ready', { version: VERSION, httpPort })
