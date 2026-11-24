//! Trazabilidad de criterios de aceptación (spec 02 + 06-A).
//! Cada CA tiene su prueba con nombre `fr_xx_…` / `t_xx_…`. Las pruebas de red (T-01..T-06,
//! NFR-09, FR-25/26) no tienen cuerpo acá: se verifican a mano en la sesión real (NFR-17, lección 7);
//! la única con código es FR-06 (`#[ignore = "network"]`): `cargo test -- --ignored network`.

// ---------- F2: magnet / biblioteca / análisis ----------
// La cola del analizador (FR-06 sin red, FR-08 pausa/reanudar/re-analizar/no medidos/reintentos)
// se prueba con un medidor falso en `analyzer::tests`; acá queda la corrida real (red).
mod f2 {
    use std::time::Duration;

    use async_trait::async_trait;
    use streamonte_core::clipboard::{self, ClipboardHistory, ClipboardSource, WatchGuard};
    use streamonte_core::config::RankingConfig;
    use streamonte_core::events::ClipboardUnavailable;
    use streamonte_core::library::{AddOutcome, Group, Library};
    use streamonte_core::magnet::{self, InfoHash, Magnet};
    use streamonte_core::ranking::{self, RankInput};
    use tokio::sync::mpsc;

    use crate::common::{TempRoot, BBB, SINTEL, TOS};

    const SINTEL_B32: &str = "magnet:?xt=urn:btih:BCW2LJ5GDA5K4HQJ3AY56Z2I2VTASWQQ&dn=Sintel";

    fn temp_library(name: &str) -> (Library, TempRoot) {
        let dir = TempRoot::new(name);
        let lib = Library::load(dir.join("library.json")).unwrap();
        (lib, dir)
    }

    /// Lo que hace la app con cada texto copiado (FR-01).
    fn copy(lib: &mut Library, text: &str) {
        for (m, raw) in magnet::extract_all_with_raw(text) {
            lib.add_or_touch(&m, &raw);
        }
    }

    #[test]
    fn fr_01_tres_magnets_uno_repetido_dan_dos_filas() {
        let (mut lib, _dir) = temp_library("fr01a");
        for text in [SINTEL, BBB, SINTEL] {
            copy(&mut lib, text);
        }
        assert_eq!(lib.len(), 2);
    }

    #[test]
    fn fr_01_texto_con_varios_magnets_agrega_todos() {
        let (mut lib, _dir) = temp_library("fr01b");
        let text = format!("mirá estos:\n{SINTEL}\n- {BBB} y <a href=\"{TOS}\">este</a>");
        copy(&mut lib, &text);
        assert_eq!(lib.len(), 3);
    }

    #[test]
    fn fr_01_hash_hex_y_base32_son_el_mismo() {
        let (mut lib, _dir) = temp_library("fr01c");
        copy(&mut lib, SINTEL);
        let b32 = Magnet::parse(SINTEL_B32).unwrap();
        assert_eq!(
            lib.add_or_touch(&b32, SINTEL_B32),
            AddOutcome::AlreadyPresent
        );
        assert_eq!(lib.len(), 1);
    }

    #[test]
    fn fr_02_historial_se_detiene_en_el_primer_no_magnet() {
        // [m3, m2, texto, m1] → m3 y m2.
        let items = [TOS, BBB, "texto cualquiera", SINTEL].map(clipboard::HistoryItem::from);
        let got: Vec<String> = clipboard::magnets_from_history(&items)
            .into_iter()
            .map(|(m, _)| m.display_name.unwrap())
            .collect();
        assert_eq!(got, ["Tears of Steel", "Big Buck Bunny"]);
    }

    /// Portapapeles falso: historial fijo + último copiado.
    struct FakeClipboard {
        history: ClipboardHistory,
        current: Option<String>,
    }

    #[async_trait]
    impl ClipboardSource for FakeClipboard {
        fn watch(&self, _tx: mpsc::Sender<String>) -> streamonte_core::Result<WatchGuard> {
            Err(streamonte_core::CoreError::Unsupported("prueba"))
        }
        async fn current_text(&self) -> streamonte_core::Result<Option<String>> {
            Ok(self.current.clone())
        }
        async fn history(&self) -> streamonte_core::Result<ClipboardHistory> {
            Ok(self.history.clone())
        }
    }

