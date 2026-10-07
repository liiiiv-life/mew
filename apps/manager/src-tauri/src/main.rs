#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod core;
#[cfg(windows)]
mod desktop;
fn main() {
    #[cfg(windows)]
    desktop::run();
    #[cfg(not(windows))]
    eprintln!("mewnager runs on Windows. Use npm run dev for the browser preview.");
}
