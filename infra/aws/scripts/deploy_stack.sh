#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_var() {
  local var_name="$1"
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required environment variable: $var_name" >&2
    exit 1
  fi
}

build_and_push() {
  local image="$1"
  shift
  echo "Building image: $image"
  docker build -t "$image" "$@"
  docker push "$image"
}

replace_in_tree() {
  local search="$1"
  local replacement="$2"
  local safe_replacement
  safe_replacement="${replacement//&/\\&}"
  find "$K8S_TMP_DIR" -type f -name '*.yaml' -exec sed -i.bak "s|${search}|${safe_replacement}|g" {} +
}

dump_job_diagnostics() {
  local job_name="$1"

  kubectl -n drovi get job "${job_name}" -o wide || true
  kubectl -n drovi describe job "${job_name}" || true
  kubectl -n drovi get pods -l "job-name=${job_name}" -o wide || true

  mapfile -t job_pods < <(kubectl -n drovi get pods -l "job-name=${job_name}" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' || true)

  if [[ "${#job_pods[@]}" -eq 0 ]]; then
    echo "No pods found for job ${job_name}. Recent namespace events:" >&2
    kubectl -n drovi get events --sort-by=.lastTimestamp | tail -n 120 || true
    return 0
  fi

  for pod_name in "${job_pods[@]}"; do
    if [[ -z "${pod_name}" ]]; then
      continue
    fi
    kubectl -n drovi logs "${pod_name}" --all-containers --tail=300 || true
    kubectl -n drovi describe pod "${pod_name}" || true
  done
}

dump_deployment_diagnostics() {
  local deployment_name="$1"

  kubectl -n drovi get deployment "${deployment_name}" -o wide || true
  kubectl -n drovi describe deployment "${deployment_name}" || true
  kubectl -n drovi get rs -l "app=${deployment_name}" -o wide || true
  kubectl -n drovi get pods -l "app=${deployment_name}" -o wide || true

  mapfile -t deployment_pods < <(kubectl -n drovi get pods -l "app=${deployment_name}" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' || true)

  if [[ "${#deployment_pods[@]}" -eq 0 ]]; then
    echo "No pods found for deployment ${deployment_name}. Recent namespace events:" >&2
    kubectl -n drovi get events --sort-by=.lastTimestamp | tail -n 120 || true
    return 0
  fi

  for pod_name in "${deployment_pods[@]}"; do
    if [[ -z "${pod_name}" ]]; then
      continue
    fi
    kubectl -n drovi logs "${pod_name}" --all-containers --tail=300 || true
    kubectl -n drovi describe pod "${pod_name}" || true
  done

  kubectl -n drovi get svc falkordb falkordb-client nats || true
  kubectl -n drovi get endpoints falkordb falkordb-client nats || true
}

wait_for_job_complete() {
  local job_name="$1"
  local timeout="$2"

  if kubectl -n drovi wait --for=condition=complete "job/${job_name}" --timeout="${timeout}"; then
    return 0
  fi

  echo "Job ${job_name} did not reach Complete within ${timeout}. Dumping diagnostics..." >&2
  dump_job_diagnostics "${job_name}"
  return 1
}

wait_for_deployment_rollout() {
  local deployment_name="$1"
  local timeout="$2"

  if kubectl -n drovi rollout status "deployment/${deployment_name}" --timeout="${timeout}"; then
    return 0
  fi

  echo "Deployment ${deployment_name} failed rollout within ${timeout}. Dumping diagnostics..." >&2
  dump_deployment_diagnostics "${deployment_name}"
  if [[ "${auto_rollback_on_failed_rollout}" == "true" ]]; then
    echo "Attempting rollout undo for deployment/${deployment_name}..." >&2
    kubectl -n drovi rollout undo "deployment/${deployment_name}" || true
    kubectl -n drovi rollout status "deployment/${deployment_name}" --timeout=5m || true
  fi
  return 1
}

wait_for_statefulset_rollout() {
  local statefulset_name="$1"
  local timeout="$2"

  if kubectl -n drovi rollout status "statefulset/${statefulset_name}" --timeout="${timeout}"; then
    return 0
  fi

  echo "StatefulSet ${statefulset_name} failed rollout within ${timeout}. Dumping diagnostics..." >&2
  kubectl -n drovi get statefulset "${statefulset_name}" -o wide || true
  kubectl -n drovi describe statefulset "${statefulset_name}" || true
  kubectl -n drovi get pods -l "app=${statefulset_name}" -o wide || true

  mapfile -t statefulset_pods < <(kubectl -n drovi get pods -l "app=${statefulset_name}" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' || true)
  for pod_name in "${statefulset_pods[@]}"; do
    if [[ -z "${pod_name}" ]]; then
      continue
    fi
    kubectl -n drovi logs "${pod_name}" --all-containers --tail=300 || true
    kubectl -n drovi describe pod "${pod_name}" || true
  done

  return 1
}

ensure_temporal_schema() {
  local table_count
  local visibility_count

  table_count="$(
    kubectl -n drovi exec deployment/temporal-postgres -- \
      psql -U temporal -d temporal -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';" \
      2>/dev/null | tr -d '[:space:]'
  )"
  visibility_count="$(
    kubectl -n drovi exec deployment/temporal-postgres -- \
      psql -U temporal -d temporal_visibility -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';" \
      2>/dev/null | tr -d '[:space:]'
  )"

  if [[ "${table_count}" =~ ^[0-9]+$ ]] && [[ "${visibility_count}" =~ ^[0-9]+$ ]] \
    && [[ "${table_count}" -gt 0 ]] && [[ "${visibility_count}" -gt 0 ]]; then
    return 0
  fi

  echo "Bootstrapping Temporal schema (temporal=${table_count:-unknown}, visibility=${visibility_count:-unknown})..." >&2
  kubectl -n drovi exec deployment/temporal -- sh -lc '
set -e
export SQL_PASSWORD="${POSTGRES_PWD}"
temporal-sql-tool --plugin postgres12 --ep "${POSTGRES_SEEDS}" -u "${POSTGRES_USER}" -p "${DB_PORT}" --db temporal setup-schema -v 0.0
temporal-sql-tool --plugin postgres12 --ep "${POSTGRES_SEEDS}" -u "${POSTGRES_USER}" -p "${DB_PORT}" --db temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned
temporal-sql-tool --plugin postgres12 --ep "${POSTGRES_SEEDS}" -u "${POSTGRES_USER}" -p "${DB_PORT}" --db temporal_visibility create || true
temporal-sql-tool --plugin postgres12 --ep "${POSTGRES_SEEDS}" -u "${POSTGRES_USER}" -p "${DB_PORT}" --db temporal_visibility setup-schema -v 0.0
temporal-sql-tool --plugin postgres12 --ep "${POSTGRES_SEEDS}" -u "${POSTGRES_USER}" -p "${DB_PORT}" --db temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned
'
}

preflight_cluster() {
  local min_node_count="$1"
  local node_count

  if ! kubectl get nodes >/dev/null 2>&1; then
    echo "kubectl cannot reach the target cluster." >&2
    exit 1
  fi

  node_count="$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${node_count}" -lt "${min_node_count}" ]]; then
    echo "Cluster has ${node_count} node(s), below required minimum ${min_node_count} for ${K8S_OVERLAY}." >&2
    exit 1
  fi

  if kubectl get ingressclass alb >/dev/null 2>&1; then
    return 0
  fi

  if kubectl -n kube-system get deployment aws-load-balancer-controller >/dev/null 2>&1; then
    return 0
  fi

  if [[ "${require_ingress_controller}" == "true" ]]; then
    echo "Missing ALB ingress controller (ingressClass=alb or aws-load-balancer-controller)." >&2
    exit 1
  fi

  echo "Warning: ALB ingress controller not detected; continuing because REQUIRE_INGRESS_CONTROLLER=${require_ingress_controller}." >&2
}

