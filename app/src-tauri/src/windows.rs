//! Small per-download windows, like IDM's: "New download" when the browser
//! hands over a file, then live progress, then "Download complete".

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Apply actual native window geometry, never a painted CSS corner.
pub fn polish(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        // The real region owns the contour on both Windows 10 and 11.
        // Avoid a rectangular compositor shadow around the clipped region.
        unsafe { native_shape(hwnd.0, window.is_maximized().unwrap_or(false)); }
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(windows)]
unsafe fn native_shape(hwnd: *mut std::ffi::c_void, maximized: bool) {
    use std::ffi::c_void;
    #[repr(C)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
    #[link(name = "dwmapi")]
    unsafe extern "system" { fn DwmSetWindowAttribute(hwnd: *mut c_void, attr: u32, value: *const c_void, size: u32) -> i32; }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetWindowRect(hwnd: *mut c_void, rect: *mut Rect) -> i32;
        fn GetDpiForWindow(hwnd: *mut c_void) -> u32;
        fn SetWindowRgn(hwnd: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
    }
    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn CreateRoundRectRgn(left:i32, top:i32, right:i32, bottom:i32, width:i32, height:i32) -> *mut c_void;
        fn DeleteObject(object: *mut c_void) -> i32;
    }
    // Deduplicate region updates: SetWindowRgn itself emits position messages.
    // Keep the bounded cache free of HWND ownership; Windows owns all regions.
    type Shape = (i32, i32, u32, bool);
    static SHAPES: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<usize, Shape>>> = std::sync::OnceLock::new();
    let mut bounds = Rect { left:0, top:0, right:0, bottom:0 };
    if unsafe { GetWindowRect(hwnd, &mut bounds) } == 0 { return; }
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    let shape = (bounds.right-bounds.left, bounds.bottom-bounds.top, dpi, maximized);
    {
        let mut shapes = SHAPES.get_or_init(Default::default).lock().unwrap_or_else(|e|e.into_inner());
        if shapes.get(&(hwnd as usize)) == Some(&shape) { return; }
        if shapes.len() >= 128 { shapes.clear(); }
        shapes.insert(hwnd as usize, shape);
    }
    let preference: u32 = 1; // DWM does not add a second, competing contour.
    let border: u32 = 0xffff_fffe;
    unsafe {
        DwmSetWindowAttribute(hwnd, 33, (&preference as *const u32).cast(), 4);
        DwmSetWindowAttribute(hwnd, 34, (&border as *const u32).cast(), 4);
        if maximized { SetWindowRgn(hwnd, std::ptr::null_mut(), 1); return; }
        let mut rect = Rect { left:0, top:0, right:0, bottom:0 };
        if GetWindowRect(hwnd, &mut rect) != 0 {
            let diameter = ((24 * GetDpiForWindow(hwnd).max(96)) / 96) as i32;
            let region = CreateRoundRectRgn(0, 0, rect.right-rect.left+1, rect.bottom-rect.top+1, diameter, diameter);
            // Ownership transfers to the OS on success.
            if !region.is_null() && SetWindowRgn(hwnd, region, 1) == 0 { DeleteObject(region); }
        }
    }
}

/// Actual content width; no transparent margins for a synthetic shadow.
const WINDOW_WIDTH: f64 = 552.0;

/// Puts a window in front of whatever the user is doing, like IDM's dialogs.
/// Windows only lets a background app flash its taskbar button, but a
/// window that is briefly "always on top" still appears above everything;
/// it then drops back to a normal window, staying in front.
fn bring_to_front(w: &WebviewWindow) {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_always_on_top(true);
    let _ = w.set_focus();
    let w = w.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        let _ = w.set_focus();
        let _ = w.set_always_on_top(false);
    });
}

/// Opens `download.html?{query}` in a window called `label`, or brings an
/// existing one forward.
///
/// The window is built on its own thread. Building one on the main thread,
/// which is where synchronous commands run, deadlocks WebView2 on Windows:
/// pasting a YouTube link froze the whole app (#4).
pub fn open(app: &AppHandle, label: &str, query: &str, title: &str) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(label) {
        bring_to_front(&w);
        return Ok(());
    }
    let (app, label, query, title) = (app.clone(), label.to_string(), query.to_string(), title.to_string());
    // Match the saved theme so the window never flashes white before the
    // webview paints; "system" keeps the same dark default as the main window.
    let background = app
        .try_state::<std::sync::Arc<crate::manager::DownloadManager>>()
        .map(|m| if m.settings().theme == "light" { tauri::window::Color(244, 244, 244, 255) } else { tauri::window::Color(20, 20, 20, 255) })
        .unwrap_or(tauri::window::Color(20, 20, 20, 255));
    std::thread::spawn(move || {
        // Opaque and frameless: native geometry clips the outer window.
        let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("download.html?{query}").into()))
            .title(&title)
            .inner_size(WINDOW_WIDTH, 360.0)
            .resizable(false)
            .maximizable(false)
            .decorations(false)
            .transparent(false)
            .shadow(false)
            .background_color(background)
            .center()
            .focused(true)
            .always_on_top(true)
            .build();
        match built {
            Ok(w) => { polish(&w); bring_to_front(&w); },
            Err(e) => crate::log::line(&format!("could not open window {label}: {e:#}")),
        }
    });
    Ok(())
}
