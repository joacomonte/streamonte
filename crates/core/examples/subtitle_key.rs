//! Guarda la API key de un proveedor de subtítulos en el almacén seguro del sistema (NFR-16)
//! mientras no exista la pantalla de Ajustes (F4). La key se lee de la entrada estándar para que
//! no quede en el historial de la terminal ni en ningún log.
//!
//! ```text
//! cargo run -p tstream-core --example subtitle_key -- opensubtitles   (pega la key y Enter)
//! cargo run -p tstream-core --example subtitle_key -- wyzie
//! cargo run -p tstream-core --example subtitle_key -- estado
//! ```
//! Una key vacía la borra.

use tstream_core::subtitles::secrets;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let provider = std::env::args().nth(1).unwrap_or_default();
    if provider.is_empty() || provider == "estado" {
        for p in secrets::KEY_PROVIDERS {
            let state = if secrets::has_api_key(p) {
                "configurada"
            } else {
                "sin key"
            };
            println!("{p}: {state}");
        }
        return Ok(());
    }
    println!("Pegá la API key de {provider} y apretá Enter (vacía = borrarla):");
    let mut key = String::new();
    std::io::stdin().read_line(&mut key)?;
    secrets::set_api_key(&provider, key.trim())?;
    println!(
        "{provider}: {}",
        if key.trim().is_empty() {
            "key borrada"
        } else {
            "key guardada en el almacén seguro del sistema"
        }
    );
    Ok(())
}