preflight_kustomize_overlay() {
  local overlay_path="$1"

  if [[ ! -d "${overlay_path}" ]]; then
    echo "Kustomize overlay not found: ${overlay_path}" >&2
    exit 1
  fi

  if ! kubectl kustomize "${overlay_path}" >/dev/null; then
    echo "Failed to render kustomize overlay: ${overlay_path}" >&2
    exit 1
  fi
}

ensure_metrics_server() {
  if kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1 \
    && kubectl -n kube-system get deployment metrics-server >/dev/null 2>&1; then
    return 0
  fi

  echo "Installing metrics-server (v0.8.1)..." >&2
  kubectl apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.8.1/components.yaml"
  kubectl -n kube-system rollout status deployment/metrics-server --timeout=5m
}

assert_no_unreplaced_placeholders() {
  local manifests_root="$1"
  local matches_file

  matches_file="$(mktemp)"
  if grep -R -n -E 'REPLACE_[A-Z0-9_]+' "${manifests_root}" \
    --include='*.yaml' \
    --exclude='secrets.template.yaml' \
    >"${matches_file}"; then
    echo "Unreplaced manifest placeholders detected:" >&2
    cat "${matches_file}" >&2
    rm -f "${matches_file}"
    exit 1
  fi
  rm -f "${matches_file}"
}

