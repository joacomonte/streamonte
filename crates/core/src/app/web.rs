//! La web de Streamonte: código de acceso, apodo y su sesión (módulo `crate::web`).

use super::*;
use crate::web::{NickAsk, NickEnter, NickStatus, Seen, SeenKind};

impl AppCore {
    /// Guarda el código de 3 dígitos de la web (vacío = borrarlo).
    pub fn web_code_set(&self, code: &str) -> Result<()> {
        crate::web::set_code(code)
    }

    /// Código cargado y apodo de la sesión.
    pub fn nick_status(&self) -> NickStatus {
        crate::web::status()
    }

    pub async fn nick_ask(&self, nick: &str) -> Result<NickAsk> {
        crate::web::nick_ask(nick).await
    }

    pub async fn nick_enter(&self, nick: &str, code: &[String], mode: &str) -> Result<NickEnter> {
        crate::web::nick_enter(nick, code, mode).await
    }

    pub async fn nick_logout(&self) -> Result<()> {
        crate::web::nick_logout().await
    }

    pub async fn nick_animals(&self) -> Result<Option<Vec<String>>> {
        crate::web::nick_animals().await
    }

    /// "Vistos recientemente" del apodo (vacío sin sesión).
    pub async fn vistos_list(&self) -> Result<Vec<Seen>> {
        crate::web::vistos_list().await
    }

    pub async fn vistos_mark(&self, item: &Seen) -> Result<()> {
        crate::web::vistos_mark(item).await
    }

    pub async fn vistos_restore(&self, item: &Seen) -> Result<()> {
        crate::web::vistos_restore(item).await
    }

    pub async fn vistos_dismiss(&self, kind: SeenKind, imdb: &str, how: &str) -> Result<()> {
        crate::web::vistos_dismiss(kind, imdb, how).await
    }
}
