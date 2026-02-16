import crypto from "node:crypto";

export function createPermissionBroker({ onPermissionRequest }) {
  return {
    async requestApproval({ capability, payload }) {
      if (typeof onPermissionRequest !== "function") {
        return { decision: "approved", reason: "auto_approved_no_broker" };
      }
      const requestId = `apr_${crypto.randomUUID()}`;
      const preview = buildPayloadPreview(capability, payload);
      return await onPermissionRequest({
        requestId,
        capability,
        payloadPreview: preview,
      });
    },
  };
}

function buildPayloadPreview(capability, payload) {
  const raw = JSON.stringify({ capability, payload });
  if (raw.length <= 280) {
    return raw;
  }
  return `${raw.slice(0, 280)}...`;
}