    #[tokio::test]
    async fn fr_02_historial_desactivado_usa_ultimo_copiado() {
        let off = FakeClipboard {
            history: ClipboardHistory::Disabled,
            current: Some(BBB.into()),
        };
        let r = clipboard::import(&off).await;
        assert!(matches!(
            r.unavailable,
            Some(ClipboardUnavailable::HistoryDisabled)
        ));
        assert_eq!(r.magnets.len(), 1);
        assert_eq!(r.magnets[0].1, BBB, "se guarda tal cual se copió (FR-04)");

        // macOS: no hay historial → solo el último copiado, con su aviso (NFR-13).
        let mac = FakeClipboard {
            history: ClipboardHistory::Unsupported,
            current: Some("nada".into()),
        };
        let r = clipboard::import(&mac).await;
        assert!(matches!(
            r.unavailable,
            Some(ClipboardUnavailable::NotSupportedOnThisOs)
        ));
        assert!(r.magnets.is_empty());

        let on = FakeClipboard {
            history: ClipboardHistory::Items(vec![TOS.into(), "x".into(), SINTEL.into()]),
            current: None,
        };
        let r = clipboard::import(&on).await;
        assert!(r.unavailable.is_none());
        assert_eq!(r.magnets.len(), 1);
    }

    #[test]
    fn fr_03_reabrir_pasa_todo_a_anteriores() {
        let (mut lib, dir) = temp_library("fr03a");
        copy(&mut lib, SINTEL);
        copy(&mut lib, BBB);
        assert_eq!(lib.list(Group::PastedNow).len(), 2);
        lib.save().unwrap();
        // "Cerrar y abrir".
        let lib = Library::load(dir.join("library.json")).unwrap();
        assert_eq!(lib.list(Group::PastedNow).len(), 0);
        assert_eq!(lib.list(Group::Previous).len(), 2);
    }

    #[test]
    fn fr_03_copiar_uno_de_anteriores_lo_mueve_a_pegados_ahora() {
        let (mut lib, dir) = temp_library("fr03b");
        copy(&mut lib, SINTEL);
        copy(&mut lib, BBB);
        lib.save().unwrap();
        let mut lib = Library::load(dir.join("library.json")).unwrap();
        copy(&mut lib, SINTEL);
        let now: Vec<String> = lib
            .list(Group::PastedNow)
            .into_iter()
            .map(|r| r.entry.name)
            .collect();
        assert_eq!(now, ["Sintel"]);
        assert_eq!(lib.list(Group::Previous).len(), 1);
    }

