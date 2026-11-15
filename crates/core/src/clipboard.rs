//! `clipboard` — captura en vivo + historial Win+V. Adaptador por SO (FR-01, FR-02, NFR-13, R-06).
//!
//! - Windows: `AddClipboardFormatListener` sobre una ventana "solo mensajes" en un hilo propio
//!   (en vivo) + WinRT `Clipboard::GetHistoryItemsAsync` (historial).
//! - macOS: sondeo de `NSPasteboard.changeCount` cada 500 ms (no hay notificación); sin historial.
//! - Otros: sin captura en vivo ni historial; la app sigue andando con "pegar" manual (NFR-13).

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::events::ClipboardUnavailable;
use crate::magnet::{self, Magnet};
use crate::Result;

/// Resultado de leer el historial del sistema.
#[derive(Debug, Clone)]
pub enum ClipboardHistory {
    /// Elementos del más nuevo al más viejo. Uno que no es texto (imagen, archivo) llega con
    /// texto `""`: no es magnet, así que corta la lectura (FR-02).
    Items(Vec<HistoryItem>),
    /// Windows con Win+V apagado → aviso + usar solo `current_text()` (FR-02).
    Disabled,
    /// macOS / otros (NFR-13: degradar con elegancia).
    Unsupported,
}

/// Un elemento del historial con la hora en que se copió (si el SO la da).
#[derive(Debug, Clone)]
pub struct HistoryItem {
    pub text: String,
    pub copied_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Un texto sin hora (el último copiado, o un historial que no la da).
impl From<&str> for HistoryItem {
    fn from(text: &str) -> Self {
        Self {
            text: text.to_string(),
            copied_at: None,
        }
    }
}

/// Mientras exista, sigue escuchando. Al soltarse deja de escuchar.
pub struct WatchGuard {
    _stop: tokio_util::sync::DropGuard,
}

impl WatchGuard {
    pub fn new(token: tokio_util::sync::CancellationToken) -> Self {
        Self {
            _stop: token.drop_guard(),
        }
    }
}

#[async_trait]
pub trait ClipboardSource: Send + Sync {
    /// Envía por `tx` cada texto copiado mientras la app está abierta (FR-01).
    fn watch(&self, tx: mpsc::Sender<String>) -> Result<WatchGuard>;
    /// Último texto copiado.
    async fn current_text(&self) -> Result<Option<String>>;
    /// Historial del sistema, con la hora de cada elemento si el SO la da (FR-02).
    async fn history(&self) -> Result<ClipboardHistory>;
}

/// Un magnet encontrado en el portapapeles, para el diálogo de selección.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ClipboardMagnet {
    /// Texto original del magnet ("Copiar magnet", FR-04).
    pub raw: String,
    pub info_hash: crate::magnet::InfoHash,
    /// `dn` del magnet (puede ser genérico, p. ej. "Torrentio").
    pub name: Option<String>,
    pub copied_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Lo que hay para leer: el historial, o si no está (apagado, otro SO o error) solo el último
/// copiado, con el motivo para avisar.
async fn read(source: &dyn ClipboardSource) -> (Vec<HistoryItem>, Option<ClipboardUnavailable>) {
    let history = source.history().await.unwrap_or_else(|e| {
        tracing::warn!("historial del portapapeles: {e}");
        ClipboardHistory::Disabled
    });
    let reason = match history {
        ClipboardHistory::Items(items) => return (items, None),
        ClipboardHistory::Disabled => ClipboardUnavailable::HistoryDisabled,
        ClipboardHistory::Unsupported => ClipboardUnavailable::NotSupportedOnThisOs,
    };
    let current = match source.current_text().await {
        Ok(text) => text,
        Err(e) => {
            tracing::warn!("leer el portapapeles: {e}");
            None
        }
    };
    let items = current.map(|t| vec![HistoryItem::from(t.as_str())]);
    (items.unwrap_or_default(), Some(reason))
}

/// Diálogo "Leer portapapeles" (FR-01c): todos los magnets del historial, con su hora.
pub async fn scan_all(
    source: &dyn ClipboardSource,
) -> (Vec<ClipboardMagnet>, Option<ClipboardUnavailable>) {
    let (items, unavailable) = read(source).await;
    (all_magnets(&items), unavailable)
}

/// Resultado de [`import`]: magnets a agregar (con su texto original) y, si corresponde, por qué
/// no se pudo usar el historial.
#[derive(Debug, Clone)]
pub struct ClipboardImport {
    pub magnets: Vec<(Magnet, String)>,
    pub unavailable: Option<ClipboardUnavailable>,
}

/// "Leer portapapeles" sin diálogo (FR-02): historial del más nuevo al más viejo hasta el primer
/// no-magnet; si el historial está apagado (Windows) o no existe (macOS), los magnets del
/// último copiado.
pub async fn import(source: &dyn ClipboardSource) -> ClipboardImport {
    let (items, unavailable) = read(source).await;
    let magnets = match unavailable {
        None => magnets_from_history(&items),
        Some(_) => items
            .iter()
            .flat_map(|i| magnet::extract_all_with_raw(&i.text))
            .collect(),
    };
    ClipboardImport {
        magnets,
        unavailable,
    }
}

/// Regla FR-01c (diálogo): TODOS los magnets, no solo hasta el primer no-magnet (el usuario
/// elige), sin repetir, del más nuevo al más viejo.
pub fn all_magnets(items_newest_first: &[HistoryItem]) -> Vec<ClipboardMagnet> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items_newest_first {
        for (m, raw) in magnet::extract_all_with_raw(&item.text) {
            if seen.insert(m.info_hash) {
                out.push(ClipboardMagnet {
                    raw,
                    info_hash: m.info_hash,
                    name: m.display_name.clone(),
                    copied_at: item.copied_at,
                });
            }
        }
    }
    out
}

