// Prueba de humo del sidecar con Sintel (contenido legal). Red real: correr en la sesión del usuario.
// Verifica: ready → add (solo hash + trackers) → metadatos → precarga exclusiva de inicio+final (MP4)
// → rangeReady → stream HTTP con Range en 127.0.0.1 → remove borra la carpeta.
// Uso: node test/smoke.mjs
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SINTEL = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel'
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce', 'udp://exodus.desync.com:6969/announce',
  'wss://tracker.webtorrent.dev', 'wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz'
]
const MB = 1024 * 1024
const dir = path.join(os.tmpdir(), 'tstream-v2', 'downloads', `smoke-${process.pid}`)

const child = spawn(process.execPath, [path.join(here, '..', 'src', 'main.mjs'), '--max-conns', '100'], { stdio: ['pipe', 'pipe', 'inherit'] })
const pending = new Map()
const listeners = []
let id = 0
createInterface({ input: child.stdout }).on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  } else if (msg.method) listeners.forEach((l) => l(msg))
})
const call = (method, params) => new Promise((resolve, reject) => {
  const rid = ++id
  pending.set(rid, { resolve, reject })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n')
})
const waitFor = (pred, ms, what) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout esperando ${what}`)), ms)
  listeners.push((m) => { if (pred(m)) { clearTimeout(timer); resolve(m) } })
})
const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${s}`)

const t0 = Date.now()
const ready = await waitFor((m) => m.method === 'ready', 10000, 'ready')
step(`sidecar listo · http 127.0.0.1:${ready.params.httpPort}`)

const { handle } = await call('add', { source: { magnet: SINTEL }, trackers: TRACKERS, downloadDir: dir })
const meta = await call('metadata', { handle })
step(`metadatos: ${meta.name} · ${meta.files.length} archivos · pieza ${meta.pieceLength / 1024} KiB`)
const video = meta.files.filter((f) => /\.(mp4|mkv)$/i.test(f.name)).sort((a, b) => b.size - a.size)[0]
step(`video: ${video.name} (${(video.size / MB).toFixed(0)} MB)`)

const ranges = [{ start: 0, end: 4 * MB }, { start: video.size - 4 * MB, end: video.size }]
const readyRanges = new Set()
const allReady = waitFor((m) => {
  if (m.method !== 'rangeReady' || m.params.handle !== handle) return false
  readyRanges.add(m.params.range.start)
  return readyRanges.size === ranges.length
}, 120000, 'rangeReady')
await call('prioritizeRanges', { handle, fileIndex: video.index, ranges })
const statsTimer = setInterval(async () => {
  const s = await call('stats', { handle }).catch(() => null)
  if (s) step(`precarga ${s.ranges.map((r) => `${r.piecesDone}/${r.piecesTotal}`).join(' + ')} · ${(s.downloadSpeedBps * 8 / 1e6).toFixed(1)} Mbps · peers ${s.peers}`)
}, 3000)
await allReady
clearInterval(statsTimer)
step('precarga completa (inicio + final)')

const stats = await call('stats', { handle })
const extra = stats.downloadedBytes - 8 * MB
step(`bajado ${(stats.downloadedBytes / MB).toFixed(1)} MB (exclusividad: ${extra < 4 * MB ? 'OK' : 'se bajó de más'})`)

await call('selectFile', { handle, fileIndex: video.index })
const { url } = await call('streamUrl', { handle, fileIndex: video.index })
const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
const body = Buffer.from(await res.arrayBuffer())
step(`HTTP ${res.status} · ${body.length} bytes · cabecera MP4 '${body.subarray(4, 8).toString()}' · ${url}`)

await call('remove', { handle, deleteData: true })
step(`remove → carpeta borrada: ${!fs.existsSync(dir)}`)
await call('shutdown', {})
child.on('exit', (code) => { step(`sidecar salió (código ${code})`); console.log('SMOKE OK') })
