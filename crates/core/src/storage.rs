//! `storage` — almacenamiento SIN relleno de ceros (NFR-09, ADR-07, lección 1: el más importante).
//!
//! Problema: escribir el final de un archivo de 20 GB en NTFS obliga a rellenar con ceros
//! todo lo anterior (valid data length) → minutos sin que termine ninguna escritura → mpv en negro.
//!
//! Estrategias (las elige cada implementación de `TorrentEngine`):
//! - `PiecePerFile`: una pieza = un archivo (lo que hace el sidecar webtorrent, heredado de v1).
//! - `SparseFile`: archivo único marcado sparse (Windows FSCTL_SET_SPARSE; APFS es sparse nativo).
//!
//! Este módulo da las primitivas del lado Rust y la prueba de humo que TODO motor debe pasar.

use std::path::Path;
use std::time::Duration;

use crate::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageStrategy {
    PiecePerFile,
    SparseFile,
}

/// Crea (o convierte) `path` en archivo sparse de `len` bytes sin escribir datos.
/// Windows: `DeviceIoControl(FSCTL_SET_SPARSE)` + `SetEndOfFile`. macOS: `set_len` (APFS ya es sparse).
pub fn create_sparse(path: &Path, len: u64) -> Result<()> {
    let _ = (path, len);
    todo!("F1 (solo si el motor elegido lo necesita, riesgo R-01)")
}

/// Prueba de humo para el checklist de motores (06-A / lección 1):
/// escribe primero 1 MiB al final de un archivo de `len` bytes y mide cuánto tarda.
/// Debe tardar < 1 s con `len` = 20 GiB y ocupar en disco ~1 MiB.
pub fn tail_write_probe(
    dir: &Path,
    len: u64,
    strategy: StorageStrategy,
) -> Result<TailWriteReport> {
    let _ = (dir, len, strategy);
    todo!("F1")
}

#[derive(Debug, Clone)]
pub struct TailWriteReport {
    pub elapsed: Duration,
    pub bytes_on_disk: u64,
}
