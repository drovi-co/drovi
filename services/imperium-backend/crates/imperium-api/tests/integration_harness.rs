#[tokio::test]
async fn dependency_harness_bootstrap_smoke() {
    if std::env::var("IMPERIUM_INTEGRATION").as_deref() != Ok("1") {
        return;
    }

    let state = imperium_infra::AppState::bootstrap()
        .await
        .expect("app bootstrap should succeed in integration mode");

    state
        .readiness_check()
        .await
        .expect("readiness should pass in integration mode");
}
