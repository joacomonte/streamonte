//! Vectores compartidos con la web (`/packages/golden/`): la salida de acá es la fuente de verdad.
//! (Los de reglas privadas están en los `mod tests` de cada módulo.)

use serde_json::{json, Value};
use streamonte_core::catalog::cinemeta::is_excluded;
use streamonte_core::catalog::normalize::release_tags;
use streamonte_core::release::parse_release_name;

fn golden(json: &str) -> Vec<Value> {
    serde_json::from_str(json).unwrap()
}

#[test]
fn release() {
    for case in golden(include_str!("../../../../packages/golden/release.json")) {
        let name = case["in"].as_str().unwrap();
        let t = release_tags(name, &parse_release_name(name));
        let out = json!({
            "res": t.resolution,
            "hdr": t.hdr,
            "codec": t.codec,
            "source": t.source,
            "atmos": t.audio_format.iter().any(|a| a == "Atmos"),
        });
        assert_eq!(out, case["out"], "{case}");
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
