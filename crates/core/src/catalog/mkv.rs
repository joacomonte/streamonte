//! Pistas de un MKV leyendo solo su principio (2026-11-23): el bloque Tracks va al comienzo del archivo, así que con el
//! primer MB del link de descarga de TorBox alcanza. Mismo lector que la web (`web/src/lib/server/mkv.ts`), más el
//! códec. Mucho más rápido que abrir el video remoto con mpv (decenas de segundos en archivos grandes).

/// Lo que se pide del archivo.
pub const HEAD: usize = 1024 * 1024;

const SEGMENT: u64 = 0x1853_8067;
const TRACKS: u64 = 0x1654_ae6b;
const ENTRY: u64 = 0xae;
const TYPE: u64 = 0x83;
const CODEC: u64 = 0x86;
const FORCED: u64 = 0x55aa;
const NAME: u64 = 0x536e;
const LANG: u64 = 0x0022_b59c;
const BCP47: u64 = 0x0022_b59d;

/// Tipos de pista de Matroska.
pub const AUDIO: u64 = 2;
pub const SUBTITLE: u64 = 17;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Track {
    pub kind: u64,
    pub lang: String,
    pub name: String,
    /// CodecID de Matroska (`S_TEXT/UTF8`, `A_AC3`…).
    pub codec: String,
    pub forced: bool,
}

/// Entero de largo variable de EBML: (valor, largo, tamaño desconocido). `keep_marker`: ids (con el bit marcador).
fn vint(b: &[u8], at: usize, keep_marker: bool) -> Option<(u64, usize, bool)> {
    let first = *b.get(at)?;
    let len = (first.leading_zeros() + 1) as usize;
    if len > 8 || at + len > b.len() {
        return None;
    }
    let mut v = if keep_marker {
        u64::from(first)
    } else {
        u64::from(first & ((0xffu16 >> len) as u8))
    };
    let mut unknown = v == u64::from((0xffu16 >> len) as u8);
    for &byte in &b[at + 1..at + len] {
        v = (v << 8) | u64::from(byte);
        unknown &= byte == 0xff;
    }
    Some((v, len, !keep_marker && unknown))
}

/// Hijos directos de `[start, end)`: (id, inicio del cuerpo, fin).
fn children(b: &[u8], start: usize, end: usize) -> Vec<(u64, usize, usize)> {
    let mut out = Vec::new();
    let mut at = start;
    while at < end {
        let Some((id, id_len, _)) = vint(b, at, true) else {
            break;
        };
        let Some((size, size_len, unknown)) = vint(b, at + id_len, false) else {
            break;
        };
        let body = at + id_len + size_len;
        let size = usize::try_from(size).unwrap_or(usize::MAX);
        let stop = if unknown {
            end
        } else {
            body.saturating_add(size).min(end)
        };
        out.push((id, body, stop));
        if unknown {
            break;
        }
        at = body.saturating_add(size);
    }
    out
}

fn text(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw)
        .trim_end_matches('\0')
        .to_string()
}

fn uint(raw: &[u8]) -> u64 {
    raw.iter().take(8).fold(0, |v, &b| (v << 8) | u64::from(b))
}

/// Pistas del encabezado, o `None` si no es MKV o el bloque Tracks no entra en `b`.
pub fn parse_tracks(b: &[u8]) -> Option<Vec<Track>> {
    let (_, seg_body, seg_end) = children(b, 0, b.len())
        .into_iter()
        .find(|e| e.0 == SEGMENT)?;
    let (_, body, end) = children(b, seg_body, seg_end)
        .into_iter()
        .find(|e| e.0 == TRACKS)?;
    if end > b.len() {
        return None;
    }
    let tracks = children(b, body, end)
        .into_iter()
        .filter(|e| e.0 == ENTRY)
        .map(|(_, body, end)| {
            let mut t = Track {
                kind: 0,
                lang: "eng".into(),
                name: String::new(),
                codec: String::new(),
                forced: false,
            };
            let mut bcp = String::new();
            for (id, start, stop) in children(b, body, end) {
                let raw = &b[start..stop];
                match id {
                    TYPE => t.kind = uint(raw),
                    FORCED => t.forced = uint(raw) == 1,
                    NAME => t.name = text(raw),
                    CODEC => t.codec = text(raw),
                    LANG => t.lang = text(raw),
                    BCP47 => bcp = text(raw),
                    _ => {}
                }
            }
            if !bcp.is_empty() {
                t.lang = bcp;
            }
            t
        })
        .collect();
    Some(tracks)
}

/// Códec de subtítulo con el nombre que da mpv (lo usa `subtitles::spanish_natives` para mostrar el formato).
pub fn mpv_sub_codec(codec: &str) -> &str {
    match codec {
        "S_TEXT/UTF8" | "S_TEXT/ASCII" => "subrip",
        "S_HDMV/PGS" => "hdmv_pgs_subtitle",
        "S_VOBSUB" => "dvd_subtitle",
        "S_TEXT/ASS" | "S_ASS" => "ass",
        "S_TEXT/SSA" | "S_SSA" => "ssa",
        "S_TEXT/WEBVTT" => "webvtt",
        other => other,
    }
}