    /// Tracker UDP falso (BEP 15): seeders = 1er byte del hash, leechers = 2º, completed = 3º.
    async fn fake_tracker() -> String {
        let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let addr = socket.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buf = [0u8; 2048];
            while let Ok((n, from)) = socket.recv_from(&mut buf).await {
                let action = u32::from_be_bytes(buf[8..12].try_into().unwrap());
                let mut resp = Vec::new();
                resp.extend_from_slice(&action.to_be_bytes());
                resp.extend_from_slice(&buf[12..16]);
                match action {
                    0 => resp.extend_from_slice(&42u64.to_be_bytes()),
                    2 => {
                        for h in buf[16..n].chunks_exact(20) {
                            for v in [h[0], h[2], h[1]] {
                                resp.extend_from_slice(&u32::from(v).to_be_bytes());
                            }
                        }
                    }
                    _ => continue,
                }
                let _ = socket.send_to(&resp, from).await;
            }
        });
        format!("udp://{addr}/announce")
    }

    /// Tracker UDP que recibe y nunca responde (a diferencia de un puerto cerrado, que devuelve
    /// ICMP al instante). El socket vive en una tarea hasta que termina el runtime de la prueba.
    fn silent_tracker() -> String {
        let socket = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = socket.local_addr().unwrap();
        std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            while socket.recv_from(&mut buf).is_ok() {}
        });
        format!("udp://{addr}/announce")
    }

    #[tokio::test]
    async fn fr_05_scrape_udp_contra_servidor_falso() {
        let trackers = vec![
            fake_tracker().await,
            silent_tracker(),
            "wss://tracker.webtorrent.dev".to_string(), // no UDP: se ignora
        ];
        let hashes: Vec<InfoHash> = (1..=3u8)
            .map(|i| {
                InfoHash::from_bytes([
                    i * 10,
                    i,
                    7,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    i,
                ])
            })
            .collect();
        let timeout = Duration::from_millis(150);
        let started = std::time::Instant::now();
        let r = streamonte_core::trackers::scrape_batch(&hashes, &trackers, timeout).await;
        let elapsed = started.elapsed();
        // El tracker mudo hace esperar todo el plazo (y no más): el bueno igual aporta.
        assert!(elapsed >= timeout, "esperó el plazo del mudo: {elapsed:?}");
        assert!(elapsed < Duration::from_secs(1), "FR-05: {elapsed:?}");
        assert_eq!(r.len(), 3);
        let s = &r[&hashes[2]];
        assert_eq!(
            (s.seeders, s.leechers, s.completed, s.trackers_ok),
            (30, 3, 7, 1)
        );
    }

    #[test]
    fn fr_07_orden_por_defecto_y_margen() {
        let cfg = RankingConfig::default();
        let gb = 1_000_000_000;
        // 1 GB en 1 000 s → necesita 1 MB/s.
        let measured = |name: &str, mbps: f64| RankInput {
            name: name.into(),
            size_bytes: Some(gb),
            real_duration_secs: Some(1_000.0),
            measured_speed_bps: Some(mbps * 1e6),
            seeders: Some(1),
            leechers: Some(1),
        };
        let unmeasured = |name: &str, seeders: u32, leechers: u32| RankInput {
            name: name.into(),
            seeders: Some(seeders),
            leechers: Some(leechers),
            ..Default::default()
        };
        let inputs = vec![
            unmeasured("s5", 5, 0),
            measured("rojo", 0.5),
            unmeasured("s9", 9, 0),
            measured("verde", 2.0),
            unmeasured("s5-l3", 5, 3),
            measured("amarillo", 1.2),
            RankInput {
                name: "sin datos".into(),
                ..Default::default()
            },
        ];
        let order: Vec<&str> = ranking::default_order(&inputs, &cfg)
            .into_iter()
            .map(|i| inputs[i].name.as_str())
            .collect();
        assert_eq!(
            order,
            [
                "verde",
                "amarillo",
                "rojo",
                "s9",
                "s5-l3",
                "s5",
                "sin datos"
            ]
        );
        assert_eq!(ranking::score(&unmeasured("x", 3, 3), &cfg).margin, None);
        let margin = ranking::score(&measured("v", 2.0), &cfg).margin.unwrap();
        assert!((margin - 2.0).abs() < 1e-9, "margen = velocidad ÷ necesita");
    }

    #[test]
    fn fr_07_duracion_estimada_pelicula_y_episodio() {
        let cfg = RankingConfig::default();
        let movie = ranking::duration_or_estimate(None, "Sintel.2010.1080p", &cfg);
        assert_eq!((movie.secs, movie.estimated), (120.0 * 60.0, true));
        let episode = ranking::duration_or_estimate(None, "Serie.S02E05.720p.WEB", &cfg);
        assert_eq!((episode.secs, episode.estimated), (45.0 * 60.0, true));
        let real = ranking::duration_or_estimate(Some(888.0), "Serie.S02E05", &cfg);
        assert_eq!((real.secs, real.estimated), (888.0, false));
        // Sin medición real, el "necesita" usa la estimada: 5,4 GB / 2 h = 750 kB/s.
        let s = ranking::score(
            &RankInput {
                name: "Pelicula".into(),
                size_bytes: Some(5_400_000_000),
                ..Default::default()
            },
            &cfg,
        );
        assert_eq!(s.needed_bps, Some(750_000.0));
        assert!(s.duration.unwrap().estimated);
    }

    #[test]
    fn t_07_magnet_con_ampersand_y_caracteres_raros() {
        let raw = "magnet:?xt=urn:btih:BCW2LJ5GDA5K4HQJ3AY56Z2I2VTASWQQ&amp;dn=Tom+%26+Jerry+%C3%91and%C3%BA+%5B1080p%5D&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce";
        let m = Magnet::parse(raw).unwrap();
        assert_eq!(
            m.info_hash.to_hex(),
            "08ada5a7a6183aae1e09d831df6748d566095a10"
        );
        assert_eq!(m.display_name.as_deref(), Some("Tom & Jerry Ñandú [1080p]"));
        assert_eq!(m.trackers, ["udp://tracker.opentrackr.org:1337/announce"]);
        // Ida y vuelta por el URI canónico: mismo magnet.
        assert_eq!(Magnet::parse(&m.to_uri()).unwrap(), m);
        // Dentro de un texto con comillas también se encuentra.
        let found = magnet::extract_all(&format!("\"{raw}\""));
        assert_eq!(found, [m]);
    }

    /// FR-06 CA con red real (sesión del usuario, lección 7): Sintel → velocidad > 0 y duración 14:48.
    /// `cargo test -p streamonte-core --test it -- --ignored fr_06 --nocapture`
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "network"]
    async fn fr_06_sintel_velocidad_y_duracion_real() {
        use streamonte_core::analyzer::{LiveMeasurer, Measurer};
        let root = TempRoot::new("fr06");
        let paths = root.app_paths();
        let cfg = streamonte_core::config::Config::default();
        let measurer = LiveMeasurer::new(paths.clone(), Default::default());
        let m = Magnet::parse(SINTEL).unwrap();
        let ctl = streamonte_core::analyzer::MeasureCtl {
            cancel: tokio_util::sync::CancellationToken::new(),
            finish: tokio_util::sync::CancellationToken::new(),
            progress: std::sync::Arc::new(|p| println!("avance: {p:?}")),
        };
        let live = measurer
            .measure(&m, Default::default(), &cfg, ctl)
            .await
            .unwrap();
        println!("{live:#?}");
        assert!(live.avg_speed_bps > 0.0);
        let secs = live.duration_secs.expect("duración real");
        assert!((secs - 888.0).abs() < 1.0, "Sintel dura 14:48, dio {secs}");
        let leftovers = std::fs::read_dir(paths.downloads_dir()).unwrap().count();
        assert_eq!(leftovers, 0, "todo lo bajado se borra (FR-06)");
    }
}

