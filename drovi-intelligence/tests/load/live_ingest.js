import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "30s",
};

const BASE = __ENV.LIVE_BASE_URL || "http://localhost:8000/api/v1";
const API_KEY = __ENV.LIVE_API_KEY || "";
const ORG_ID = __ENV.LIVE_ORG_ID || "org_demo";

export default function () {
  const headers = { "Content-Type": "application/json", "X-API-Key": API_KEY };

  const startRes = http.post(
    `${BASE}/ingest/live-session/start`,
    JSON.stringify({
      organization_id: ORG_ID,
      session_type: "meeting",
      title: "Load Test",
      consent_provided: true,
      region: "US",
    }),
    { headers },
  );
  check(startRes, { "start ok": (r) => r.status === 200 });
  const sessionId = startRes.json("session_id");

  const segRes = http.post(
    `${BASE}/ingest/live-session/${sessionId}/transcript`,
    JSON.stringify({
      organization_id: ORG_ID,
      speaker_label: "Speaker",
      start_ms: 0,
      end_ms: 5000,
      text: "We will deliver the report by Friday.",
      confidence: 0.9,
      run_intelligence: false,
    }),
    { headers },
  );
  check(segRes, { "segment ok": (r) => r.status === 200 });

  const endRes = http.post(
    `${BASE}/ingest/live-session/${sessionId}/end`,
    JSON.stringify({
      organization_id: ORG_ID,
      run_intelligence: false,
      source_type: "meeting",
    }),
    { headers },
  );
  check(endRes, { "end ok": (r) => r.status === 200 });

  sleep(1);
}
