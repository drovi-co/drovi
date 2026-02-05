use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod commands;
mod context;

use context::ContextState;

/// Initialize all Tauri plugins
fn setup_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug)
                .build(),
        )?;
    }

    #[cfg(not(debug_assertions))]
    {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("drovi-shell.log".into()),
                    }),
                ])
                .build(),
        )?;
    }

    app.handle().plugin(tauri_plugin_shell::init())?;
    app.handle().plugin(tauri_plugin_os::init())?;
    app.handle().plugin(tauri_plugin_process::init())?;
    app.handle().plugin(tauri_plugin_notification::init())?;
    app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
    app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;
    app.handle().plugin(tauri_plugin_opener::init())?;

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        app.handle().plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))?;
    }

    Ok(())
}

fn create_tray_menu(app: &tauri::App) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let open_intent = MenuItem::with_id(app, "open_intent", "Open Intent Bar", true, None::<&str>)?;
    let open_main = MenuItem::with_id(app, "open_main", "Open Command Deck", true, None::<&str>)?;
    let separator = MenuItem::with_id(app, "sep", "---", false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Drovi", true, None::<&str>)?;

    Ok(Menu::with_items(app, &[&open_intent, &open_main, &separator, &quit_item])?)
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = create_tray_menu(app)?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Drovi Shell")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_intent" => {
                if let Some(window) = app.get_webview_window("intent_bar") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "open_main" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("intent_bar") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let shortcut = "CmdOrCtrl+Shift+Space";

    handle.global_shortcut().on_shortcut(shortcut, move |app, _shortcut, _event| {
        if let Some(window) = app.get_webview_window("intent_bar") {
            let is_visible = window.is_visible().unwrap_or(false);
            if is_visible {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    })?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ContextState::new())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Err(e) = setup_plugins(app) {
                log::error!("Failed to setup plugins: {}", e);
                return Err(e.into());
            }

            if let Err(e) = setup_tray(app) {
                log::error!("Failed to setup tray: {}", e);
            }

            if let Err(e) = setup_shortcuts(app) {
                log::error!("Failed to setup shortcuts: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Context capture commands
            commands::get_active_context,
            commands::get_context_cache,
            commands::get_context_policy,
            commands::clear_context_cache,
            commands::update_context_budget,
            commands::update_context_policy,
            // Core API commands
            commands::core_request,
            // Window commands
            commands::toggle_intent_bar,
            // Auth token storage commands
            commands::store_auth_token,
            commands::get_auth_token,
            commands::delete_auth_token,
            commands::clear_auth_tokens,
            commands::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