require_cmd docker
require_cmd kubectl
require_cmd mktemp
require_cmd sed

required_vars=(
  ECR_REGISTRY
  ECR_REPOSITORY_PREFIX
  IMAGE_TAG
  K8S_OVERLAY
  VITE_SERVER_URL_WEB
  VITE_SERVER_URL_ADMIN
  DROVI_APP_IAM_ROLE_ARN
  IMPERIUM_IAM_ROLE_ARN
  ACM_CERT_ARN
  DATABASE_URL
  DROVI_DATABASE_URL
  REDIS_URL
  KAFKA_BOOTSTRAP_SERVERS
  KAFKA_SASL_USERNAME
  KAFKA_SASL_PASSWORD
  EVIDENCE_S3_BUCKET
  EVIDENCE_S3_REGION
  EVIDENCE_S3_KMS_KEY_ID
  TEMPORAL_ADDRESS
  DROVI_INTERNAL_SERVICE_TOKEN
  INTERNAL_JWT_SECRET
  API_KEY_SALT
)

for required_var in "${required_vars[@]}"; do
  require_var "$required_var"
done

kafka_bootstrap_required="${KAFKA_BOOTSTRAP_REQUIRED:-}"
if [[ -z "${kafka_bootstrap_required}" ]]; then
  if [[ "${K8S_OVERLAY}" == "staging" ]]; then
    kafka_bootstrap_required="false"
  else
    kafka_bootstrap_required="true"
  fi
fi

kafka_bootstrap_timeout="${KAFKA_BOOTSTRAP_WAIT_TIMEOUT:-20m}"
min_eks_node_count="${MIN_EKS_NODE_COUNT:-}"
require_ingress_controller="${REQUIRE_INGRESS_CONTROLLER:-}"
auto_rollback_on_failed_rollout="${AUTO_ROLLBACK_ON_FAILED_ROLLOUT:-true}"

if [[ -z "${min_eks_node_count}" ]]; then
  if [[ "${K8S_OVERLAY}" == "staging" ]]; then
    min_eks_node_count="2"
  else
    min_eks_node_count="3"
  fi
fi

if [[ -z "${require_ingress_controller}" ]]; then
  if [[ "${K8S_OVERLAY}" == "production" ]]; then
    require_ingress_controller="true"
  else
    require_ingress_controller="false"
  fi
fi

if [[ "${K8S_OVERLAY}" == "production" && "${kafka_bootstrap_required}" != "true" ]]; then
  echo "Production deployments must enforce KAFKA_BOOTSTRAP_REQUIRED=true." >&2
  exit 1
fi

preflight_cluster "${min_eks_node_count}"
ensure_metrics_server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

DROVI_INTELLIGENCE_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY_PREFIX}/drovi-intelligence:${IMAGE_TAG}"
DROVI_INGESTION_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY_PREFIX}/drovi-ingestion-worker:${IMAGE_TAG}"
IMPERIUM_BACKEND_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY_PREFIX}/imperium-backend:${IMAGE_TAG}"
WEB_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY_PREFIX}/web:${IMAGE_TAG}"
ADMIN_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY_PREFIX}/admin:${IMAGE_TAG}"
IMPERIUM_WEB_IMAGE="${ECR_REGISTRY}/${ECR_REPOSITORY_PREFIX}/imperium-web:${IMAGE_TAG}"

