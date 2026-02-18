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

kubectl apply -f "$K8S_TMP_DIR/k8s/base/namespace.yaml"

kubectl -n drovi create secret generic drovi-secrets \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=DROVI_DATABASE_URL="${DROVI_DATABASE_URL}" \
  --from-literal=REDIS_URL="${REDIS_URL}" \
  --from-literal=KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS}" \
  --from-literal=KAFKA_SASL_USERNAME="${KAFKA_SASL_USERNAME}" \
  --from-literal=KAFKA_SASL_PASSWORD="${KAFKA_SASL_PASSWORD}" \
  --from-literal=EVIDENCE_S3_BUCKET="${EVIDENCE_S3_BUCKET}" \
  --from-literal=EVIDENCE_S3_REGION="${EVIDENCE_S3_REGION}" \
  --from-literal=EVIDENCE_S3_KMS_KEY_ID="${EVIDENCE_S3_KMS_KEY_ID}" \
  --from-literal=TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS}" \
  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  --from-literal=TOGETHER_API_KEY="${TOGETHER_API_KEY:-}" \
  --from-literal=DROVI_INTERNAL_SERVICE_TOKEN="${DROVI_INTERNAL_SERVICE_TOKEN}" \
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
# StatefulSet rolling updates can stall if the existing pod is crashlooping on an old template.
kubectl -n drovi delete pod -l app=falkordb --ignore-not-found --wait=false || true
wait_for_statefulset_rollout falkordb 15m
wait_for_statefulset_rollout nats 10m

kubectl -n drovi delete job drovi-db-migrate drovi-kafka-topic-bootstrap --ignore-not-found
kubectl apply -f "$K8S_TMP_DIR/k8s/base/jobs.yaml"
wait_for_job_complete drovi-db-migrate 20m

if [[ "${kafka_bootstrap_required}" == "true" ]]; then
  wait_for_job_complete drovi-kafka-topic-bootstrap "${kafka_bootstrap_timeout}"
else
  if ! wait_for_job_complete drovi-kafka-topic-bootstrap "${kafka_bootstrap_timeout}"; then
    echo "Continuing deployment because KAFKA_BOOTSTRAP_REQUIRED=${kafka_bootstrap_required}" >&2
  fi
fi

for deployment in \
  drovi-intelligence-api \
  drovi-worker \
  drovi-jobs-worker \
  drovi-ingestion-worker \
  drovi-temporal-worker \
  imperium-api \
  web \
  admin \
  imperium-web

do
  wait_for_deployment_rollout "${deployment}" 15m
done

kubectl -n drovi get pods
