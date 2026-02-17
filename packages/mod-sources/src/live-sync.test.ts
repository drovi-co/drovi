import { describe, expect, it } from "vitest";
import {
  countActiveSourceSyncs,
  groupSourceConnections,
  mergeSourceSyncEvent,
} from "./live-sync";

describe("mergeSourceSyncEvent", () => {
  it("updates status, progress, records and error from live event", () => {
    const patch = mergeSourceSyncEvent(
      {
        id: "con_1",
        provider: "gmail",
        status: "ready",
        progress: null,
        messages_synced: 12,
        last_error: null,
      },
      {
        connection_id: "con_1",
        event_type: "progress",
        status: "syncing",
        progress: 42,
        records_synced: 128,
        error: null,
      }
    );

    expect(patch).toMatchObject({
      status: "syncing",
      progress: 42,
      messages_synced: 128,
      live_status: "progress",
    });
  });
});

describe("countActiveSourceSyncs", () => {
  it("counts live and in-progress sync states", () => {
    const count = countActiveSourceSyncs(
      [
        {
          id: "con_1",
          provider: "gmail",
          status: "ready",
          progress: null,
          messages_synced: 0,
          last_error: null,
        },
        {
          id: "con_2",
          provider: "slack",
          status: "syncing",
          progress: 10,
          messages_synced: 0,
          last_error: null,
        },
      ],
      {
        con_1: {
          connection_id: "con_1",
          event_type: "started",
        },
      }
    );

    expect(count).toBe(2);
  });
});

describe("groupSourceConnections", () => {
  it("groups known providers into stable categories", () => {
    const grouped = groupSourceConnections([
      { id: "a", provider: "gmail" },
      { id: "b", provider: "slack" },
      { id: "c", provider: "google_calendar" },
      { id: "d", provider: "github" },
    ]);

    expect(grouped.email).toHaveLength(1);
    expect(grouped.messaging).toHaveLength(1);
    expect(grouped.calendar).toHaveLength(1);
    expect(grouped.other).toHaveLength(1);
  });
});