build_and_push "$DROVI_INTELLIGENCE_IMAGE" \
  -f "${REPO_ROOT}/drovi-intelligence/Dockerfile" \
  "${REPO_ROOT}/drovi-intelligence"

build_and_push "$DROVI_INGESTION_IMAGE" \
  -f "${REPO_ROOT}/drovi-intelligence/ingestion-worker/Dockerfile" \
  "${REPO_ROOT}/drovi-intelligence/ingestion-worker"

build_and_push "$IMPERIUM_BACKEND_IMAGE" \
  -f "${REPO_ROOT}/services/imperium-backend/Dockerfile" \
  "${REPO_ROOT}"

build_and_push "$WEB_IMAGE" \
  --build-arg "VITE_SERVER_URL=${VITE_SERVER_URL_WEB}" \
  -f "${REPO_ROOT}/apps/web/Dockerfile" \
  "${REPO_ROOT}"

build_and_push "$ADMIN_IMAGE" \
  --build-arg "VITE_SERVER_URL=${VITE_SERVER_URL_ADMIN}" \
  -f "${REPO_ROOT}/apps/admin/Dockerfile" \
  "${REPO_ROOT}"

build_and_push "$IMPERIUM_WEB_IMAGE" \
  -f "${REPO_ROOT}/apps/imperium/Dockerfile" \
  "${REPO_ROOT}"

K8S_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$K8S_TMP_DIR"' EXIT

cp -R "${REPO_ROOT}/infra/aws/k8s" "$K8S_TMP_DIR/k8s"

replace_in_tree 'REPLACE_ECR_DROVI_INTELLIGENCE:latest' "$DROVI_INTELLIGENCE_IMAGE"
replace_in_tree 'REPLACE_ECR_DROVI_INGESTION_WORKER:latest' "$DROVI_INGESTION_IMAGE"
replace_in_tree 'REPLACE_ECR_IMPERIUM_BACKEND:latest' "$IMPERIUM_BACKEND_IMAGE"
replace_in_tree 'REPLACE_ECR_WEB:latest' "$WEB_IMAGE"
replace_in_tree 'REPLACE_ECR_ADMIN:latest' "$ADMIN_IMAGE"
replace_in_tree 'REPLACE_ECR_IMPERIUM_WEB:latest' "$IMPERIUM_WEB_IMAGE"
replace_in_tree 'arn:aws:iam::REPLACE_AWS_ACCOUNT_ID:role/REPLACE_DROVI_APP_ROLE' "$DROVI_APP_IAM_ROLE_ARN"
replace_in_tree 'arn:aws:iam::REPLACE_AWS_ACCOUNT_ID:role/REPLACE_IMPERIUM_ROLE' "$IMPERIUM_IAM_ROLE_ARN"
replace_in_tree 'arn:aws:acm:REPLACE_REGION:REPLACE_ACCOUNT:certificate/REPLACE_CERT_ID' "$ACM_CERT_ARN"

find "$K8S_TMP_DIR" -type f -name '*.bak' -delete

preflight_kustomize_overlay "$K8S_TMP_DIR/k8s/overlays/${K8S_OVERLAY}"
assert_no_unreplaced_placeholders "$K8S_TMP_DIR/k8s"

kubectl apply -f "$K8S_TMP_DIR/k8s/base/namespace.yaml"

