//! Vectores compartidos con la web (`/packages/golden/sub_match.json`): calce y orden de subtítulos.
//! Rust es la fuente de verdad; la web lo lee en `web/src/lib/server/golden-subs.test.ts`.

use serde_json::{json, Value};

use super::providers::{release_match, OPENSUBTITLES, SUBDIVX, TORRENT_PROVIDER};
use super::*;

fn video(v: &Value) -> VideoIdentity {
    let mut video = VideoIdentity::from(crate::release::parse_release_name(
        v["file"].as_str().unwrap(),
    ));
    video.fps = v["fps"].as_f64();
    video.duration_secs = v["duration"].as_f64();
    video
}

fn candidate(video: &VideoIdentity, sub: &Value, provider: &'static str) -> SubtitleCandidate {
    let exact = sub["exact"].as_bool().unwrap_or(false);
    let mut c = SubtitleCandidate {
        provider,
        provider_id: sub["id"].as_str().unwrap_or("x").into(),
        release_name: sub["release"].as_str().unwrap().into(),
        language: SubtitleLanguage::Es,
        match_kind: if exact {
            MatchKind::Exact
        } else {
            release_match(video, sub["release"].as_str().unwrap())
        },
        downloads: sub["downloads"].as_u64().unwrap_or(0) as u32,
        variant: if sub["latino"].as_bool().unwrap_or(false) {
            SpanishVariant::Latino
        } else {
            SpanishVariant::Unknown
        },
        url: String::new(),
        fps: sub["fps"].as_f64(),
        last_secs: sub["last"].as_f64(),
    };
    fit_by_timing(video, std::slice::from_mut(&mut c));
    c
}

#[test]
fn sub_match() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../../packages/golden/sub_match.json")).unwrap();
    for case in cases {
        let v = video(&case["in"]["video"]);
        if let Some(subs) = case["in"]["subs"].as_array() {
            let mut all: Vec<_> = subs
                .iter()
                .map(|s| {
                    let provider = match s["provider"].as_str().unwrap() {
                        "torrent" => TORRENT_PROVIDER,
                        "opensubtitles" => OPENSUBTITLES,
                        _ => SUBDIVX,
                    };
                    candidate(&v, s, provider)
                })
                .collect();
            all.sort_by(rank_order);
            let ids: Vec<_> = all.iter().map(|c| c.provider_id.as_str()).collect();
            assert_eq!(json!(ids), case["out"], "{}", case["nota"]);
        } else {
            let c = candidate(&v, &case["in"]["sub"], SUBDIVX);
            let level = match c.match_kind {
                MatchKind::Exact => 3,
                MatchKind::Release => 2,
                MatchKind::Fps => 1,
                MatchKind::None => 0,
            };
            assert_eq!(json!(level), case["out"], "{}", case["nota"]);
        }
    }
}
