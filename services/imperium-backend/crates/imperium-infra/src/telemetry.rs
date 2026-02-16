use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard, OnceLock,
    },
    time::{Duration, Instant},
};

use axum::{
    extract::{MatchedPath, Request},
    http::{HeaderName, HeaderValue},
    middleware::Next,
    response::Response,
};
use tracing_subscriber::{fmt, EnvFilter};
use uuid::Uuid;

pub const REQUEST_ID_HEADER: &str = "x-request-id";
const LATENCY_BUCKETS_SECONDS: [f64; 10] = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

struct MetricsStore {
    started_at: Instant,
    http_requests_total: Mutex<BTreeMap<String, u64>>,
    http_duration_sum: Mutex<BTreeMap<String, f64>>,
    http_duration_count: Mutex<BTreeMap<String, u64>>,
    http_duration_buckets: Mutex<BTreeMap<String, u64>>,
    http_inflight: AtomicU64,
    connector_requests_total: Mutex<BTreeMap<String, u64>>,
    connector_duration_sum: Mutex<BTreeMap<String, f64>>,
    connector_duration_count: Mutex<BTreeMap<String, u64>>,
    connector_duration_buckets: Mutex<BTreeMap<String, u64>>,
    connector_estimated_cost_usd_total: Mutex<BTreeMap<String, f64>>,
    worker_cycles_total: Mutex<BTreeMap<String, u64>>,
    worker_cycle_duration_sum: Mutex<BTreeMap<String, f64>>,
    worker_cycle_duration_count: Mutex<BTreeMap<String, u64>>,
    worker_cycle_duration_buckets: Mutex<BTreeMap<String, u64>>,
    nats_publish_total: Mutex<BTreeMap<String, u64>>,
    dead_letter_events_total: Mutex<BTreeMap<String, u64>>,
}

impl MetricsStore {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
            http_requests_total: Mutex::new(BTreeMap::new()),
            http_duration_sum: Mutex::new(BTreeMap::new()),
            http_duration_count: Mutex::new(BTreeMap::new()),
            http_duration_buckets: Mutex::new(BTreeMap::new()),
            http_inflight: AtomicU64::new(0),
            connector_requests_total: Mutex::new(BTreeMap::new()),
            connector_duration_sum: Mutex::new(BTreeMap::new()),
            connector_duration_count: Mutex::new(BTreeMap::new()),
            connector_duration_buckets: Mutex::new(BTreeMap::new()),
            connector_estimated_cost_usd_total: Mutex::new(BTreeMap::new()),
            worker_cycles_total: Mutex::new(BTreeMap::new()),
            worker_cycle_duration_sum: Mutex::new(BTreeMap::new()),
            worker_cycle_duration_count: Mutex::new(BTreeMap::new()),
            worker_cycle_duration_buckets: Mutex::new(BTreeMap::new()),
            nats_publish_total: Mutex::new(BTreeMap::new()),
            dead_letter_events_total: Mutex::new(BTreeMap::new()),
        }
    }
}

static METRICS: OnceLock<MetricsStore> = OnceLock::new();

pub fn init_tracing(default_filter: &str) {
    let env_filter = std::env::var("RUST_LOG").unwrap_or_else(|_| default_filter.to_string());

    let _ = fmt()
        .with_env_filter(EnvFilter::new(env_filter))
        .with_target(true)
        .try_init();
}

pub async fn http_metrics_middleware(request: Request, next: Next) -> Response {
    let method = request.method().as_str().to_string();
    let path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_string())
        .unwrap_or_else(|| request.uri().path().to_string());

    let metrics = metrics();
    metrics.http_inflight.fetch_add(1, Ordering::Relaxed);
    let started = Instant::now();
    let response = next.run(request).await;
    let elapsed = started.elapsed();
    metrics.http_inflight.fetch_sub(1, Ordering::Relaxed);

    record_http_request(&method, &path, response.status().as_u16(), elapsed);
    response
}

pub async fn request_id_middleware(mut request: Request, next: Next) -> Response {
    let request_id = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|header| header.to_str().ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    request
        .extensions_mut()
        .insert(RequestId(request_id.clone()));

    let mut response = next.run(request).await;

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(REQUEST_ID_HEADER), value);
    }

    response
}

pub fn record_http_request(method: &str, path: &str, status: u16, duration: Duration) {
    let status_label = status.to_string();
    let request_labels = labels(&[
        ("method", method),
        ("path", path),
        ("status", status_label.as_str()),
    ]);
    increment_counter(&metrics().http_requests_total, request_labels);

    let duration_labels = labels(&[("method", method), ("path", path)]);
    let seconds = duration.as_secs_f64();
    add_sum(
        &metrics().http_duration_sum,
        duration_labels.clone(),
        seconds,
    );
    increment_counter(&metrics().http_duration_count, duration_labels.clone());
    observe_histogram(
        &metrics().http_duration_buckets,
        &duration_labels,
        seconds,
        &LATENCY_BUCKETS_SECONDS,
    );
}

