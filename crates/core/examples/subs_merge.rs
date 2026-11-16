//! Prototipo del modo comparación (R-05): fusiona hasta 5 subtítulos en un ASS para mirarlo
//! en mpv o sacar una captura y juzgar si se lee.
//!
//! ```text
//! cargo run -p streamonte-core --example subs_merge -- salida.ass a.srt b.srt c.ass d.srt e.srt
//! mpv --no-config "av://lavfi:color=c=0x404040:s=1920x1080:d=30" --sub-file=salida.ass
//! ```

use std::path::PathBuf;

use streamonte_core::subtitles::{merge_ass, LabeledSubtitle};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((out, inputs)) = args.split_first() else {
        eprintln!("uso: subs_merge salida.ass a.srt [b.srt …] (hasta 5)");
        std::process::exit(2);
    };
    let subs: Vec<LabeledSubtitle> = inputs
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let path = PathBuf::from(p);
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("?")
                .to_string();
            LabeledSubtitle {
                path,
                label: format!("{} · {name}", i + 1),
            }
        })
        .collect();
    std::fs::write(out, merge_ass(&subs)?)?;
    println!("{} subtítulo(s) fusionados en {out}", subs.len().min(5));
    Ok(())
}