/// Duración, audios, subtítulos y fps, con la forma de `player::probe_media`.
pub type Probe = (
    Option<f64>,
    Vec<crate::audio::AudioTrack>,
    Vec<crate::subtitles::NativeSub>,
    Option<f64>,
);

/// Pistas del encabezado MKV con la forma de `player::probe_media` (duración, audios, subs, fps; sin duración ni fps).
/// Los subs se numeran como los `sid` de mpv: en orden, desde 1.
pub fn probe_of(tracks: &[Track]) -> Probe {
    let named = |s: &str| (!s.is_empty()).then(|| s.to_string());
    let audio = tracks
        .iter()
        .filter(|t| t.kind == AUDIO)
        .map(|t| crate::audio::AudioTrack {
            lang: named(&t.lang),
            title: named(&t.name),
            codec: named(&t.codec),
            channels: None,
            default: false,
        })
        .collect();
    let subs = tracks
        .iter()
        .filter(|t| t.kind == SUBTITLE)
        .enumerate()
        .map(|(i, t)| crate::subtitles::NativeSub {
            sid: Some(i as i64 + 1),
            file: None,
            lang: named(&t.lang),
            title: named(&t.name),
            codec: named(mpv_sub_codec(&t.codec)),
            forced: t.forced,
        })
        .collect();
    (None, audio, subs, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mismos casos que web/src/lib/server/mkv.test.ts.
    /// Elemento EBML: id + tamaño de 2 bytes + cuerpo.
    fn el(id: &[u8], body: &[&[u8]]) -> Vec<u8> {
        let data: Vec<u8> = body.concat();
        let mut out = id.to_vec();
        out.extend([0x40 | (data.len() >> 8) as u8, (data.len() & 0xff) as u8]);
        out.extend(data);
        out
    }
    const ENTRY_ID: &[u8] = &[0xae];
    const TYPE_ID: &[u8] = &[0x83];
    const FORCED_ID: &[u8] = &[0x55, 0xaa];
    const NAME_ID: &[u8] = &[0x53, 0x6e];
    const CODEC_ID: &[u8] = &[0x86];
    const LANG_ID: &[u8] = &[0x22, 0xb5, 0x9c];
    const BCP_ID: &[u8] = &[0x22, 0xb5, 0x9d];
    const SEGMENT_ID: &[u8] = &[0x18, 0x53, 0x80, 0x67];
    const TRACKS_ID: &[u8] = &[0x16, 0x54, 0xae, 0x6b];
    const EBML_ID: &[u8] = &[0x1a, 0x45, 0xdf, 0xa3];

    fn sample() -> (Vec<u8>, Vec<u8>) {
        let audio = el(
            ENTRY_ID,
            &[
                &el(TYPE_ID, &[&[2]]),
                &el(LANG_ID, &[b"spa\0"]),
                &el(NAME_ID, &[b"Latino"]),
            ],
        );
        let sub = el(
            ENTRY_ID,
            &[
                &el(TYPE_ID, &[&[17]]),
                &el(LANG_ID, &[b"eng"]),
                &el(BCP_ID, &[b"es-419"]),
                &el(FORCED_ID, &[&[1]]),
                &el(CODEC_ID, &[b"S_TEXT/UTF8"]),
            ],
        );
        let tracks = el(TRACKS_ID, &[&audio, &sub]);
        let mkv = [
            el(EBML_ID, &[&[0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]]),
            el(SEGMENT_ID, &[&tracks]),
        ]
        .concat();
        (mkv, tracks)
    }

    #[test]
    fn lee_tipo_idioma_nombre_codec_y_forzado() {
        let (mkv, _) = sample();
        let t = parse_tracks(&mkv).unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(
            (
                t[0].kind,
                t[0].lang.as_str(),
                t[0].name.as_str(),
                t[0].forced
            ),
            (2, "spa", "Latino", false)
        );
        // BCP47 pisa al ISO.
        assert_eq!(
            (
                t[1].kind,
                t[1].lang.as_str(),
                t[1].forced,
                t[1].codec.as_str()
            ),
            (17, "es-419", true, "S_TEXT/UTF8")
        );
    }

    #[test]
    fn pista_sin_idioma_queda_en_eng() {
        let bare = [
            el(EBML_ID, &[&[0]]),
            el(
                SEGMENT_ID,
                &[&el(TRACKS_ID, &[&el(ENTRY_ID, &[&el(TYPE_ID, &[&[1]])])])],
            ),
        ]
        .concat();
        let t = parse_tracks(&bare).unwrap();
        assert_eq!((t[0].kind, t[0].lang.as_str()), (1, "eng"));
    }

    #[test]
    fn no_mkv_vacio_o_cortado_da_none() {
        assert_eq!(parse_tracks(b"esto no es un mkv, ni cerca"), None);
        assert_eq!(parse_tracks(&[]), None);
        let (mkv, _) = sample();
        let at = mkv.windows(4).position(|w| w == SEGMENT_ID).unwrap();
        assert_eq!(parse_tracks(&mkv[..at + 4 + 2]), None);
    }

    #[test]
    fn segment_de_tamano_desconocido() {
        let (_, tracks) = sample();
        let unknown = [
            SEGMENT_ID,
            &[0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
            &tracks,
        ]
        .concat();
        assert_eq!(parse_tracks(&unknown).map(|t| t.len()), Some(2));
    }
}
