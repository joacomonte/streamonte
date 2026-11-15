//! Lectura de SRT/ASS/VTT y fusión de hasta 5 subtítulos en un único ASS (FR-25, ADR-11).
//!
//! mpv solo muestra 2 subtítulos a la vez (`sid` + `secondary-sid`); para ver 5 juntos se
//! fusionan en un ASS con un estilo por fuente. Prototipo de legibilidad (R-05): 3 franjas
//! abajo (1 = la posición normal de un subtítulo, 2 y 3 encima) y 2 arriba (4 y 5), cada una
//! con su color y una etiqueta chica "N · fuente/release" delante del texto. libass empuja una
//! línea si choca con la de la franja vecina (subtítulos de 3 renglones), así no se pisan.

use super::LabeledSubtitle;
use crate::{CoreError, Result};

/// Un evento ya convertido a texto ASS (con `\N` como salto de línea y sin `{}` sueltas).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cue {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// (alineación ASS numpad, margen vertical) por franja, a PlayResY = 1080.
const SLOTS: [(u8, u32); 5] = [(2, 40), (2, 160), (2, 280), (8, 40), (8, 160)];
/// Colores `&HAABBGGRR`: blanco, amarillo, celeste, verde claro, naranja.
const COLORS: [&str; 5] = [
    "&H00FFFFFF",
    "&H0000FFFF",
    "&H00FFFF00",
    "&H0080FF80",
    "&H003CAAFF",
];
const FONT_SIZE: u32 = 46;
const LABEL_SIZE: u32 = 26;

/// Fusiona hasta 5 subtítulos en un único ASS con un estilo (color/posición/etiqueta) por fuente.
/// Prototipo temprano en F5 por riesgo R-05.
pub fn merge_ass(subs: &[LabeledSubtitle]) -> Result<String> {
    if subs.is_empty() {
        return Err(CoreError::NotFound("subtítulos para fusionar".into()));
    }
    let mut parsed = Vec::with_capacity(subs.len());
    for sub in subs.iter().take(SLOTS.len()) {
        let bytes = std::fs::read(&sub.path).map_err(|source| CoreError::Io {
            path: sub.path.clone(),
            source,
        })?;
        parsed.push((
            sub.label.as_str(),
            parse_any(&super::providers::cache::to_utf8(&bytes)),
        ));
    }
    Ok(merge_cues(&parsed))
}

/// La parte pura de la fusión (probada sin archivos).
pub(crate) fn merge_cues(subs: &[(&str, Vec<Cue>)]) -> String {
    let mut out = String::with_capacity(64 * 1024);
    out.push_str(
        "[Script Info]\n\
         ; Generado por Torrent Stream v2: modo comparación (FR-25)\n\
         ScriptType: v4.00+\n\
         PlayResX: 1920\n\
         PlayResY: 1080\n\
         WrapStyle: 0\n\
         ScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\n\
         Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, \
         Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, \
         Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n",
    );
    for (i, ((align, margin_v), color)) in SLOTS.iter().zip(COLORS).enumerate() {
        out.push_str(&format!(
            "Style: S{n},Arial,{FONT_SIZE},{color},&H000000FF,&H00000000,&H80000000,\
             -1,0,0,0,100,100,0,0,1,3,1,{align},60,60,{margin_v},1\n",
            n = i + 1
        ));
    }
    out.push_str(
        "\n[Events]\n\
         Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    );
    let mut events: Vec<(u64, usize, &Cue)> = subs
        .iter()
        .enumerate()
        .take(SLOTS.len())
        .flat_map(|(i, (_, cues))| cues.iter().map(move |c| (c.start_ms, i, c)))
        .collect();
    events.sort_by_key(|(start, i, _)| (*start, *i));
    for (_, i, cue) in events {
        let label = escape_text(subs[i].0);
        out.push_str(&format!(
            "Dialogue: {layer},{start},{end},S{n},,0,0,0,,{{\\fs{LABEL_SIZE}\\b0\\alpha&H30&}}{label}  {{\\r}}{text}\n",
            layer = i,
            start = ass_time(cue.start_ms),
            end = ass_time(cue.end_ms),
            n = i + 1,
            text = cue.text,
        ));
    }
    out
}

/// Extensiones con las que se guarda en caché lo bajado: las que puede devolver [`format_ext`].
pub(crate) const CACHE_EXTENSIONS: [&str; 2] = ["srt", "ass"];

/// Única decisión de formato, por el contenido (no por la extensión: hay `.srt` que son ASS).
/// Devuelve la extensión con la que se guarda: `"ass"` o `"srt"` (SRT y WebVTT).
pub(crate) fn format_ext(text: &str) -> &'static str {
    if text.contains("[Events]") || text.contains("\nDialogue:") {
        "ass"
    } else {
        "srt"
    }
}

