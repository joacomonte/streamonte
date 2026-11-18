//! Subtítulos al analizar (2026-11-14).
//!
//! "Buscar y descargar 5 subtítulos en español al analizar el magnet; ponelos en la misma carpeta
//! con el mismo nombre así los carga mpv". Se reusa la búsqueda de la reproducción
//! (`subtitles::session::fetch`) con su caché, así que al darle Ver ya están; además se copian
//! junto al video con nombres que mpv carga solo ([`copy_next_to_video`]).
//!
//! 2026-11-15: "si analizo distintos torrents del mismo episodio/película, no bajar dos veces".
//! Una búsqueda por VIDEO ([`VideoIdentity::video_id`]), no por torrent: el segundo torrent
//! espera/reusa la del primero y solo copia los subtítulos junto a su archivo.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::config::Config;
use crate::library::Library;
use crate::magnet::InfoHash;
use crate::paths::AppPaths;
use crate::subtitles::{SubtitleCandidate, VideoIdentity};

type Found = Vec<(SubtitleCandidate, PathBuf)>;

/// Por video ([`VideoIdentity::video_id`]): su búsqueda, una sola vez en esta sesión.
pub(super) type Prefetched =
    Arc<std::sync::Mutex<HashMap<String, Arc<tokio::sync::OnceCell<Found>>>>>;

#[derive(Clone)]
pub(super) struct SubsCtx {
    pub(super) paths: AppPaths,
    pub(super) config: Arc<tokio::sync::RwLock<Config>>,
    pub(super) library: Arc<tokio::sync::Mutex<Library>>,
    pub(super) started: Prefetched,
}

impl SubsCtx {
    /// De fondo. Se llama al terminar la fase rápida y al terminar de medir: la búsqueda es una
    /// por video; la copia junto al archivo se reintenta (no pisa lo que ya está).
    pub(super) fn prefetch(&self, hash: InfoHash) {
        let ctx = self.clone();
        tokio::spawn(async move { ctx.run(hash).await });
    }

    async fn run(&self, hash: InfoHash) {
        use crate::config::SubtitleLanguage;
        let lang = self.config.read().await.subtitles.language;
        if lang == SubtitleLanguage::None {
            return;
        }
        let Some((torrent_name, file_name, size, video)) = ({
            let library = self.library.lock().await;
            library.any_of(&hash).and_then(|e| {
                let live = e.live.as_ref()?;
                let torrent_name = e.torrent_name.clone().unwrap_or_else(|| e.name.clone());
                let mut video =
                    VideoIdentity::for_file(&live.file_name, &torrent_name, hash, live.file_size);
                video.apply_catalog(
                    library.of_torrent(hash).filter_map(|e| e.origin.as_ref()),
                    live.file_index,
                );
                Some((torrent_name, live.file_name.clone(), live.file_size, video))
            })
        }) else {
            return;
        };
        let id = video.video_id();
        let dir = self.paths.analysis_dir(&hash);
        let cell = self
            .started
            .lock()
            .expect("subs")
            .entry(id.clone())
            .or_default()
            .clone();
        // El primero busca y baja; los demás torrents del mismo video esperan y reusan.
        let got = cell
            .get_or_init(|| async {
                let mut video = video;
                video.movie_hash = measured_file(&dir, &torrent_name, &file_name)
                    .and_then(|p| movie_hash_from_disk(&p, size));
                let log: crate::subtitles::session::LogFn =
                    Arc::new(|line| tracing::info!(target: "streamonte_core::subtitles", "{line}"));
                crate::subtitles::session::fetch(crate::subtitles::session::Fetch {
                    video,
                    video_url: None,
                    torrent_files: Vec::new(), // los de adentro del torrent se leen al reproducir
                    language: lang,
                    cache_dir: AppPaths::video_subtitles_dir(&dir, &id),
                    remembered: None,
                    log,
                })
                .await
            })
            .await;
        // Otro torrent del mismo video bajó primero: copia a la carpeta de este (no pisa).
        crate::subtitles::session::save_copy(&AppPaths::video_subtitles_dir(&dir, &id), lang, got);
        // La carpeta pudo cambiar mientras tanto (la reproducción adopta la del análisis).
        let copied = measured_file(&dir, &torrent_name, &file_name)
            .map_or(0, |video_path| copy_next_to_video(&video_path, got));
        if copied > 0 {
            tracing::info!(
                target: "streamonte_core::subtitles",
                "{} subtítulo(s) de {id} ({} en {}) junto al video de {torrent_name}",
                copied,
                got.iter().filter(|(c, _)| c.language == lang).count(),
                lang.name_es(),
            );
        }
    }
}

/// El archivo medido (`file_name` es la ruta dentro del torrent): rqbit lo baja en
/// `dir/<ruta>`; otros motores pueden anteponer el nombre del torrent. Si no está (p. ej.
/// la reproducción ya adoptó la carpeta), el más grande como antes.
/// Solo rutas relativas sin `..`: el nombre viene del torrent y al lado se escriben
/// subtítulos.
fn measured_file(dir: &Path, torrent_name: &str, file_name: &str) -> Option<PathBuf> {
    let inside = |p: &Path| {
        p.components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
    };
    [dir.join(file_name), dir.join(torrent_name).join(file_name)]
        .into_iter()
        .find(|p| inside(p.strip_prefix(dir).unwrap_or(p)) && p.is_file())
        .or_else(|| crate::fsutil::biggest_file(dir).map(|(p, _)| p))
}

