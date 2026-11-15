// Almacenamiento: una pieza = un archivo (NFR-09, ADR-07, lección 1).
// Copiado de v1 (tstream-piecestore.mjs, que queda congelada).
// Por qué: escribir cerca del final de un único archivo de 20+ GB obliga a NTFS a rellenar con
// ceros todo lo anterior (minutos) y mientras tanto no se guarda ninguna pieza. Con un archivo por
// pieza no hay relleno: cada escritura es inmediata.
import fs from 'node:fs'
import path from 'node:path'

export function makePieceStore (baseDir) {
  return class PieceStore {
    constructor (chunkLength) {
      this.chunkLength = Number(chunkLength)
      this.dir = path.join(baseDir, 'pieces')
      fs.mkdirSync(this.dir, { recursive: true })
      this.closed = false
    }

    put (index, buf, cb = () => {}) {
      if (this.closed) return queueMicrotask(() => cb(new Error('store cerrado')))
      fs.writeFile(path.join(this.dir, String(index)), buf, (err) => cb(err || null))
    }

    get (index, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = null }
      if (this.closed) return queueMicrotask(() => cb(new Error('store cerrado')))
      fs.readFile(path.join(this.dir, String(index)), (err, data) => {
        if (err) return cb(err)
        if (!opts) return cb(null, data)
        const off = opts.offset || 0
        const len = opts.length != null ? opts.length : data.length - off
        cb(null, data.subarray(off, off + len))
      })
    }

    close (cb = () => {}) { this.closed = true; queueMicrotask(() => cb(null)) }

    destroy (cb = () => {}) {
      this.closed = true
      fs.rm(this.dir, { recursive: true, force: true }, () => cb(null))
    }
  }
}
