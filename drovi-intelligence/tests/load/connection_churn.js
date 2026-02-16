import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const baseUrl = __ENV.BASE_URL || "http://localhost:8000";
const apiKey = __ENV.API_KEY || "";
const orgId = __ENV.ORG_ID || "";

if (!(apiKey && orgId)) {
  throw new Error("Set API_KEY and ORG_ID env vars before running this test.");
}

const uiosP95 = new Trend("uios_p95", true);
const docsP95 = new Trend("docs_p95", true);

export const options = {
  scenarios: {
    steady_churn: {
      executor: "ramping-vus",
      startVUs: 5,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "60s", target: 40 },
        { duration: "30s", target: 20 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    uios_p95: ["p(95)<350"],
    docs_p95: ["p(95)<350"],
  },
};

function headers() {
  return {
    headers: {
      "X-API-Key": apiKey,
    },
  };
}

export default function () {
  const uios = http.get(
    `${baseUrl}/api/v1/uios/list?organization_id=${orgId}&limit=50`,
    headers()
  );
  uiosP95.add(uios.timings.duration);
  check(uios, {
    "uios status is 200": (r) => r.status === 200,
  });

  const docs = http.get(
    `${baseUrl}/api/v1/documents?organization_id=${orgId}&limit=200`,
    headers()
  );
  docsP95.add(docs.timings.duration);
  check(docs, {
    "documents status is 200": (r) => r.status === 200,
  });

  sleep(0.3);
}