// ---------- F3: panel / limpieza ----------
mod f3 {
    use std::collections::HashSet;
    use std::path::PathBuf;

    use streamonte_core::cleanup::Cleanup;
    use streamonte_core::paths::AppPaths;

    use crate::common::{write_owner, TempRoot};

    fn setup(name: &str) -> (TempRoot, AppPaths) {
        let root = TempRoot::new(name);
        let paths = root.app_paths();
        (root, paths)
    }

    fn download_dir(paths: &AppPaths, name: &str, app_pid: u32) -> PathBuf {
        let d = paths.downloads_dir().join(name);
        std::fs::create_dir_all(d.join("pieces")).unwrap();
        std::fs::write(d.join("pieces").join("0"), vec![1u8; 4096]).unwrap();
        write_owner(&d, app_pid);
        d
    }

    /// T-05 (parte automatizable): una carpeta cuyo dueño murió (app matada a la fuerza) se borra
    /// al reabrir; la de un dueño vivo no. La parte con un proceso real matado se verifica a mano.
    #[test]
    fn t_05_proceso_matado_limpia_restos_al_reabrir() {
        let (_root, paths) = setup("t05");
        let muerta = download_dir(&paths, "de-app-muerta", u32::MAX - 11);
        let viva = download_dir(&paths, "de-app-viva", std::process::id());
        let report = Cleanup::new(paths.clone())
            .clean_orphans(&HashSet::new())
            .unwrap();
        assert_eq!(report.dirs_removed, 1);
        assert!(report.bytes_freed >= 4096);
        assert!(!muerta.exists() && viva.exists());
    }

