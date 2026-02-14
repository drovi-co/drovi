/* global __ENV */
import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000/api/v1";
const API_KEY = __ENV.API_KEY || "";
const ORG_ID = __ENV.ORG_ID || "";
const CONNECTION_IDS = (__ENV.CONNECTION_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ARTIFACT_IDS = (__ENV.ARTIFACT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!(API_KEY && ORG_ID)) {
  throw new Error(
    "Set API_KEY and ORG_ID env vars before running this load test."
  );
}

const dashboardTrend = new Trend("pilot_dashboard_latency_ms", true);
const driveTrend = new Trend("pilot_drive_latency_ms", true);
const evidenceTrend = new Trend("pilot_evidence_latency_ms", true);
const backfillTrend = new Trend("pilot_backfill_latency_ms", true);

function authHeaders() {
  return {
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
  };
}

function randomItem(items) {
  if (!items.length) return null;
  const idx = Math.floor(Math.random() * items.length);
  return items[idx];
}

export const options = {
  scenarios: {
    dashboard_usage: {
      executor: "ramping-vus",
      exec: "dashboardUsage",
      startVUs: 10,
      stages: [
        { duration: "1m", target: 40 },
        { duration: "2m", target: 80 },
        { duration: "1m", target: 20 },
      ],
      gracefulRampDown: "15s",
    },
    live_drive_open: {
      executor: "constant-vus",
      exec: "driveAndEvidenceUsage",
      vus: 30,
      duration: "4m",
    },
    backfill_control_plane: {
      executor: "constant-arrival-rate",
      exec: "backfillControlPlane",
      rate: 4,
      timeUnit: "1m",
      duration: "4m",
      preAllocatedVUs: 4,
      maxVUs: 10,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    pilot_dashboard_latency_ms: ["p(95)<500"],
    pilot_drive_latency_ms: ["p(95)<600"],
    pilot_evidence_latency_ms: ["p(95)<700"],
    pilot_backfill_latency_ms: ["p(95)<1200"],
  },
};

export function dashboardUsage() {
  const headers = authHeaders();
  const uios = http.get(
    `${BASE_URL}/uios/v2?organization_id=${encodeURIComponent(
      ORG_ID
    )}&limit=50&include_total=false`,
    headers
  );
  dashboardTrend.add(uios.timings.duration);
  check(uios, {
    "uios endpoint reachable": (res) => res.status === 200,
  });

  const consoleQuery = http.post(
    `${BASE_URL}/console/query`,
    JSON.stringify({
      filters: [],
      free_text: [],
      time_range: { type: "relative", value: "30d", field: "created_at" },
      visualization: "list",
      limit: 100,
    }),
    headers
  );
  dashboardTrend.add(consoleQuery.timings.duration);
  check(consoleQuery, {
    "console query reachable": (res) => res.status === 200,
  });

  sleep(0.25);
}

export function driveAndEvidenceUsage() {
  const headers = authHeaders();

  const docs = http.get(
    `${BASE_URL}/documents?organization_id=${encodeURIComponent(
      ORG_ID
    )}&limit=100&include_total=false`,
    headers
  );
  driveTrend.add(docs.timings.duration);
  check(docs, {
    "documents endpoint reachable": (res) => res.status === 200,
  });

  const artifactId = randomItem(ARTIFACT_IDS);
  if (artifactId) {
    const artifactMeta = http.get(
      `${BASE_URL}/evidence/artifacts/${encodeURIComponent(
        artifactId
      )}?organization_id=${encodeURIComponent(ORG_ID)}&include_url=false`,
      headers
    );
    evidenceTrend.add(artifactMeta.timings.duration);
    check(artifactMeta, {
      "evidence metadata reachable": (res) =>
        res.status === 200 || res.status === 404,
    });

    const artifactUrl = http.post(
      `${BASE_URL}/evidence/artifacts/${encodeURIComponent(
        artifactId
      )}/presign?organization_id=${encodeURIComponent(ORG_ID)}`,
      null,
      headers
    );
    evidenceTrend.add(artifactUrl.timings.duration);
    check(artifactUrl, {
      "evidence presign reachable": (res) =>
        res.status === 200 || res.status === 404,
    });
  }

  sleep(0.35);
}

export function backfillControlPlane() {
  if (!CONNECTION_IDS.length) {
    sleep(1);
    return;
  }

  const connectionId = randomItem(CONNECTION_IDS);
  const headers = authHeaders();
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 14);

  const res = http.post(
    `${BASE_URL}/org/connections/${encodeURIComponent(connectionId)}/backfill`,
    JSON.stringify({
      start_date: start.toISOString(),
      end_date: now.toISOString(),
      window_days: 7,
      throttle_seconds: 1,
    }),
    headers
  );
  backfillTrend.add(res.timings.duration);
  check(res, {
    "backfill request accepted": (r) =>
      r.status === 200 || r.status === 202 || r.status === 409,
  });

  sleep(0.5);
}