pub(crate) fn parse_any(text: &str) -> Vec<Cue> {
    match format_ext(text) {
        "ass" => parse_ass(text),
        _ => parse_srt(text),
    }
}

/// SRT (y WebVTT, que es casi igual): línea por línea; cada línea con `a --> b` abre un cue
/// nuevo y una línea en blanco (o solo espacios) lo cierra. Así un separador con espacios o
/// la falta de línea en blanco entre cues no los mezcla.
pub(crate) fn parse_srt(text: &str) -> Vec<Cue> {
    let text = text
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let lines: Vec<&str> = text.lines().map(str::trim_end).collect();
    let mut cues = Vec::new();
    let mut current: Option<(u64, u64, Vec<String>)> = None;
    let mut flush = |cur: Option<(u64, u64, Vec<String>)>| {
        let Some((start_ms, end_ms, body)) = cur else {
            return;
        };
        if !body.is_empty() && end_ms > start_ms {
            cues.push(Cue {
                start_ms,
                end_ms,
                text: body.join("\\N"),
            });
        }
    };
    for (i, line) in lines.iter().enumerate() {
        if let Some((a, b)) = line.split_once("-->") {
            flush(current.take());
            // VTT: "00:01.000 --> 00:02.000 align:start" → descartar ajustes después del tiempo.
            let b = b.split_whitespace().next().unwrap_or_default();
            current = parse_time(a)
                .zip(parse_time(b))
                .map(|(start, end)| (start, end, Vec::new()));
            continue;
        }
        if line.trim().is_empty() {
            flush(current.take());
            continue;
        }
        let Some((_, _, body)) = current.as_mut() else {
            continue; // índice, encabezado WEBVTT, NOTE…
        };
        // Sin línea en blanco, el índice del cue siguiente queda pegado al texto de este.
        let next_is_timing = lines.get(i + 1).is_some_and(|n| n.contains("-->"));
        if next_is_timing && line.trim().bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let ass = srt_line_to_ass(line);
        if !ass.trim().is_empty() {
            body.push(ass);
        }
    }
    flush(current);
    cues
}

/// ASS/SSA: líneas `Dialogue:` según el `Format:` de `[Events]`. Se quitan los tags `{…}`
/// (posiciones, colores, karaoke) porque la fusión pone los suyos; los dibujos (`\p1`) se omiten.
pub(crate) fn parse_ass(text: &str) -> Vec<Cue> {
    let mut in_events = false;
    let mut format: Vec<String> = Vec::new();
    let mut cues = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_events = line.eq_ignore_ascii_case("[events]");
            continue;
        }
        if !in_events {
            continue;
        }
        if let Some(f) = line.strip_prefix("Format:") {
            format = f
                .split(',')
                .map(|s| s.trim().to_ascii_lowercase())
                .collect();
            continue;
        }
        let Some(rest) = line.strip_prefix("Dialogue:") else {
            continue;
        };
        if format.is_empty() {
            format = [
                "layer", "start", "end", "style", "name", "marginl", "marginr", "marginv",
                "effect", "text",
            ]
            .map(String::from)
            .to_vec();
        }
        let fields: Vec<&str> = rest.splitn(format.len(), ',').collect();
        let get = |name: &str| {
            format
                .iter()
                .position(|f| f == name)
                .and_then(|i| fields.get(i))
                .map(|s| s.trim())
        };
        let (Some(start), Some(end), Some(raw)) = (get("start"), get("end"), get("text")) else {
            continue;
        };
        if raw.contains("\\p1") || raw.contains("\\p2") || raw.contains("\\p4") {
            continue;
        }
        let (Some(start_ms), Some(end_ms)) = (parse_time(start), parse_time(end)) else {
            continue;
        };
        let text = strip_ass_tags(raw)
            .replace("\\n", "\\N")
            .replace("\\h", " ");
        if text.replace("\\N", "").trim().is_empty() || end_ms <= start_ms {
            continue;
        }
        cues.push(Cue {
            start_ms,
            end_ms,
            text,
        });
    }
    cues.sort_by_key(|c| c.start_ms);
    cues
}