    /// FR-19: "Limpiar temporales" nunca toca reproducciones activas ni el historial.
    #[test]
    fn fr_19_limpiar_no_toca_reproducciones_activas() {
        let (_root, paths) = setup("fr19");
        std::fs::write(paths.library_file(), b"[]").unwrap();
        let activa = download_dir(&paths, "activa", std::process::id());
        let vieja = download_dir(&paths, "detenida", std::process::id());
        let report = Cleanup::new(paths.clone())
            .clean(&HashSet::from([activa.clone()]))
            .unwrap();
        assert_eq!(report.dirs_removed, 1);
        assert!(activa.exists() && !vieja.exists());
        assert!(paths.library_file().exists(), "el historial no se toca");
    }
}

// ---------- FR-06d: lo bajado al analizar sirve de precarga ----------
mod fr06d {
    use std::path::PathBuf;
    use std::sync::Arc;

    use streamonte_core::app::{AppCore, StartOptions};
    use streamonte_core::cleanup::KEPT_FILE;
    use streamonte_core::events::CoreEvent;
    use streamonte_core::library::Library;
    use streamonte_core::magnet::Magnet;
    use streamonte_core::paths::AppPaths;

    use crate::common::{channel_sink, wait_event, write_owner, TempRoot, BBB, SINTEL, TOS};

    /// Carpeta de análisis de una sesión anterior (dueño muerto), con una pieza bajada.
    fn analysis_dir(paths: &AppPaths, magnet: &Magnet) -> PathBuf {
        let d = paths.analysis_dir(&magnet.info_hash);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("video.mp4"), vec![1u8; 4096]).unwrap();
        write_owner(&d, u32::MAX - 11);
        d
    }

    /// Reabrir la app borra todo lo analizado, también lo de los magnets que siguen en la lista
    /// (2026-11-15: "no quiero que vaya dejando basura por la PC"). Lo guardado a propósito
    /// (`.streamonte-kept.json`) no es análisis y no entra acá: aunque su dueño haya muerto, se conserva.
    #[tokio::test]
    async fn fr_06d_lo_analizado_se_borra_al_abrir() {
        let root = TempRoot::new("fr06d");
        let paths = root.app_paths();
        let [sintel, bbb, tos] = [SINTEL, BBB, TOS].map(|m| Magnet::parse(m).unwrap());
        {
            let mut lib = Library::load(paths.library_file()).unwrap();
            lib.add_or_touch(&sintel, SINTEL);
            lib.add_or_touch(&bbb, BBB);
            lib.save().unwrap();
        }
        let d_sintel = analysis_dir(&paths, &sintel);
        let d_bbb = analysis_dir(&paths, &bbb);
        let d_tos = analysis_dir(&paths, &tos); // ya no está en la lista
                                                // Descarga guardada por el usuario, con dueño muerto: la limpieza no la toca.
        let d_kept = paths.downloads_dir().join("guardada");
        std::fs::create_dir_all(&d_kept).unwrap();
        std::fs::write(d_kept.join("video.mp4"), vec![1u8; 4096]).unwrap();
        std::fs::write(d_kept.join(KEPT_FILE), b"{}").unwrap();
        write_owner(&d_kept, u32::MAX - 11);

        let (sink, mut events) = channel_sink();
        let core = AppCore::start_with(
            Arc::new(sink),
            StartOptions {
                capture_clipboard: false,
                paths: Some(paths.clone()),
                background_fetch: false,
            },
        )
        .await
        .unwrap();
        // Al terminar de limpiar, la app avisa "Se limpiaron restos…".
        wait_event(
            &mut events,
            |e| matches!(e, CoreEvent::Status { message, .. } if message.starts_with("Se limpiaron restos")),
        )
        .await;
        assert!(!d_tos.exists(), "huérfano borrado al abrir");
        assert!(!d_sintel.exists(), "lo de la lista también se borra");
        assert!(!d_bbb.exists(), "lo de la lista también se borra");
        assert!(d_kept.join("video.mp4").exists(), "lo guardado no se borra");
        drop(core);
    }
}
