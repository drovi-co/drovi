use std::time::Duration;

use imperium_infra::{telemetry::init_tracing, AppState};

#[tokio::main]
async fn main() {
    init_tracing("info,imperium_api=debug");

    if std::env::args().any(|arg| arg == "--print-openapi") {
        let openapi = imperium_api::openapi::openapi_json();
        match serde_json::to_string_pretty(&openapi) {
            Ok(json) => {
                println!("{json}");
            }
            Err(error) => {
                eprintln!("failed to serialize OpenAPI document: {error}");
                std::process::exit(1);
            }
        }
        return;
    }

    let state = match AppState::bootstrap().await {
        Ok(state) => state,
        Err(error) => {
            tracing::error!("failed to bootstrap app state: {error}");
            std::process::exit(1);
        }
    };

    let addr = match state.config.socket_addr() {
        Ok(addr) => addr,
        Err(error) => {
            tracing::error!("failed to resolve socket address: {error}");
            std::process::exit(1);
        }
    };

    let grace_period = state.config.shutdown_grace_period;

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%addr, "failed to bind listener: {error}");
            std::process::exit(1);
        }
    };

    tracing::info!(%addr, "imperium-api started");

    let router = imperium_api::app::build_router(state.clone());

    let server =
        axum::serve(listener, router).with_graceful_shutdown(shutdown_signal(grace_period));

    if let Err(error) = server.await {
        tracing::error!("imperium-api terminated with error: {error}");
        std::process::exit(1);
    }
}

async fn shutdown_signal(grace_period: Duration) {
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut stream) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            stream.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        result = tokio::signal::ctrl_c() => {
            if let Err(error) = result {
                tracing::error!("failed to listen for ctrl-c signal: {error}");
            }
        }
        _ = terminate => {}
    }

    tracing::info!(
        "shutdown signal received; waiting {:?} for graceful stop",
        grace_period
    );
    tokio::time::sleep(grace_period).await;
}