/// `HH:MM:SS,mmm` · `HH:MM:SS.mmm` · `MM:SS.mmm` (VTT) · `H:MM:SS.cc` (ASS).
fn parse_time(s: &str) -> Option<u64> {
    let s = s.trim();
    let (hms, frac) = match s.rsplit_once([',', '.']) {
        Some((a, b)) => (a, b),
        None => (s, "0"),
    };
    let frac_ms = match frac.len() {
        0 => 0,
        1 => frac.parse::<u64>().ok()? * 100,
        2 => frac.parse::<u64>().ok()? * 10,
        _ => frac.get(..3)?.parse::<u64>().ok()?,
    };
    let parts: Vec<u64> = hms
        .split(':')
        .map(|p| p.trim().parse::<u64>())
        .collect::<std::result::Result<_, _>>()
        .ok()?;
    let secs = match parts.as_slice() {
        [h, m, s] => h * 3600 + m * 60 + s,
        [m, s] => m * 60 + s,
        _ => return None,
    };
    Some(secs * 1000 + frac_ms)
}

fn ass_time(ms: u64) -> String {
    let cs = ms / 10;
    format!(
        "{}:{:02}:{:02}.{:02}",
        cs / 360_000,
        cs / 6000 % 60,
        cs / 100 % 60,
        cs % 100
    )
}

/// Una línea SRT → ASS: `<i>`/`<b>`/`<u>` a tags ASS, el resto de `<…>` (p. ej. `<font>`) fuera.
fn srt_line_to_ass(line: &str) -> String {
    let line = escape_text(line);
    let mut out = String::with_capacity(line.len());
    let mut rest = line.as_str();
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('>') else {
            out.push_str(&rest[open..]);
            rest = "";
            break;
        };
        let tag = rest[open + 1..open + close].trim().to_ascii_lowercase();
        out.push_str(match tag.as_str() {
            "i" => "{\\i1}",
            "/i" => "{\\i0}",
            "b" => "{\\b1}",
            "/b" => "{\\b0}",
            "u" => "{\\u1}",
            "/u" => "{\\u0}",
            _ => "",
        });
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out
}

/// Llaves sueltas en texto plano abrirían un bloque de tags ASS: se cambian por paréntesis.
fn escape_text(s: &str) -> String {
    s.replace('{', "(").replace('}', ")")
}