/// Hash OpenSubtitles desde el archivo en disco, solo si el principio y el final ya bajaron
/// (en un archivo disperso lo no bajado se lee como ceros).
fn movie_hash_from_disk(path: &Path, size: u64) -> Option<u64> {
    use std::io::{Read, Seek, SeekFrom};
    if size < 131_072 {
        return None;
    }
    let mut f = std::fs::File::open(path).ok()?;
    let mut head = vec![0u8; 65_536];
    let mut tail = vec![0u8; 65_536];
    f.read_exact(&mut head).ok()?;
    f.seek(SeekFrom::Start(size - 65_536)).ok()?;
    f.read_exact(&mut tail).ok()?;
    let downloaded = |b: &[u8]| b.iter().any(|x| *x != 0);
    (downloaded(&head) && downloaded(&tail))
        .then(|| crate::subtitles::movie_hash(size, &head, &tail))
}

/// Copia los subtítulos (ya en orden: el mejor primero) junto al video con su mismo nombre:
/// `Peli.es.default.srt`, `Peli.es-b.srt`, `Peli.es-c.srt`, `Peli.en.srt`, `Peli.en-b.srt`.
/// Probado con mpv 0.42 (`sub-auto=exact`, el default): carga `<nombre>.<idioma>.<ext>` solo si
/// el idioma es una etiqueta de letras (`es`, `es-MX`, `es-b`); `es-2`, `es-419`, `2.es` y
/// `es.2` NO cargan. `.default` marca la pista que mpv elige si la config del usuario no pide
/// otro idioma (`--slang`). No pisa lo que ya esté.
fn copy_next_to_video(video: &Path, subs: &[(SubtitleCandidate, PathBuf)]) -> usize {
    let Some(stem) = video.file_stem().and_then(|s| s.to_str()) else {
        return 0;
    };
    let mut copied = 0;
    let mut per_language: HashMap<&str, u8> = HashMap::new();
    for (i, (cand, path)) in subs.iter().enumerate() {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("srt");
        let code = cand.language.iso1().unwrap_or("und");
        let n = per_language.entry(code).or_default();
        // Sin números: el 2.º de un idioma es `-b`, el 3.º `-c`…
        let tag = match *n {
            0 => code.to_string(),
            k => format!("{code}-{}", char::from(b'a' + k)),
        };
        *n += 1;
        let default = if i == 0 { ".default" } else { "" };
        let dest = video.with_file_name(format!("{stem}.{tag}{default}.{ext}"));
        if !dest.exists() && std::fs::copy(path, &dest).is_ok() {
            copied += 1;
        }
    }
    copied
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subtitulos_junto_al_video_con_su_nombre() {
        let dir = std::env::temp_dir().join(format!("streamonte-test-subs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("cache")).unwrap();
        let video = dir.join("Dune.Part.Two.2024.mkv");
        // Disperso a medias: principio bajado, final no → sin hash.
        let mut bytes = vec![0u8; 300_000];
        bytes[..1000].fill(7);
        std::fs::write(&video, &bytes).unwrap();
        assert_eq!(movie_hash_from_disk(&video, 300_000), None);
        bytes[299_000..].fill(9);
        std::fs::write(&video, &bytes).unwrap();
        assert!(movie_hash_from_disk(&video, 300_000).is_some());

        let cand = crate::subtitles::SubtitleCandidate {
            provider: crate::subtitles::providers::TORRENT_PROVIDER,
            provider_id: "x".into(),
            release_name: "x".into(),
            language: crate::config::SubtitleLanguage::Es,
            match_kind: crate::subtitles::MatchKind::Exact,
            downloads: 0,
            variant: crate::subtitles::SpanishVariant::Unknown,
            url: String::new(),
            fps: None,
            last_secs: None,
        };
        let a = dir.join("cache").join("a.srt");
        let b = dir.join("cache").join("b.ass");
        let c = dir.join("cache").join("c.srt");
        std::fs::write(&a, "1").unwrap();
        std::fs::write(&b, "2").unwrap();
        std::fs::write(&c, "3").unwrap();
        let mut english = cand.clone();
        english.language = crate::config::SubtitleLanguage::En;
        let subs = vec![(cand.clone(), a), (cand, b), (english, c)];
        assert_eq!(copy_next_to_video(&video, &subs), 3);
        assert!(dir.join("Dune.Part.Two.2024.es.default.srt").is_file());
        assert!(dir.join("Dune.Part.Two.2024.es-b.ass").is_file());
        assert!(dir.join("Dune.Part.Two.2024.en.srt").is_file());
        assert_eq!(copy_next_to_video(&video, &subs), 0, "no pisa ni duplica");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
