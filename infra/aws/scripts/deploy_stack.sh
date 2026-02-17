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

kubectl -n drovi delete job drovi-db-migrate drovi-kafka-topic-bootstrap --ignore-not-found
kubectl apply -f "$K8S_TMP_DIR/k8s/base/jobs.yaml"
kubectl -n drovi wait --for=condition=complete job/drovi-db-migrate --timeout=20m
kubectl -n drovi wait --for=condition=complete job/drovi-kafka-topic-bootstrap --timeout=20m

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
  kubectl -n drovi rollout status "deployment/${deployment}" --timeout=15m
done

kubectl -n drovi get pods