fn strip_ass_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0u32;
    for c in s.chars() {
        match c {
            '{' => depth += 1,
            '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRT: &str = "1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hola</i> {mundo}\r\nsegunda línea\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<font color=\"red\">Chau</font>\r\n";
    const ASS: &str = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.00,0:00:06.50,Default,,0,0,0,,{\\pos(10,10)}Texto, con coma\\Nabajo\nComment: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,no\nDialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}\n";

    #[test]
    fn srt_a_eventos() {
        let cues = parse_any(SRT);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start_ms, 1000);
        assert_eq!(cues[0].end_ms, 2500);
        assert_eq!(cues[0].text, "{\\i1}Hola{\\i0} (mundo)\\Nsegunda línea");
        assert_eq!(cues[1].text, "Chau");
    }

    #[test]
    fn ass_a_eventos() {
        let cues = parse_any(ASS);
        assert_eq!(cues.len(), 1, "Comment y dibujos se omiten");
        assert_eq!(cues[0].start_ms, 5000);
        assert_eq!(cues[0].end_ms, 6500);
        assert_eq!(cues[0].text, "Texto, con coma\\Nabajo");
    }

    #[test]
    fn vtt_y_tiempos() {
        let vtt = "WEBVTT\n\n00:01.500 --> 00:02.000 align:start\nhola\n";
        let cues = parse_any(vtt);
        assert_eq!(cues[0].start_ms, 1500);
        assert_eq!(ass_time(3_723_450), "1:02:03.45");
        assert_eq!(parse_time("0:00:05.5"), Some(5500));
    }

    #[test]
    fn srt_separadores_raros() {
        let texts =
            |srt: &str| -> Vec<String> { parse_srt(srt).into_iter().map(|c| c.text).collect() };
        let want = vec!["uno".to_string(), "dos".to_string(), "tres".to_string()];
        // Separador con espacios.
        let s = "1\n00:00:01,000 --> 00:00:02,000\nuno\n  \t\n2\n00:00:03,000 --> 00:00:04,000\ndos\n \n3\n00:00:05,000 --> 00:00:06,000\ntres\n";
        assert_eq!(texts(s), want);
        // Sin línea en blanco entre cues (con y sin índice).
        let s = "1\n00:00:01,000 --> 00:00:02,000\nuno\n2\n00:00:03,000 --> 00:00:04,000\ndos\n00:00:05,000 --> 00:00:06,000\ntres";
        assert_eq!(texts(s), want);
        // CRLF + BOM y sin índice en el primero.
        let s = "\u{feff}00:00:01,000 --> 00:00:02,000\r\nuno\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\ndos\r\n\r\n3\r\n00:00:05,000 --> 00:00:06,000\r\ntres\r\n";
        assert_eq!(texts(s), want);
        assert_eq!(parse_srt(s)[0].start_ms, 1000);
        // VTT con identificador de cue y NOTE.
        let s = "WEBVTT\n\nNOTE algo\n\nid-1\n00:01.000 --> 00:02.000\nuno\n";
        assert_eq!(texts(s), vec!["uno".to_string()]);
    }

    /// 5 entradas → 5 estilos distintos (color y posición) y los eventos de todos, etiquetados.
    #[test]
    fn fusion_de_cinco() {
        let cues: Vec<Cue> = parse_any(SRT);
        let labels = [
            "1 · torrent/Sintel.es",
            "2 · Wyzie/x",
            "3 · Subdivx/y",
            "4 · OpenSubs/z",
            "5 · Wyzie/w",
        ];
        let input: Vec<(&str, Vec<Cue>)> = labels.iter().map(|l| (*l, cues.clone())).collect();
        let ass = merge_cues(&input);

        let styles: Vec<&str> = ass.lines().filter(|l| l.starts_with("Style:")).collect();
        assert_eq!(styles.len(), 5);
        let colors: std::collections::HashSet<&str> = styles
            .iter()
            .map(|s| s.split(',').nth(3).unwrap())
            .collect();
        assert_eq!(colors.len(), 5, "un color por fuente");
        let positions: std::collections::HashSet<(String, String)> = styles
            .iter()
            .map(|s| {
                let f: Vec<&str> = s.split(',').collect();
                (f[18].to_string(), f[21].to_string())
            })
            .collect();
        assert_eq!(positions.len(), 5, "una posición por fuente");

        let dialogues: Vec<&str> = ass.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(dialogues.len(), 10, "2 eventos × 5 fuentes");
        for (i, label) in labels.iter().enumerate() {
            let n = i + 1;
            assert_eq!(
                dialogues
                    .iter()
                    .filter(|d| d.contains(&format!(",S{n},")) && d.contains(label))
                    .count(),
                2
            );
        }
        // Ordenados por tiempo.
        assert!(dialogues[0].contains("0:00:01.00") && dialogues[9].contains("0:00:03.00"));
    }

    #[test]
    fn fusion_desde_archivos_y_vacia() {
        assert!(merge_ass(&[]).is_err());
        let dir = std::env::temp_dir().join(format!("tstream-test-merge-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.srt");
        let b = dir.join("b.ass");
        // Latin-1 (subtítulos viejos): "canción" con ó = 0xF3.
        std::fs::write(&a, b"1\n00:00:01,000 --> 00:00:02,000\ncanci\xf3n\n").unwrap();
        std::fs::write(&b, ASS).unwrap();
        let ass = merge_ass(&[
            LabeledSubtitle {
                path: a,
                label: "1 · a".into(),
            },
            LabeledSubtitle {
                path: b,
                label: "2 · b".into(),
            },
        ])
        .unwrap();
        assert!(ass.contains("canción"));
        assert!(ass.contains(",S2,"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