/// Regla FR-02: recorrer del más nuevo al más viejo y DETENERSE en el primer elemento
/// que no sea magnet. `[m3, m2, texto, m1]` → `[m3, m2]`, con el texto original de cada uno (FR-04).
/// "Elemento magnet" = texto con SOLO magnets (y espacios); un magnet con otras palabras
/// corta la lectura (Q-09, confirmada por el usuario 2026-11-13).
pub fn magnets_from_history(items_newest_first: &[HistoryItem]) -> Vec<(Magnet, String)> {
    items_newest_first
        .iter()
        .take_while(|item| magnet::is_only_magnets(&item.text))
        .flat_map(|item| magnet::extract_all_with_raw(&item.text))
        .collect()
}

/// Implementación del SO actual.
pub fn platform_source() -> Box<dyn ClipboardSource> {
    #[cfg(windows)]
    {
        Box::new(windows_impl::WindowsClipboard)
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(mac_impl::MacClipboard)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Box::new(NoClipboard)
    }
}

/// Sistemas sin soporte: todo degrada a "no disponible" sin romper la app (NFR-13).
#[cfg(not(any(windows, target_os = "macos")))]
pub struct NoClipboard;

#[cfg(not(any(windows, target_os = "macos")))]
#[async_trait]
impl ClipboardSource for NoClipboard {
    fn watch(&self, _tx: mpsc::Sender<String>) -> Result<WatchGuard> {
        Err(crate::CoreError::Unsupported("la captura del portapapeles"))
    }
    async fn current_text(&self) -> Result<Option<String>> {
        Ok(None)
    }
    async fn history(&self) -> Result<ClipboardHistory> {
        Ok(ClipboardHistory::Unsupported)
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::cell::RefCell;
    use std::time::Duration;

    use async_trait::async_trait;
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;
    use windows::core::w;
    use windows::ApplicationModel::DataTransfer::{
        Clipboard, ClipboardHistoryItemsResultStatus, StandardDataFormats,
    };
    use windows::Win32::Foundation::{HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::DataExchange::{
        AddClipboardFormatListener, CloseClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, RemoveClipboardFormatListener,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
        PostMessageW, PostQuitMessage, RegisterClassW, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
        WINDOW_STYLE, WM_CLIPBOARDUPDATE, WM_CLOSE, WM_DESTROY, WNDCLASSW,
    };

    use super::{ClipboardHistory, ClipboardSource, WatchGuard};
    use crate::{CoreError, Result};

    /// `CF_UNICODETEXT` (winuser.h).
    const CF_UNICODETEXT: u32 = 13;

    pub struct WindowsClipboard;

    thread_local! {
        /// Canal hacia la app; vive en el hilo de la ventana (el `wndproc` corre ahí).
        static SENDER: RefCell<Option<mpsc::Sender<String>>> = const { RefCell::new(None) };
    }

    fn err(what: &str, e: impl std::fmt::Display) -> CoreError {
        CoreError::Clipboard(format!("{what}: {e}"))
    }

    extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            WM_CLIPBOARDUPDATE => {
                if let Some(text) = read_text() {
                    SENDER.with(|s| {
                        if let Some(tx) = s.borrow().as_ref() {
                            let _ = tx.try_send(text);
                        }
                    });
                }
                LRESULT(0)
            }
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    /// Texto actual del portapapeles (Win32: más confiable que WinRT para apps de escritorio).
    fn read_text() -> Option<String> {
        unsafe {
            IsClipboardFormatAvailable(CF_UNICODETEXT).ok()?;
            // Otra app puede tener el portapapeles abierto un instante.
            let mut opened = false;
            for _ in 0..10 {
                if OpenClipboard(None).is_ok() {
                    opened = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            if !opened {
                return None;
            }
            let text = (|| {
                let handle = GetClipboardData(CF_UNICODETEXT).ok()?;
                let global = HGLOBAL(handle.0);
                let ptr = GlobalLock(global) as *const u16;
                if ptr.is_null() {
                    return None;
                }
                let mut len = 0;
                while *ptr.add(len) != 0 {
                    len += 1;
                }
                let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
                let _ = GlobalUnlock(global);
                Some(text)
            })();
            let _ = CloseClipboard();
            text
        }
    }

    /// Ventana "solo mensajes" (invisible) registrada como oyente del portapapeles.
    fn create_listener_window() -> std::result::Result<HWND, String> {
        unsafe {
            let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: instance.into(),
                lpszClassName: w!("TstreamClipboardListener"),
                ..Default::default()
            };
            // Si ya estaba registrada (segundo `watch`), RegisterClassW devuelve 0: no es error.
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("TstreamClipboardListener"),
                w!("tstream-clipboard"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(instance.into()),
                None,
            )
            .map_err(|e| e.to_string())?;
            AddClipboardFormatListener(hwnd).map_err(|e| e.to_string())?;
            Ok(hwnd)
        }
    }

    /// Historial Win+V con la hora de cada elemento.
    fn read_history() -> Result<ClipboardHistory> {
        if !Clipboard::IsHistoryEnabled().unwrap_or(false) {
            return Ok(ClipboardHistory::Disabled);
        }
        let result = Clipboard::GetHistoryItemsAsync()
            .and_then(|op| op.join())
            .map_err(|e| err("historial", e))?;
        if result.Status().map_err(|e| err("historial", e))?
            != ClipboardHistoryItemsResultStatus::Success
        {
            return Ok(ClipboardHistory::Disabled);
        }
        let items = result.Items().map_err(|e| err("historial", e))?;
        let text_format = StandardDataFormats::Text().map_err(|e| err("historial", e))?;
        let count = items.Size().map_err(|e| err("historial", e))?;
        let mut out = Vec::with_capacity(count as usize);
        for i in 0..count {
            let Ok(item) = items.GetAt(i) else {
                out.push(super::HistoryItem {
                    text: String::new(),
                    copied_at: None,
                });
                continue;
            };
            let text = item
                .Content()
                .and_then(|content| {
                    if content.Contains(&text_format)? {
                        Ok(content.GetTextAsync()?.join()?.to_string())
                    } else {
                        Ok(String::new()) // imagen/archivo: no es magnet → corta (FR-02)
                    }
                })
                .unwrap_or_default();
            // WinRT DateTime: intervalos de 100 ns desde 1601-01-01 (UTC).
            let copied_at = item.Timestamp().ok().and_then(|t| {
                const EPOCH_DIFF_100NS: i64 = 116_444_736_000_000_000;
                let unix_100ns = t.UniversalTime - EPOCH_DIFF_100NS;
                chrono::DateTime::from_timestamp(
                    unix_100ns.div_euclid(10_000_000),
                    (unix_100ns.rem_euclid(10_000_000) * 100) as u32,
                )
            });
            out.push(super::HistoryItem { text, copied_at });
        }
        Ok(ClipboardHistory::Items(out))
    }

    #[async_trait]
    impl ClipboardSource for WindowsClipboard {
        fn watch(&self, tx: mpsc::Sender<String>) -> Result<WatchGuard> {
            let (ready_tx, ready_rx) =
                std::sync::mpsc::channel::<std::result::Result<isize, String>>();
            std::thread::Builder::new()
                .name("tstream-clipboard".into())
                .spawn(move || {
                    SENDER.with(|s| *s.borrow_mut() = Some(tx));
                    let hwnd = match create_listener_window() {
                        Ok(h) => h,
                        Err(e) => {
                            let _ = ready_tx.send(Err(e));
                            return;
                        }
                    };
                    let _ = ready_tx.send(Ok(hwnd.0 as isize));
                    let mut msg = MSG::default();
                    // GetMessageW: >0 mensaje, 0 WM_QUIT, -1 error.
                    while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {
                        unsafe { DispatchMessageW(&msg) };
                    }
                    unsafe {
                        let _ = RemoveClipboardFormatListener(hwnd);
                        let _ = DestroyWindow(hwnd);
                    }
                    SENDER.with(|s| *s.borrow_mut() = None);
                })
                .map_err(|e| err("hilo del portapapeles", e))?;
            let hwnd = ready_rx
                .recv()
                .map_err(|e| err("oyente del portapapeles", e))?
                .map_err(|e| err("oyente del portapapeles", e))?;

            let token = CancellationToken::new();
            let stop = token.clone();
            // Al soltar el guard: cerrar la ventana → WM_DESTROY → fin del bucle de mensajes.
            tokio::spawn(async move {
                stop.cancelled().await;
                unsafe {
                    let _ = PostMessageW(
                        Some(HWND(hwnd as *mut core::ffi::c_void)),
                        WM_CLOSE,
                        WPARAM(0),
                        LPARAM(0),
                    );
                }
            });
            Ok(WatchGuard::new(token))
        }

        async fn current_text(&self) -> Result<Option<String>> {
            tokio::task::spawn_blocking(read_text)
                .await
                .map_err(|e| err("portapapeles", e))
        }

        async fn history(&self) -> Result<ClipboardHistory> {
            tokio::task::spawn_blocking(read_history)
                .await
                .map_err(|e| err("historial", e))?
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use std::time::Duration;

    use async_trait::async_trait;
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;

    use super::{ClipboardHistory, ClipboardSource, WatchGuard};
    use crate::Result;

    pub struct MacClipboard;

    /// `changeCount` del portapapeles general: barato, sin copiar el contenido.
    #[allow(unused_unsafe)] // según la versión de objc2 estas llamadas son o no `unsafe`
    fn change_count() -> isize {
        objc2::rc::autoreleasepool(|_| unsafe { NSPasteboard::generalPasteboard().changeCount() })
    }

    /// Texto del portapapeles general.
    #[allow(unused_unsafe)]
    fn text() -> Option<String> {
        objc2::rc::autoreleasepool(|_| unsafe {
            NSPasteboard::generalPasteboard()
                .stringForType(NSPasteboardTypeString)
                .map(|s| s.to_string())
        })
    }

    #[async_trait]
    impl ClipboardSource for MacClipboard {
        fn watch(&self, tx: mpsc::Sender<String>) -> Result<WatchGuard> {
            let token = CancellationToken::new();
            let stop = token.clone();
            std::thread::Builder::new()
                .name("tstream-clipboard".into())
                .spawn(move || {
                    // No hay notificación en macOS: se sondea `changeCount` (barato).
                    let mut last = change_count();
                    while !stop.is_cancelled() {
                        std::thread::sleep(Duration::from_millis(500));
                        let count = change_count();
                        if count != last {
                            last = count;
                            if let Some(text) = text() {
                                if tx.blocking_send(text).is_err() {
                                    return;
                                }
                            }
                        }
                    }
                })
                .map_err(|e| crate::CoreError::Clipboard(e.to_string()))?;
            Ok(WatchGuard::new(token))
        }

        async fn current_text(&self) -> Result<Option<String>> {
            Ok(text())
        }

        async fn history(&self) -> Result<ClipboardHistory> {
            Ok(ClipboardHistory::Unsupported)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const M1: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel";
    const M2: &str =
        "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny";
    const M3: &str =
        "magnet:?xt=urn:btih:209c8226b299b308beaf2b9cd3fb49212dbd13ec&dn=Tears+of+Steel";

    #[test]
    fn historial_se_detiene_en_el_primer_no_magnet() {
        let items = [M3, M2, "hola", M1].map(HistoryItem::from);
        let got: Vec<_> = magnets_from_history(&items)
            .into_iter()
            .map(|(m, _)| m.display_name.unwrap())
            .collect();
        assert_eq!(got, ["Tears of Steel", "Big Buck Bunny"]);
    }

    #[test]
    fn q09_magnet_con_otras_palabras_corta_y_varios_magnets_siguen() {
        let both = format!("{M3}\n{M2}");
        let mixed = format!("mirá esto {M1}");
        let items = [both.as_str(), mixed.as_str(), M1].map(HistoryItem::from);
        assert_eq!(magnets_from_history(&items).len(), 2);
        // Un elemento que no es texto llega como "" y también corta.
        assert!(magnets_from_history(&["", M1].map(HistoryItem::from)).is_empty());
    }

    /// FR-01c: el diálogo muestra todos, sin repetir, aunque haya texto en el medio.
    #[test]
    fn dialogo_muestra_todos_los_magnets_sin_repetir() {
        let items = [M3, "hola", M1, M3].map(HistoryItem::from);
        let got: Vec<_> = all_magnets(&items)
            .into_iter()
            .map(|m| m.name.unwrap())
            .collect();
        assert_eq!(got, ["Tears of Steel", "Sintel"]);
    }

    /// Prueba manual en la sesión real (lección 7): adaptador del SO de verdad.
    /// Copia un magnet de Sintel con `Set-Clipboard` (y al final restaura el texto anterior),
    /// verifica la captura en vivo (FR-01) y lee el historial (FR-02).
    /// `cargo test -p tstream-core --lib -- --ignored portapapeles_real --nocapture`
    #[cfg(windows)]
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "manual: usa el portapapeles real"]
    async fn portapapeles_real() {
        let source = platform_source();
        let before = source.current_text().await.unwrap();
        let (tx, mut rx) = mpsc::channel(8);
        let guard = source.watch(tx).unwrap();
        let set = |text: &str| {
            std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", "Set-Clipboard", "-Value"])
                .arg(format!("'{text}'"))
                .status()
                .unwrap();
        };
        set(M1);
        let got = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
            .await
            .expect("captura en vivo")
            .unwrap();
        assert_eq!(got.trim(), M1);
        assert_eq!(source.current_text().await.unwrap().unwrap().trim(), M1);
        match source.history().await.unwrap() {
            ClipboardHistory::Items(items) => {
                println!("historial Win+V: {} elementos", items.len());
                println!(
                    "magnets al principio: {}",
                    magnets_from_history(&items).len()
                );
            }
            other => println!("historial: {other:?}"),
        }
        drop(guard);
        if let Some(text) = before {
            set(&text.replace('\'', "''"));
        }
    }
}
