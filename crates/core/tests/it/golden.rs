//! Vectores compartidos con la web (`/packages/golden/`): la salida de acá es la fuente de verdad.
//! (Los de reglas privadas están en los `mod tests` de cada módulo.)

use serde_json::{json, Value};
use streamonte_core::audio::{spanish_variant, SpanishVariant};
use streamonte_core::catalog::cinemeta::is_excluded;
use streamonte_core::catalog::normalize::{parse, release_tags, ParseCtx, Parsed};
use streamonte_core::catalog::protocol::Stream;
use streamonte_core::release::parse_release_name;

fn golden(json: &str) -> Vec<Value> {
    serde_json::from_str(json).unwrap()
}

#[test]
fn release() {
    for case in golden(include_str!("../../../../packages/golden/release.json")) {
        let name = case["in"].as_str().unwrap();
        let t = release_tags(name, &parse_release_name(name));
        let hash = "a".repeat(40);
        // Lo que la web llama hint/multi/spa/cam/size sale del candidato completo de `normalize::parse`.
        let stream: Stream =
            serde_json::from_value(json!({ "infoHash": hash, "title": name })).unwrap();
        let ctx = ParseCtx {
            addon_name: "golden",
            addon_rank: 0,
            spain_flag_is_generic: true,
            is_series: false,
        };
        let Parsed::Candidate(c) = parse(&stream, &ctx) else {
            panic!("el candidato no se descartó: {case}")
        };
        let has = |code: &str| c.audio.iter().any(|a| a == code);
        let hint = if has("lat") {
            json!("lat")
        } else if has("cast") {
            json!("spain")
        } else {
            Value::Null
        };
        let spa = ["es", "lat", "cast", "multi"].iter().any(|k| has(k))
            || c.subs.iter().any(|s| s == "es");
        let size = c.size_bytes;
        let out = json!({
            "res": t.resolution,
            "hdr": t.hdr,
            "codec": t.codec,
            "source": t.source,
            "atmos": t.audio_format.iter().any(|a| a == "Atmos"),
            "hint": hint,
            "multi": has("multi"),
            "spa": spa,
            "cam": c.source.as_deref() == Some("CAM"),
            "size": size,
        });
        assert_eq!(out, case["out"], "{case}");
    }
}

#[test]
fn spanish_variant_golden() {
    for case in golden(include_str!(
        "../../../../packages/golden/spanish_variant.json"
    )) {
        let out = match spanish_variant(case["in"].as_str().unwrap()) {
            SpanishVariant::Latino => "latino",
            SpanishVariant::Spain => "spain",
            SpanishVariant::Unknown => "unknown",
        };
        assert_eq!(json!(out), case["out"], "{case}");
    }
}

#[test]
fn excluded() {
    let name = |code: &str| match code {
        "JP" => "Japan",
        "US" => "USA",
        "KR" => "South Korea",
        "FR" => "France",
        "GB" => "UK",
        other => panic!("país sin nombre: {other}"),
    };
    for case in golden(include_str!("../../../../packages/golden/excluded.json")) {
        let countries: Vec<&str> = case["in"]["countries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| name(c.as_str().unwrap()))
            .collect();
        let genres = vec![if case["in"]["animation"].as_bool().unwrap() {
            "Animation"
        } else {
            "Drama"
        }
        .to_string()];
        let country = (!countries.is_empty()).then(|| countries.join(", "));
        assert_eq!(
            json!(is_excluded(country.as_deref(), &genres)),
            case["out"],
            "{case}"
        );
    }
}

#[test]
fn mkv() {
    for case in golden(include_str!("../../../../packages/golden/mkv.json")) {
        let hex = case["in"].as_str().unwrap();
        let bytes: Vec<u8> = (0..hex.len() / 2)
            .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap())
            .collect();
        let out = match streamonte_core::catalog::mkv::parse_tracks(&bytes) {
            None => Value::Null,
            Some(tracks) => json!(tracks
                .iter()
                .map(|t| json!({
                    "type": t.kind,
                    "lang": t.lang,
                    "name": t.name,
                    "forced": t.forced,
                    "codec": t.codec,
                }))
                .collect::<Vec<_>>()),
        };
        assert_eq!(out, case["out"], "{}", case["nota"]);
    }
}
