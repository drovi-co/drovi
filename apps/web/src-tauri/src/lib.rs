use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;

/// Initialize all Tauri plugins
fn setup_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Logging plugin - different config for debug vs release
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
                        file_name: Some("memorystack.log".into()),
                    }),
                ])
                .build(),
        )?;
    }

    // Shell plugin - for opening URLs in default browser
    app.handle().plugin(tauri_plugin_shell::init())?;

    // OS plugin - for OS information
    app.handle().plugin(tauri_plugin_os::init())?;

    // Process plugin - for process management
    app.handle().plugin(tauri_plugin_process::init())?;

    // Deep link plugin - for handling memorystack:// URLs
    app.handle().plugin(tauri_plugin_deep_link::init())?;

    // Updater plugin - for auto-updates
    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

    // Notification plugin - for system notifications
    app.handle().plugin(tauri_plugin_notification::init())?;

    // Global shortcut plugin - for global keyboard shortcuts
    app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

    // Window state plugin - for persisting window position/size
    app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;

    // Opener plugin - for opening files/URLs
    app.handle().plugin(tauri_plugin_opener::init())?;

    // Single instance plugin (desktop only)
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        app.handle().plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!("Single instance invoked with args: {:?}", argv);

            // Focus the main window when another instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Handle deep link from second instance
            if argv.len() > 1 {
                let url = &argv[1];
                if url.starts_with("memorystack://") {
                    let _ = app.emit("deep-link", url.clone());
                }
            }
        }))?;
    }

    Ok(())
}

/// Create the system tray menu
fn create_tray_menu(app: &tauri::App) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Memorystack", true, None::<&str>)?;
    let check_updates_item = MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
    let separator = MenuItem::with_id(app, "sep", "---", false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Memorystack", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &check_updates_item, &separator, &quit_item])?;

    Ok(menu)
}

/// Set up the system tray
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = create_tray_menu(app)?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Memorystack")
        .menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "check_updates" => {
                let _ = app.emit("check-for-updates", ());
            }
            "quit" => {
                app.exit(0);
            }
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
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Set up deep link handling
fn setup_deep_links(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Register deep link handler
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let handle = app.handle().clone();
        tauri_plugin_deep_link::register("memorystack", move |request| {
            log::info!("Deep link received: {:?}", request);
            let _ = handle.emit("deep-link", request.to_string());
        })?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            log::info!("Setting up Memorystack desktop app");

            // Set macOS activation policy to regular (shows in dock)
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Regular);

            // Initialize all plugins
            if let Err(e) = setup_plugins(app) {
                log::error!("Failed to setup plugins: {}", e);
                return Err(e.into());
            }

            // Set up system tray
            if let Err(e) = setup_tray(app) {
                log::error!("Failed to setup tray: {}", e);
                // Tray failure is not fatal
            }

            // Set up deep link handling
            if let Err(e) = setup_deep_links(app) {
                log::error!("Failed to setup deep links: {}", e);
                // Deep link failure is not fatal
            }

            log::info!("Memorystack desktop app setup complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            // Save window state on close
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                log::info!("Window close requested");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