pub fn record_connector_request(
    domain: &str,
    provider: &str,
    status: &str,
    duration: Duration,
    estimated_cost_usd: f64,
) {
    let request_labels = labels(&[
        ("domain", domain),
        ("provider", provider),
        ("status", status),
    ]);
    increment_counter(&metrics().connector_requests_total, request_labels);

    let duration_labels = labels(&[("domain", domain), ("provider", provider)]);
    let seconds = duration.as_secs_f64();
    add_sum(
        &metrics().connector_duration_sum,
        duration_labels.clone(),
        seconds,
    );
    increment_counter(&metrics().connector_duration_count, duration_labels.clone());
    observe_histogram(
        &metrics().connector_duration_buckets,
        &duration_labels,
        seconds,
        &LATENCY_BUCKETS_SECONDS,
    );

    if estimated_cost_usd > 0.0 {
        add_sum(
            &metrics().connector_estimated_cost_usd_total,
            duration_labels,
            estimated_cost_usd,
        );
    }
}

pub fn record_worker_cycle(role: &str, status: &str, duration: Duration) {
    let cycle_labels = labels(&[("role", role), ("status", status)]);
    increment_counter(&metrics().worker_cycles_total, cycle_labels);

    let duration_labels = labels(&[("role", role)]);
    let seconds = duration.as_secs_f64();
    add_sum(
        &metrics().worker_cycle_duration_sum,
        duration_labels.clone(),
        seconds,
    );
    increment_counter(
        &metrics().worker_cycle_duration_count,
        duration_labels.clone(),
    );
    observe_histogram(
        &metrics().worker_cycle_duration_buckets,
        &duration_labels,
        seconds,
        &LATENCY_BUCKETS_SECONDS,
    );
}

pub fn record_nats_publish(subject: &str, status: &str) {
    let labels = labels(&[("subject", subject), ("status", status)]);
    increment_counter(&metrics().nats_publish_total, labels);
}

pub fn record_dead_letter_event(role: &str, subject: &str, action: &str) {
    let labels = labels(&[("role", role), ("subject", subject), ("action", action)]);
    increment_counter(&metrics().dead_letter_events_total, labels);
}

