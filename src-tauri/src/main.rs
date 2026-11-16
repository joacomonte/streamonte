// Sin consola en release en Windows (FR-14: panel integrado, sin terminal).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    streamonte_app::run();
}
