import { describe, expect, it } from "vitest";

import { createScreenCapabilityRunner } from "../src/capabilities/screen.js";

describe("screen capability runner", () => {
  it("captures from desktopCapturer source", async () => {
    const runner = createScreenCapabilityRunner({
      env: {
        DROVI_DESKTOP_SCREEN_CAPTURE_ENABLED: "true",
      },
      desktopCapturer: {
        getSources: async () => [
          {
            id: "screen:1:0",
            name: "Display 1",
            thumbnail: {
              toPNG() {
                return Buffer.from("png-binary");
              },
            },
          },
        ],
      },
    });
    const result = await runner.execute("screen.capture", {});
    expect(result.sourceId).toBe("screen:1:0");
    expect(result.mimeType).toBe("image/png");
    expect(result.imageBase64).toBe(
      Buffer.from("png-binary").toString("base64")
    );
  });

  it("rejects capture when disabled", async () => {
    const runner = createScreenCapabilityRunner({
      env: {
        DROVI_DESKTOP_SCREEN_CAPTURE_ENABLED: "false",
      },
      desktopCapturer: {
        getSources: async () => [],
      },
    });
    await expect(runner.execute("screen.capture", {})).rejects.toMatchObject({
      code: "screen_capture_disabled",
    });
  });
});