pub fn render_prometheus_metrics() -> String {
    let metrics = metrics();
    let mut output = String::new();

    output.push_str("# HELP imperium_uptime_seconds Process uptime in seconds.\n");
    output.push_str("# TYPE imperium_uptime_seconds gauge\n");
    output.push_str(&format!(
        "imperium_uptime_seconds {}\n",
        metrics.started_at.elapsed().as_secs_f64()
    ));

    output.push_str("# HELP imperium_http_requests_total HTTP requests handled.\n");
    output.push_str("# TYPE imperium_http_requests_total counter\n");
    append_u64_map(
        &mut output,
        "imperium_http_requests_total",
        &metrics.http_requests_total,
    );

    output.push_str(
        "# HELP imperium_http_request_duration_seconds Request duration histogram by route.\n",
    );
    output.push_str("# TYPE imperium_http_request_duration_seconds histogram\n");
    append_u64_map(
        &mut output,
        "imperium_http_request_duration_seconds_bucket",
        &metrics.http_duration_buckets,
    );
    append_f64_map(
        &mut output,
        "imperium_http_request_duration_seconds_sum",
        &metrics.http_duration_sum,
    );
    append_u64_map(
        &mut output,
        "imperium_http_request_duration_seconds_count",
        &metrics.http_duration_count,
    );
    output.push_str("# HELP imperium_http_inflight_requests In-flight HTTP requests.\n");
    output.push_str("# TYPE imperium_http_inflight_requests gauge\n");
    output.push_str(&format!(
        "imperium_http_inflight_requests {}\n",
        metrics.http_inflight.load(Ordering::Relaxed)
    ));

    output.push_str("# HELP imperium_connector_requests_total Connector request count.\n");
    output.push_str("# TYPE imperium_connector_requests_total counter\n");
    append_u64_map(
        &mut output,
        "imperium_connector_requests_total",
        &metrics.connector_requests_total,
    );
    output.push_str(
        "# HELP imperium_connector_request_duration_seconds Connector request duration histogram.\n",
    );
    output.push_str("# TYPE imperium_connector_request_duration_seconds histogram\n");
    append_u64_map(
        &mut output,
        "imperium_connector_request_duration_seconds_bucket",
        &metrics.connector_duration_buckets,
    );
    append_f64_map(
        &mut output,
        "imperium_connector_request_duration_seconds_sum",
        &metrics.connector_duration_sum,
    );
    append_u64_map(
        &mut output,
        "imperium_connector_request_duration_seconds_count",
        &metrics.connector_duration_count,
    );
    output.push_str(
        "# HELP imperium_connector_estimated_cost_usd_total Estimated provider spend in USD.\n",
    );
    output.push_str("# TYPE imperium_connector_estimated_cost_usd_total counter\n");
    append_f64_map(
        &mut output,
        "imperium_connector_estimated_cost_usd_total",
        &metrics.connector_estimated_cost_usd_total,
    );

    output.push_str("# HELP imperium_worker_cycles_total Worker cycle outcomes.\n");
    output.push_str("# TYPE imperium_worker_cycles_total counter\n");
    append_u64_map(
        &mut output,
        "imperium_worker_cycles_total",
        &metrics.worker_cycles_total,
    );
    output.push_str(
        "# HELP imperium_worker_cycle_duration_seconds Worker cycle duration histogram.\n",
    );
    output.push_str("# TYPE imperium_worker_cycle_duration_seconds histogram\n");
    append_u64_map(
        &mut output,
        "imperium_worker_cycle_duration_seconds_bucket",
        &metrics.worker_cycle_duration_buckets,
    );
    append_f64_map(
        &mut output,
        "imperium_worker_cycle_duration_seconds_sum",
        &metrics.worker_cycle_duration_sum,
    );
    append_u64_map(
        &mut output,
        "imperium_worker_cycle_duration_seconds_count",
        &metrics.worker_cycle_duration_count,
    );

    output.push_str("# HELP imperium_nats_publish_total NATS publish attempts.\n");
    output.push_str("# TYPE imperium_nats_publish_total counter\n");
    append_u64_map(
        &mut output,
        "imperium_nats_publish_total",
        &metrics.nats_publish_total,
    );

    output.push_str("# HELP imperium_dead_letter_events_total Dead-letter queue events.\n");
    output.push_str("# TYPE imperium_dead_letter_events_total counter\n");
    append_u64_map(
        &mut output,
        "imperium_dead_letter_events_total",
        &metrics.dead_letter_events_total,
    );

    output
}

fn metrics() -> &'static MetricsStore {
    METRICS.get_or_init(MetricsStore::new)
}

fn increment_counter(map: &Mutex<BTreeMap<String, u64>>, key: String) {
    let mut guard = lock(map);
    *guard.entry(key).or_insert(0) += 1;
}

fn add_sum(map: &Mutex<BTreeMap<String, f64>>, key: String, value: f64) {
    let mut guard = lock(map);
    *guard.entry(key).or_insert(0.0) += value;
}

fn observe_histogram(
    map: &Mutex<BTreeMap<String, u64>>,
    base_labels: &str,
    value: f64,
    buckets: &[f64],
) {
    let mut guard = lock(map);

    for boundary in buckets {
        if value <= *boundary {
            let key = format!("{base_labels},le=\"{}\"", format_bucket(*boundary));
            *guard.entry(key).or_insert(0) += 1;
        }
    }

    let inf_key = format!("{base_labels},le=\"+Inf\"");
    *guard.entry(inf_key).or_insert(0) += 1;
}

fn append_u64_map(output: &mut String, metric: &str, map: &Mutex<BTreeMap<String, u64>>) {
    let guard = lock(map);
    for (labels, value) in guard.iter() {
        output.push_str(metric);
        output.push('{');
        output.push_str(labels);
        output.push_str("} ");
        output.push_str(&value.to_string());
        output.push('\n');
    }
}

fn append_f64_map(output: &mut String, metric: &str, map: &Mutex<BTreeMap<String, f64>>) {
    let guard = lock(map);
    for (labels, value) in guard.iter() {
        output.push_str(metric);
        output.push('{');
        output.push_str(labels);
        output.push_str("} ");
        output.push_str(&format!("{value:.6}"));
        output.push('\n');
    }
}

fn labels(values: &[(&str, &str)]) -> String {
    values
        .iter()
        .map(|(key, value)| format!("{key}=\"{}\"", escape_label(value)))
        .collect::<Vec<_>>()
        .join(",")
}

fn escape_label(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('"', "\\\"")
}

fn format_bucket(boundary: f64) -> String {
    if boundary.fract() == 0.0 {
        format!("{boundary:.0}")
    } else {
        boundary.to_string()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