effective_redis_url="${REDIS_URL}"
if [[ "${effective_redis_url}" == redis://* ]] && [[ "${effective_redis_url}" == *".cache.amazonaws.com"* ]]; then
  effective_redis_url="${effective_redis_url/redis:\/\//rediss://}"
fi

kubectl -n drovi create secret generic drovi-secrets \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=DROVI_DATABASE_URL="${DROVI_DATABASE_URL}" \
  --from-literal=REDIS_URL="${effective_redis_url}" \
  --from-literal=KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS}" \
  --from-literal=KAFKA_SASL_USERNAME="${KAFKA_SASL_USERNAME}" \
  --from-literal=KAFKA_SASL_PASSWORD="${KAFKA_SASL_PASSWORD}" \
  --from-literal=EVIDENCE_S3_BUCKET="${EVIDENCE_S3_BUCKET}" \
  --from-literal=EVIDENCE_S3_REGION="${EVIDENCE_S3_REGION}" \
  --from-literal=EVIDENCE_S3_KMS_KEY_ID="${EVIDENCE_S3_KMS_KEY_ID}" \
  --from-literal=TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS}" \
  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  --from-literal=TOGETHER_API_KEY="${TOGETHER_API_KEY:-}" \
  --from-literal=FIREWORKS_API_KEY="${FIREWORKS_API_KEY:-}" \
  --from-literal=HUGGINGFACE_API_KEY="${HUGGINGFACE_API_KEY:-}" \
  --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
  --from-literal=GOOGLE_AI_API_KEY="${GOOGLE_AI_API_KEY:-}" \
  --from-literal=RESEND_API_KEY="${RESEND_API_KEY:-}" \
  --from-literal=TS_INTERNAL_SECRET="${TS_INTERNAL_SECRET:-}" \
  --from-literal=DROVI_INTERNAL_SERVICE_TOKEN="${DROVI_INTERNAL_SERVICE_TOKEN}" \
  --from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" \
  --from-literal=ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}" \
  --from-literal=ADMIN_JWT_SECRET="${ADMIN_JWT_SECRET:-}" \
  --from-literal=GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
  --from-literal=GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
  --from-literal=SLACK_CLIENT_ID="${SLACK_CLIENT_ID:-}" \
  --from-literal=SLACK_CLIENT_SECRET="${SLACK_CLIENT_SECRET:-}" \
  --from-literal=NOTION_CLIENT_ID="${NOTION_CLIENT_ID:-}" \
  --from-literal=NOTION_CLIENT_SECRET="${NOTION_CLIENT_SECRET:-}" \
  --from-literal=AGENT_INBOX_INBOUND_TOKEN="${AGENT_INBOX_INBOUND_TOKEN:-}" \
  --from-literal=INTERNAL_JWT_SECRET="${INTERNAL_JWT_SECRET}" \
  --from-literal=API_KEY_SALT="${API_KEY_SALT}" \
  --from-literal=POLYGON_API_KEY="${POLYGON_API_KEY:-}" \
  --from-literal=FINNHUB_API_KEY="${FINNHUB_API_KEY:-}" \
  --from-literal=TWELVEDATA_API_KEY="${TWELVEDATA_API_KEY:-}" \
  --from-literal=COINBASE_API_KEY="${COINBASE_API_KEY:-}" \
  --from-literal=COINBASE_API_SECRET="${COINBASE_API_SECRET:-}" \
  --from-literal=COINGECKO_API_KEY="${COINGECKO_API_KEY:-}" \
  --from-literal=KRAKEN_API_KEY="${KRAKEN_API_KEY:-}" \
  --from-literal=KRAKEN_API_SECRET="${KRAKEN_API_SECRET:-}" \
  --from-literal=BENZINGA_API_KEY="${BENZINGA_API_KEY:-}" \
  --from-literal=NEWSAPI_API_KEY="${NEWSAPI_API_KEY:-}" \
  --from-literal=WORLD_NEWS_API_KEY="${WORLD_NEWS_API_KEY:-}" \
  --from-literal=FMP_API_KEY="${FMP_API_KEY:-}" \
  --from-literal=PLAID_CLIENT_ID="${PLAID_CLIENT_ID:-}" \
  --from-literal=PLAID_SECRET="${PLAID_SECRET:-}" \
  --from-literal=PLAID_ACCESS_TOKEN="${PLAID_ACCESS_TOKEN:-}" \
  --from-literal=PLAID_ENV="${PLAID_ENV:-sandbox}" \
  --from-literal=TRUELAYER_CLIENT_ID="${TRUELAYER_CLIENT_ID:-}" \
  --from-literal=TRUELAYER_CLIENT_SECRET="${TRUELAYER_CLIENT_SECRET:-}" \
  --from-literal=TINK_CLIENT_ID="${TINK_CLIENT_ID:-}" \
  --from-literal=TINK_CLIENT_SECRET="${TINK_CLIENT_SECRET:-}" \
  --from-literal=SNAPTRADE_CLIENT_ID="${SNAPTRADE_CLIENT_ID:-}" \
  --from-literal=SNAPTRADE_CONSUMER_KEY="${SNAPTRADE_CONSUMER_KEY:-}" \
  --from-literal=ALPACA_API_KEY="${ALPACA_API_KEY:-}" \
  --from-literal=ALPACA_API_SECRET="${ALPACA_API_SECRET:-}" \
  --from-literal=IBKR_FLEX_TOKEN="${IBKR_FLEX_TOKEN:-}" \
  --from-literal=IBKR_FLEX_QUERY_ID="${IBKR_FLEX_QUERY_ID:-}" \
  --from-literal=QUICKBOOKS_CLIENT_ID="${QUICKBOOKS_CLIENT_ID:-}" \
  --from-literal=QUICKBOOKS_CLIENT_SECRET="${QUICKBOOKS_CLIENT_SECRET:-}" \
  --from-literal=QUICKBOOKS_REALM_ID="${QUICKBOOKS_REALM_ID:-}" \
  --from-literal=XERO_CLIENT_ID="${XERO_CLIENT_ID:-}" \
  --from-literal=XERO_CLIENT_SECRET="${XERO_CLIENT_SECRET:-}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -k "$K8S_TMP_DIR/k8s/overlays/${K8S_OVERLAY}"
# Recycle FalkorDB only when crashlooping or stuck on an older StatefulSet revision.
falkordb_pod="$(kubectl -n drovi get pods -l app=falkordb -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "${falkordb_pod}" ]]; then
  falkordb_waiting_reason="$(kubectl -n drovi get pod "${falkordb_pod}" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
  falkordb_pod_revision="$(kubectl -n drovi get pod "${falkordb_pod}" -o jsonpath='{.metadata.labels.controller-revision-hash}' 2>/dev/null || true)"
  falkordb_update_revision="$(kubectl -n drovi get statefulset falkordb -o jsonpath='{.status.updateRevision}' 2>/dev/null || true)"
  if [[ "${falkordb_waiting_reason}" == "CrashLoopBackOff" ]] || [[ -n "${falkordb_update_revision}" && "${falkordb_pod_revision}" != "${falkordb_update_revision}" ]]; then
    kubectl -n drovi delete pod "${falkordb_pod}" --ignore-not-found --wait=false || true
  fi
fi
wait_for_statefulset_rollout falkordb 15m
wait_for_statefulset_rollout nats 10m
wait_for_deployment_rollout temporal-postgres 10m
wait_for_deployment_rollout temporal 10m
ensure_temporal_schema

kubectl -n drovi delete job drovi-db-migrate drovi-kafka-topic-bootstrap --ignore-not-found
kubectl apply -f "$K8S_TMP_DIR/k8s/base/jobs.yaml"
wait_for_job_complete drovi-db-migrate 20m

if [[ "${kafka_bootstrap_required}" == "true" ]]; then
  wait_for_job_complete drovi-kafka-topic-bootstrap "${kafka_bootstrap_timeout}"
else
  echo "Skipping wait for drovi-kafka-topic-bootstrap because KAFKA_BOOTSTRAP_REQUIRED=${kafka_bootstrap_required}" >&2
fi

for deployment in \
  drovi-intelligence-api \
  drovi-worker \
  drovi-jobs-worker \
  drovi-ingestion-worker \
  drovi-temporal-worker \
  drovi-world-normalize-worker \
  drovi-world-graph-worker \
  drovi-world-ml-worker \
  drovi-world-simulation-worker \
  drovi-world-critical-worker \
  imperium-api \
  imperium-market-worker \
  imperium-news-worker \
  imperium-brief-worker \
  imperium-alert-worker \
  imperium-risk-worker \
  imperium-business-worker \
  imperium-portfolio-worker \
  imperium-notify-worker \
  web \
  admin \
  imperium-web

do
  wait_for_deployment_rollout "${deployment}" 15m
done

kubectl -n drovi get pods
