const queueList = document.getElementById("queue-list");
const auditList = document.getElementById("audit-list");
const bridgeStatus = document.getElementById("bridge-status");

function statusChipClass(status) {
  if (status === "running") {
    return "status-running";
  }
  if (status === "disabled") {
    return "status-disabled";
  }
  if (status === "stopped") {
    return "status-stopped";
  }
  return "status-starting";
}

async function decide(requestId, decision) {
  await window.droviDesktop.approveRequest({
    requestId,
    decision,
    reason: decision === "approved" ? "operator_approved" : "operator_denied",
  });
}

function renderQueue(state) {
  const pending = Array.isArray(state.pendingRequests)
    ? state.pendingRequests
    : [];
  if (pending.length === 0) {
    queueList.innerHTML = `<div class="empty">No pending approvals.</div>`;
    return;
  }
  queueList.innerHTML = "";
  for (const request of pending) {
    const card = document.createElement("article");
    card.className = "request-card";
    const createdAt = request.createdAt
      ? new Date(request.createdAt).toLocaleTimeString()
      : "unknown";
    const status = request.status || "pending";
    card.innerHTML = `
      <header>
        <span class="capability">${request.capability || "unknown.capability"}</span>
        <span>${createdAt}</span>
      </header>
      <div class="request-body">${request.payloadPreview || ""}</div>
      <div class="request-body">Status: ${status}</div>
      <div class="request-actions">
        <button class="btn btn-approve" data-id="${request.requestId}" data-decision="approved">Approve</button>
        <button class="btn btn-deny" data-id="${request.requestId}" data-decision="denied">Deny</button>
      </div>
    `;
    for (const button of card.querySelectorAll("button[data-id]")) {
      button.addEventListener("click", async () => {
        await decide(button.dataset.id, button.dataset.decision);
      });
    }
    queueList.appendChild(card);
  }
}

function renderAudit(state) {
  const records = Array.isArray(state.recentAudit) ? state.recentAudit : [];
  if (records.length === 0) {
    auditList.innerHTML = `<div class="empty">No audit events yet.</div>`;
    return;
  }
  auditList.innerHTML = "";
  for (const event of records) {
    const item = document.createElement("article");
    item.className = "audit-item";
    const timestamp = event.ts
      ? new Date(event.ts).toLocaleTimeString()
      : "unknown";
    item.innerHTML = `
      <header>
        <strong>${event.type || "event"}</strong>
        <span>${timestamp}</span>
      </header>
      <div class="audit-body">${JSON.stringify(event, null, 2)}</div>
    `;
    auditList.appendChild(item);
  }
}

function renderState(state) {
  bridgeStatus.textContent = `Bridge ${String(state.bridgeStatus || "starting").toUpperCase()}`;
  bridgeStatus.className = `status-chip ${statusChipClass(state.bridgeStatus)}`;
  renderQueue(state);
  renderAudit(state);
}

async function init() {
  const state = await window.droviDesktop.getState();
  renderState(state);
  window.droviDesktop.onState((nextState) => {
    renderState(nextState);
  });
}

init().catch((error) => {
  console.error("Failed to initialize desktop renderer", error);
});
