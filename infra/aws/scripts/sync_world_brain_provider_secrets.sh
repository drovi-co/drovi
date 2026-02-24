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

to_k8s_key() {
  local secret_name="$1"
  case "${secret_name}" in
    worldnewsapi_api_key)
      echo "WORLD_NEWS_API_KEY"
      ;;
    *)
      echo "${secret_name}" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g'
      ;;
  esac
}

extract_secret_value() {
  local secret_string="$1"
  python3 - "$secret_string" <<'PY'
import json
import sys

raw = sys.argv[1]
if not raw:
    print("")
    raise SystemExit(0)
try:
    data = json.loads(raw)
except Exception:
    print(raw)
    raise SystemExit(0)

if isinstance(data, dict):
    for key in ("api_key", "token", "value", "secret", "password"):
        value = data.get(key)
        if isinstance(value, str) and value:
            print(value)
            raise SystemExit(0)

print(raw if isinstance(raw, str) else "")
PY
}

require_cmd aws
require_cmd kubectl
require_cmd python3

require_var AWS_REGION
require_var K8S_NAMESPACE
require_var K8S_SECRET_NAME
require_var WORLD_BRAIN_SECRET_PREFIX
require_var WORLD_BRAIN_PROVIDER_SECRET_NAMES

IFS=',' read -r -a provider_secret_names <<<"${WORLD_BRAIN_PROVIDER_SECRET_NAMES}"
if [[ "${#provider_secret_names[@]}" -eq 0 ]]; then
  echo "No provider secret names configured in WORLD_BRAIN_PROVIDER_SECRET_NAMES." >&2
  exit 1
fi

kubectl -n "${K8S_NAMESPACE}" get secret "${K8S_SECRET_NAME}" >/dev/null

for provider_secret in "${provider_secret_names[@]}"; do
  secret_name="$(echo "${provider_secret}" | xargs)"
  if [[ -z "${secret_name}" ]]; then
    continue
  fi
  secret_id="${WORLD_BRAIN_SECRET_PREFIX}/${secret_name}"
  raw_secret_string="$(
    aws secretsmanager get-secret-value \
      --region "${AWS_REGION}" \
      --secret-id "${secret_id}" \
      --query SecretString \
      --output text
  )"
  if [[ -z "${raw_secret_string}" || "${raw_secret_string}" == "None" ]]; then
    echo "Skipping ${secret_id}: empty SecretString." >&2
    continue
  fi

  secret_value="$(extract_secret_value "${raw_secret_string}")"
  if [[ -z "${secret_value}" ]]; then
    echo "Skipping ${secret_id}: unable to extract value." >&2
    continue
  fi

  k8s_key="$(to_k8s_key "${secret_name}")"
  encoded_value="$(printf '%s' "${secret_value}" | base64 | tr -d '\n')"

  kubectl -n "${K8S_NAMESPACE}" patch secret "${K8S_SECRET_NAME}" \
    --type merge \
    -p "{\"data\":{\"${k8s_key}\":\"${encoded_value}\"}}"

  echo "Patched ${K8S_NAMESPACE}/${K8S_SECRET_NAME} key ${k8s_key} from ${secret_id}"
done
