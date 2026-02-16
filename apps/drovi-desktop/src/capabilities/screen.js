import process from "node:process";

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function parseNumber(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.round(numeric);
}

export function createScreenCapabilityRunner({
  env = process.env,
  desktopCapturer,
} = {}) {
  const enabled = parseBoolean(env.DROVI_DESKTOP_SCREEN_CAPTURE_ENABLED, true);
  const width = parseNumber(env.DROVI_DESKTOP_SCREEN_CAPTURE_WIDTH, 1600);
  const height = parseNumber(env.DROVI_DESKTOP_SCREEN_CAPTURE_HEIGHT, 1000);

  return {
    enabled,
    async execute(capability, payload) {
      if (capability !== "screen.capture") {
        const error = new Error(`Unsupported screen capability: ${capability}`);
        error.code = "screen_capability_unsupported";
        throw error;
      }
      if (!enabled) {
        const error = new Error("Screen capture capability is disabled.");
        error.code = "screen_capture_disabled";
        throw error;
      }
      if (
        !desktopCapturer ||
        typeof desktopCapturer.getSources !== "function"
      ) {
        const error = new Error(
          "desktopCapturer API is unavailable in this runtime."
        );
        error.code = "screen_capture_unavailable";
        throw error;
      }

      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Number(payload?.width) || width,
          height: Number(payload?.height) || height,
        },
      });
      const sourceId = String(payload?.sourceId || "");
      const source = sourceId
        ? sources.find((item) => item.id === sourceId)
        : sources[0];
      if (!source) {
        const error = new Error("Requested screen source was not found.");
        error.code = "screen_source_not_found";
        throw error;
      }
      const png = source.thumbnail.toPNG();
      return {
        sourceId: source.id,
        sourceName: source.name,
        mimeType: "image/png",
        bytes: png.byteLength,
        imageBase64: png.toString("base64"),
      };
    },
  };
}
