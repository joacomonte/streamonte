//! Cáscara Tauri: crea la ventana, arranca `AppCore`, registra comandos y reenvía eventos.
//! No contiene lógica de negocio (NFR-01).

mod commands;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use streamonte_core::app::AppCore;
use streamonte_core::events::{CoreEvent, EventSink};
use streamonte_core::playback::OnAppClose;
use tauri::{Emitter, Manager, WindowEvent};

/// `true` cuando ya se hizo la limpieza de cierre y la ventana puede cerrarse de verdad.
pub(crate) static CLOSING: AtomicBool = AtomicBool::new(false);

/// Reenvía `CoreEvent` a la UI como evento `core://event`.
struct TauriSink(tauri::AppHandle);

impl EventSink for TauriSink {
    fn emit(&self, event: CoreEvent) {
        if let Err(e) = self.0.emit("core://event", &event) {
            tracing::warn!("no se pudo emitir evento a la UI: {e}");
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let sink = Arc::new(TauriSink(app.handle().clone()));
            let core = tauri::async_runtime::block_on(AppCore::start(sink))?;
            app.manage(core);
            Ok(())
        })
        // FR-17 / FR-20: cerrar la ventana nunca deja procesos ni carpetas huérfanas.
        // Con reproducciones activas se le pregunta a la UI (Detener todo / Dejar mpv abierto);
        // sin ellas se limpia y se cierra directo.
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            // La ventana aparte de Actividad (`logs`) se cierra sola, sin cerrar la app.
            if window.label() != "main" {
                return;
            }
            if CLOSING.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            let app = window.app_handle().clone();
            let core = app.state::<Arc<AppCore>>().inner().clone();
            let active = core.active_playbacks();
            if active > 0 {
                TauriSink(app.clone()).emit(CoreEvent::ConfirmClose { active });
                return;
            }
            tauri::async_runtime::spawn(async move {
                if let Err(e) = core.on_close(OnAppClose::StopAll).await {
                    tracing::warn!("al cerrar: {e}");
                }
                CLOSING.store(true, Ordering::SeqCst);
                app.exit(0);
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_get,
            commands::library_remove,
            commands::analyze,
            commands::analyzer_pause,
            commands::analyzer_resume,
            commands::analyzer_cancel,
            commands::copied_magnet,
            commands::library_add_selected,
            commands::play,
            commands::playback_action,
            commands::playbacks_get,
            commands::playback_log,
            commands::stop_all_and_clean,
            commands::on_close,
            commands::temp_usage,
            commands::clean_temp,
            commands::open_downloads_folder,
            commands::logs_tail,
            commands::check_incoming,
            commands::export_logs,
            commands::open_logs_window,
            commands::config_get,
            commands::config_set_network,
            commands::config_set_equalizer,
            commands::config_set_language,
            commands::players_status,
            commands::catalog_torbox,
            commands::play_torbox,
            commands::catalog_torbox_tracks,
            commands::playback_subtitle,
            commands::opensubtitles_login_set,
            commands::catalog_link,
            commands::save_subtitles,
            commands::install_mpv,
            commands::api_key_set,
            commands::api_keys,
            commands::catalog_poster,
            commands::catalog_swarm,
            commands::catalog_census,
            commands::catalog_subtitles,
            commands::catalog_subtitle_use,
            commands::premium_quota,
            commands::catalog_premium_search,
            commands::catalog_premium_use,
            commands::open_key_page,
            commands::catalog_search,
            commands::catalog_people,
            commands::catalog_person_titles,
            commands::catalog_meta,
            commands::catalog_details,
            commands::catalog_similar,
            commands::catalog_trending,
            commands::catalog_browse_interests,
            commands::catalog_interest_examples,
            commands::catalog_episodes,
            commands::torbox_magnet,
            commands::torbox_magnet_download,
            commands::catalog_season_ratings,
            commands::speed_test,
            commands::catalog_stop_swarm,
            commands::data_cache_size,
            commands::clear_data_cache,
            commands::catalog_browse_top,
            commands::catalog_open_imdb,
            commands::catalog_swarm_saved,
            commands::downloads_free_bytes,
            commands::catalog_open_trailer,
            commands::catalog_streams,
            commands::catalog_stop_streams,
            commands::catalog_add,
            commands::catalog_addons,
            commands::catalog_add_addon,
            commands::catalog_remove_addon,
            commands::catalog_set_addon_enabled,
            commands::catalog_reset_addons,
            commands::catalog_set_exclude_japanese,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Streamonte");
}
