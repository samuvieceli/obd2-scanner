//! Portable mode, start-up checks and other small Windows services.
//!
//! The portable version is the program file alone, in a zip, with no
//! installer. When a file named [`MARKER`] sits next to the program, all
//! settings and saved data (profiles, units, theme, performance results...)
//! go to the [`DATA_DIR`] folder beside it instead of the user's Windows
//! profile, so the whole folder can be carried on a USB stick. Delete the
//! marker to use the normal Windows folder again.
//!
//! The screens are drawn by Microsoft Edge WebView2, which comes with
//! Windows 10 and 11. The installer adds it when missing; the portable
//! version cannot, so [`webview_missing`] lets `run` explain it in a
//! message box instead of failing silently.

use std::path::{Path, PathBuf};

/// File next to the program that turns portable mode on.
pub const MARKER: &str = "portable.txt";
/// Folder created next to the program for settings and data.
pub const DATA_DIR: &str = "OBD2-Scanner-dados";

/// Where to keep the data in portable mode, or `None` for the normal
/// Windows folder (no marker, or the folder beside the program is read-only,
/// e.g. inside "Arquivos de Programas").
pub fn data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    data_dir_beside(exe.parent()?)
}

fn data_dir_beside(folder: &Path) -> Option<PathBuf> {
    if !folder.join(MARKER).is_file() {
        return None;
    }
    let dir = folder.join(DATA_DIR);
    std::fs::create_dir_all(&dir).ok()?;
    // Writable? (create_dir_all succeeds when the folder already exists.)
    let probe = dir.join(".write-test");
    std::fs::write(&probe, b"").ok()?;
    let _ = std::fs::remove_file(probe);
    Some(dir)
}

/// True when WebView2 is not installed (Windows only).
pub fn webview_missing() -> bool {
    cfg!(windows) && tauri::webview_version().is_err()
}

/// Text shown when WebView2 is missing, in both languages because the
/// interface language is only known once the screens can be drawn.
pub const WEBVIEW_MISSING: &str = "\
O OBD2 Scanner precisa do Microsoft Edge WebView2, que não foi encontrado neste computador.\n\
Instale o \"WebView2 Runtime\" (gratuito, da Microsoft) em:\n\
https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\
ou use o instalador do OBD2 Scanner, que já o instala sozinho.\n\n\
OBD2 Scanner needs Microsoft Edge WebView2, which was not found on this computer.\n\
Install the free \"WebView2 Runtime\" from the link above, or use the OBD2 Scanner installer, which adds it automatically.";

/// Asks Windows to keep the screen on and not to sleep (`on = true`), or
/// lifts that request. Applies to the calling thread, so it must always be
/// called from the same long-lived thread (the main thread, see `keep_awake`).
#[cfg(windows)]
pub fn keep_awake(on: bool) {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    let flags = if on {
        ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    // SAFETY: plain flag call, no pointers.
    unsafe { SetThreadExecutionState(flags) };
}

#[cfg(not(windows))]
pub fn keep_awake(_on: bool) {}

/// Shows a plain Windows message box (no window of the app exists yet).
#[cfg(windows)]
pub fn alert(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (title, text) = (wide(title), wide(text));
    // SAFETY: both pointers are valid, NUL-terminated UTF-16 for the call.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONWARNING,
        )
    };
}

#[cfg(not(windows))]
pub fn alert(title: &str, text: &str) {
    eprintln!("{title}: {text}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_only_with_the_marker() {
        let folder = std::env::temp_dir().join(format!("obd2-portable-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        assert_eq!(data_dir_beside(&folder), None);
        assert!(
            !folder.join(DATA_DIR).exists(),
            "no folder without the marker"
        );

        std::fs::write(folder.join(MARKER), "x").unwrap();
        let dir = data_dir_beside(&folder).unwrap();
        assert_eq!(dir, folder.join(DATA_DIR));
        assert!(dir.is_dir());
        assert!(!dir.join(".write-test").exists());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
