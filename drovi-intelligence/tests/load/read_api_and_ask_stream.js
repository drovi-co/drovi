import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const API_KEY = __ENV.API_KEY || "";
const ORG_ID = __ENV.ORG_ID || "";

if (!API_KEY || !ORG_ID) {
  throw new Error("Set API_KEY and ORG_ID before running read_api_and_ask_stream.js");
}

export const options = {
  scenarios: {
    steady_reads: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || "5"),
      duration: __ENV.DURATION || "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    read_brief_p95: ["p(95)<400"],
    read_uios_p95: ["p(95)<600"],
    ask_truth_stream_p95: ["p(95)<1200"],
  },
};

const briefP95 = new Trend("read_brief_p95", true);
const uiosP95 = new Trend("read_uios_p95", true);
const askTruthStreamP95 = new Trend("ask_truth_stream_p95", true);

const headers = {
  "X-API-Key": API_KEY,
  "Content-Type": "application/json",
};

export default function () {
  const brief = http.get(
    `${BASE_URL}/api/v1/brief?organization_id=${encodeURIComponent(ORG_ID)}&period=last_7_days`,
    { headers }
  );
  briefP95.add(brief.timings.duration);
  check(brief, {
    "brief status is 200": (res) => res.status === 200,
  });

  const uios = http.get(
    `${BASE_URL}/api/v1/uios?organization_id=${encodeURIComponent(ORG_ID)}&limit=50`,
    { headers }
  );
  uiosP95.add(uios.timings.duration);
  check(uios, {
    "uios status is 200": (res) => res.status === 200,
  });

  const ask = http.post(
    `${BASE_URL}/api/v1/ask/stream`,
    JSON.stringify({
      organization_id: ORG_ID,
      query: "What changed in our commitments this week?",
      mode: "truth",
    }),
    {
      headers,
      timeout: "30s",
    }
  );
  askTruthStreamP95.add(ask.timings.duration);
  check(ask, {
    "ask stream status is 200": (res) => res.status === 200,
    "ask stream returns truth event": (res) => res.body.includes("event: truth"),
  });

  sleep(1);
}
