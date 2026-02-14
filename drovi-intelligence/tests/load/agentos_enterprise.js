/* global __ENV */
import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000/api/v1";
const API_KEY = __ENV.API_KEY || "";
const ORG_ID = __ENV.ORG_ID || "";
const DEPLOYMENT_IDS = (__ENV.DEPLOYMENT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!(API_KEY && ORG_ID)) {
  throw new Error("Set API_KEY and ORG_ID before running AgentOS load tests.");
}

const runDispatchTrend = new Trend("agentos_run_dispatch_latency_ms", true);
const runListTrend = new Trend("agentos_run_list_latency_ms", true);
const approvalTrend = new Trend("agentos_approval_list_latency_ms", true);
const qualityTrend = new Trend("agentos_quality_latency_ms", true);

function authHeaders() {
  return {
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
  };
}

function pickDeploymentId() {
  if (!DEPLOYMENT_IDS.length) {
    return null;
  }
  const index = Math.floor(Math.random() * DEPLOYMENT_IDS.length);
  return DEPLOYMENT_IDS[index];
}

export const options = {
  scenarios: {
    run_dispatch: {
      executor: "constant-arrival-rate",
      exec: "dispatchRuns",
      rate: 30,
      timeUnit: "1m",
      duration: "5m",
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
    run_observability: {
      executor: "constant-vus",
      exec: "observeRuns",
      vus: 40,
      duration: "5m",
    },
    governance_quality: {
      executor: "constant-vus",
      exec: "governanceAndQuality",
      vus: 20,
      duration: "5m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    agentos_run_dispatch_latency_ms: ["p(95)<1800"],
    agentos_run_list_latency_ms: ["p(95)<600"],
    agentos_approval_list_latency_ms: ["p(95)<700"],
    agentos_quality_latency_ms: ["p(95)<900"],
  },
};

export function dispatchRuns() {
  const deploymentId = pickDeploymentId();
  if (!deploymentId) {
    sleep(1);
    return;
  }

  const response = http.post(
    `${BASE_URL}/agents/runs`,
    JSON.stringify({
      organization_id: ORG_ID,
      deployment_id: deploymentId,
      trigger_type: "manual",
      objective: "Enterprise load-test validation run",
      context: {
        source: "k6.agentos_enterprise",
        evidence_required: true,
      },
    }),
    authHeaders()
  );
  runDispatchTrend.add(response.timings.duration);
  check(response, {
    "run dispatch accepted": (res) =>
      res.status === 200 || res.status === 201 || res.status === 409,
  });
  sleep(0.2);
}

export function observeRuns() {
  const response = http.get(
    `${BASE_URL}/agents/runs?organization_id=${encodeURIComponent(ORG_ID)}&limit=100`,
    authHeaders()
  );
  runListTrend.add(response.timings.duration);
  check(response, {
    "runs list reachable": (res) => res.status === 200,
  });
  sleep(0.25);
}

export function governanceAndQuality() {
  const approvals = http.get(
    `${BASE_URL}/agents/approvals?organization_id=${encodeURIComponent(ORG_ID)}&status=pending`,
    authHeaders()
  );
  approvalTrend.add(approvals.timings.duration);
  check(approvals, {
    "approvals list reachable": (res) => res.status === 200,
  });

  const quality = http.get(
    `${BASE_URL}/agents/quality/trends?organization_id=${encodeURIComponent(ORG_ID)}&days=30`,
    authHeaders()
  );
  qualityTrend.add(quality.timings.duration);
  check(quality, {
    "quality trends reachable": (res) => res.status === 200,
  });

  sleep(0.3);
}
