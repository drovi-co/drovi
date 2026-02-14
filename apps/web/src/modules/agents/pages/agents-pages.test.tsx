import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsCatalogPage } from "./agents-catalog-page";
import { AgentsInboxPage } from "./agents-inbox-page";
import { AgentsRunsPage } from "./agents-runs-page";
import { AgentsStudioPage } from "./agents-studio-page";
import { AgentsWorkforcesPage } from "./agents-workforces-page";

const { agentApiMock } = vi.hoisted(() => ({
  agentApiMock: {
    listDeployments: vi.fn(),
    listRuns: vi.fn(),
    replayRun: vi.fn(),
    createRun: vi.fn(),
    pauseRun: vi.fn(),
    resumeRun: vi.fn(),
    cancelRun: vi.fn(),
    killRun: vi.fn(),
    listRoles: vi.fn(),
    listProfiles: vi.fn(),
    listPlaybooks: vi.fn(),
    createRole: vi.fn(),
    createProfile: vi.fn(),
    createPlaybook: vi.fn(),
    lintPlaybook: vi.fn(),
    createDeployment: vi.fn(),
    listCatalog: vi.fn(),
    listIdentities: vi.fn(),
    listInboxThreads: vi.fn(),
    listThreadMessages: vi.fn(),
    replyToThread: vi.fn(),
    listApprovals: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
    listReceipts: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  agentsAPI: agentApiMock,
  getApiBase: () => "http://localhost:8000",
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({
      data: {
        id: "org_test",
        name: "Drovi",
      },
      isPending: false,
    }),
  },
}));

vi.mock("@/modules/agents/hooks/use-agent-run-stream", () => ({
  useAgentRunStream: vi.fn(),
}));

function renderWithProviders(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  agentApiMock.listDeployments.mockResolvedValue([
    {
      id: "agdep_1",
      organization_id: "org_test",
      role_id: "agrole_1",
      profile_id: "agprof_1",
      playbook_id: "agplay_1",
      version: 1,
      status: "active",
      rollout_strategy: {},
      snapshot_hash: "hash_1",
      published_at: "2026-02-13T00:00:00Z",
      created_by_user_id: "user_1",
      created_at: "2026-02-13T00:00:00Z",
      updated_at: "2026-02-13T00:00:00Z",
    },
  ]);
  agentApiMock.listRuns.mockResolvedValue([]);
  agentApiMock.replayRun.mockResolvedValue({ run: undefined, steps: [] });
  agentApiMock.createRun.mockResolvedValue({
    id: "agrun_1",
    organization_id: "org_test",
    deployment_id: "agdep_1",
    trigger_id: null,
    status: "accepted",
    initiated_by: "user_1",
    started_at: null,
    completed_at: null,
    failure_reason: null,
    metadata: {
      mission: "Seed mission",
    },
    created_at: "2026-02-13T00:00:00Z",
    updated_at: "2026-02-13T00:00:00Z",
  });
  agentApiMock.pauseRun.mockResolvedValue({
    run_id: "agrun_1",
    status: "waiting_approval",
    workflow_id: "agent-run:agrun_1",
    accepted: true,
  });
  agentApiMock.resumeRun.mockResolvedValue({
    run_id: "agrun_1",
    status: "running",
    workflow_id: "agent-run:agrun_1",
    accepted: true,
  });
  agentApiMock.cancelRun.mockResolvedValue({
    run_id: "agrun_1",
    status: "cancelled",
    workflow_id: "agent-run:agrun_1",
    accepted: true,
  });
  agentApiMock.killRun.mockResolvedValue({
    run_id: "agrun_1",
    status: "failed",
    workflow_id: "agent-run:agrun_1",
    accepted: true,
  });

  agentApiMock.listRoles.mockResolvedValue([]);
  agentApiMock.listProfiles.mockResolvedValue([]);
  agentApiMock.listPlaybooks.mockResolvedValue([]);
  agentApiMock.createRole.mockResolvedValue({
    id: "agrole_1",
    organization_id: "org_test",
    role_key: "sales_sdr",
    name: "Sales SDR Agent",
    domain: "sales",
    description: "desc",
    status: "active",
    metadata: {},
    created_by_user_id: null,
    created_at: "2026-02-13T00:00:00Z",
    updated_at: "2026-02-13T00:00:00Z",
  });
  agentApiMock.createProfile.mockResolvedValue({
    id: "agprof_1",
    organization_id: "org_test",
    role_id: "agrole_1",
    name: "Profile",
    autonomy_tier: "L2",
    permission_scope: {},
    execution_policy: {},
    memory_scope: {},
    metadata: {},
    created_at: "2026-02-13T00:00:00Z",
    updated_at: "2026-02-13T00:00:00Z",
  });
  agentApiMock.createPlaybook.mockResolvedValue({
    id: "agplay_1",
    organization_id: "org_test",
    role_id: "agrole_1",
    version: 1,
    name: "Playbook",
    objective: "Objective statement",
    constraints: {},
    sop: {},
    success_criteria: {},
    escalation_policy: {},
    dsl: {},
    status: "draft",
    created_at: "2026-02-13T00:00:00Z",
    updated_at: "2026-02-13T00:00:00Z",
  });
  agentApiMock.lintPlaybook.mockResolvedValue({
    valid: true,
    errors: [],
    warnings: [],
  });
  agentApiMock.createDeployment.mockResolvedValue({
    id: "agdep_1",
    organization_id: "org_test",
    role_id: "agrole_1",
    profile_id: "agprof_1",
    playbook_id: "agplay_1",
    version: 1,
    status: "draft",
    rollout_strategy: {},
    snapshot_hash: "hash_1",
    published_at: null,
    created_by_user_id: null,
    created_at: "2026-02-13T00:00:00Z",
    updated_at: "2026-02-13T00:00:00Z",
  });

  agentApiMock.listCatalog.mockResolvedValue([
    {
      role_id: "agrole_1",
      role_name: "Sales SDR Agent",
      domain: "sales",
      deployment_id: "agdep_1",
      deployment_version: 1,
      deployment_status: "active",
      playbook_name: "Outbound Mission Playbook",
      updated_at: "2026-02-13T00:00:00Z",
    },
  ]);

  agentApiMock.listIdentities.mockResolvedValue([
    {
      id: "agid_1",
      organization_id: "org_test",
      display_name: "Sales Agent",
      identity_mode: "virtual_persona",
      deployment_id: "agdep_1",
      role_id: "agrole_1",
      profile_id: "agprof_1",
      email_address: "sales.agent@agents.drovi.co",
      status: "active",
      metadata: {},
      created_at: "2026-02-13T00:00:00Z",
      updated_at: "2026-02-13T00:00:00Z",
    },
  ]);
  agentApiMock.listInboxThreads.mockResolvedValue([
    {
      id: "agth_1",
      organization_id: "org_test",
      identity_id: "agid_1",
      channel_type: "email",
      external_thread_id: "mail-thread-1",
      status: "open",
      subject: "Need renewal risk summary",
      continuity_key: null,
      assigned_run_id: null,
      last_message_at: "2026-02-13T00:00:00Z",
      metadata: {},
      created_at: "2026-02-13T00:00:00Z",
      updated_at: "2026-02-13T00:00:00Z",
    },
  ]);
  agentApiMock.listThreadMessages.mockResolvedValue([
    {
      id: "agmsg_1",
      organization_id: "org_test",
      thread_id: "agth_1",
      identity_id: "agid_1",
      channel_binding_id: null,
      direction: "inbound",
      event_type: "message",
      sender: "partner@client.com",
      recipients: ["sales.agent@agents.drovi.co"],
      subject: "Need renewal risk summary",
      body_text: "Can you summarize all renewal risks by tomorrow?",
      body_html: null,
      raw_payload: {},
      parsed_task: {},
      run_id: null,
      approval_request_id: null,
      policy_status: null,
      message_status: "received",
      occurred_at: "2026-02-13T00:00:00Z",
      created_at: "2026-02-13T00:00:00Z",
    },
  ]);
  agentApiMock.replyToThread.mockResolvedValue({
    id: "agmsg_2",
    organization_id: "org_test",
    thread_id: "agth_1",
    identity_id: "agid_1",
    channel_binding_id: null,
    direction: "outbound",
    event_type: "message",
    sender: "sales.agent@agents.drovi.co",
    recipients: ["partner@client.com"],
    subject: "RE: Need renewal risk summary",
    body_text: "Here is a draft summary.",
    body_html: null,
    raw_payload: {},
    parsed_task: {},
    run_id: "agrun_1",
    approval_request_id: null,
    policy_status: "allow",
    message_status: "sent",
    occurred_at: "2026-02-13T00:01:00Z",
    created_at: "2026-02-13T00:01:00Z",
  });
  agentApiMock.listApprovals.mockResolvedValue([
    {
      id: "agapr_1",
      organization_id: "org_test",
      run_id: "agrun_1",
      deployment_id: "agdep_1",
      tool_id: "email.send",
      action_tier: "external_commit",
      reason: "Need approval",
      status: "pending",
      requested_by: "agent",
      requested_at: "2026-02-13T00:00:00Z",
      sla_due_at: "2026-02-13T01:00:00Z",
      escalation_path: {},
      approver_id: null,
      approval_reason: null,
      decided_at: null,
      metadata: {},
    },
  ]);
  agentApiMock.approve.mockResolvedValue({
    id: "agapr_1",
    organization_id: "org_test",
    run_id: "agrun_1",
    deployment_id: "agdep_1",
    tool_id: "email.send",
    action_tier: "external_commit",
    reason: "Need approval",
    status: "approved",
    requested_by: "agent",
    requested_at: "2026-02-13T00:00:00Z",
    sla_due_at: "2026-02-13T01:00:00Z",
    escalation_path: {},
    approver_id: "user_1",
    approval_reason: "ok",
    decided_at: "2026-02-13T00:02:00Z",
    metadata: {},
  });
  agentApiMock.deny.mockResolvedValue({
    id: "agapr_1",
    organization_id: "org_test",
    run_id: "agrun_1",
    deployment_id: "agdep_1",
    tool_id: "email.send",
    action_tier: "external_commit",
    reason: "Need approval",
    status: "denied",
    requested_by: "agent",
    requested_at: "2026-02-13T00:00:00Z",
    sla_due_at: "2026-02-13T01:00:00Z",
    escalation_path: {},
    approver_id: "user_1",
    approval_reason: "no",
    decided_at: "2026-02-13T00:02:00Z",
    metadata: {},
  });
  agentApiMock.listReceipts.mockResolvedValue([]);
});

describe("AgentOS pages", () => {
  it("dispatches a mission from the workforces page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentsWorkforcesPage />);

    expect(await screen.findByText("Deploy AI coworkers")).toBeTruthy();

    await user.type(
      screen.getByLabelText("Mission prompt"),
      "Draft renewal risk summary for enterprise accounts"
    );
    await user.click(screen.getByRole("button", { name: "Dispatch mission" }));

    await waitFor(() => {
      expect(agentApiMock.createRun).toHaveBeenCalledTimes(1);
      expect(agentApiMock.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: "org_test",
          deployment_id: "agdep_1",
        })
      );
    });
  });

  it("creates a role from the studio page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentsStudioPage />);

    expect(
      await screen.findByText("Design role, profile, playbook, deployment")
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save role" }));

    await waitFor(() => {
      expect(agentApiMock.createRole).toHaveBeenCalledTimes(1);
      expect(agentApiMock.createRole).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: "org_test" })
      );
    });
  });

  it("loads run diagnostics and replay", async () => {
    agentApiMock.listRuns.mockResolvedValueOnce([
      {
        id: "agrun_9",
        organization_id: "org_test",
        deployment_id: "agdep_1",
        trigger_id: null,
        status: "running",
        initiated_by: "user_1",
        started_at: "2026-02-13T00:00:00Z",
        completed_at: null,
        failure_reason: null,
        metadata: {},
        created_at: "2026-02-13T00:00:00Z",
        updated_at: "2026-02-13T00:00:00Z",
      },
    ]);
    agentApiMock.replayRun.mockResolvedValueOnce({
      run: {
        id: "agrun_9",
        organization_id: "org_test",
        deployment_id: "agdep_1",
        trigger_id: null,
        status: "running",
        initiated_by: "user_1",
        started_at: "2026-02-13T00:00:00Z",
        completed_at: null,
        failure_reason: null,
        metadata: {},
        created_at: "2026-02-13T00:00:00Z",
        updated_at: "2026-02-13T00:00:00Z",
      },
      steps: [
        {
          id: "step_1",
          run_id: "agrun_9",
          organization_id: "org_test",
          step_index: 1,
          step_type: "retrieve_context",
          status: "completed",
          input_payload: {},
          output_payload: {},
          evidence_refs: { evidence_count: 2 },
          started_at: "2026-02-13T00:00:01Z",
          completed_at: "2026-02-13T00:00:03Z",
          created_at: "2026-02-13T00:00:01Z",
        },
      ],
    });

    const user = userEvent.setup();
    renderWithProviders(<AgentsRunsPage />);

    expect(
      await screen.findByText("Trace, replay, and control run lifecycles")
    ).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /agrun_9/i }));

    await waitFor(() => {
      expect(agentApiMock.replayRun).toHaveBeenCalledWith("agrun_9");
    });

    expect(await screen.findByText("retrieve_context")).toBeTruthy();
  });

  it("installs a starter pack from catalog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentsCatalogPage />);

    expect(
      await screen.findByText("Install workforce starter packs")
    ).toBeTruthy();

    const installButtons = await screen.findAllByRole("button", {
      name: "Install to Agent Studio",
    });
    await user.click(installButtons[0]);

    await waitFor(() => {
      expect(agentApiMock.createRole).toHaveBeenCalled();
      expect(agentApiMock.createProfile).toHaveBeenCalled();
      expect(agentApiMock.createPlaybook).toHaveBeenCalled();
      expect(agentApiMock.createDeployment).toHaveBeenCalled();
    });
  });

  it("replies to a thread and approves an action in inbox", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentsInboxPage />);

    expect(await screen.findByText("Channel queue and approvals")).toBeTruthy();
    expect(
      (await screen.findAllByText("Need renewal risk summary")).length
    ).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Reply"), "Drafting summary now.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => {
      expect(agentApiMock.replyToThread).toHaveBeenCalledWith(
        "agth_1",
        expect.objectContaining({ organization_id: "org_test" })
      );
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(agentApiMock.approve).toHaveBeenCalledWith(
        "agapr_1",
        expect.objectContaining({ organization_id: "org_test" })
      );
    });
  });

  it("executes a full create-deploy-chat-approve workflow", async () => {
    const user = userEvent.setup();

    agentApiMock.listRoles.mockResolvedValue([
      {
        id: "agrole_seed",
        organization_id: "org_test",
        role_key: "sales.seed",
        name: "Seed Role",
        domain: "sales",
        description: "seed",
        status: "active",
        metadata: {},
        created_by_user_id: null,
        created_at: "2026-02-13T00:00:00Z",
        updated_at: "2026-02-13T00:00:00Z",
      },
    ]);
    agentApiMock.listProfiles.mockResolvedValue([
      {
        id: "agprof_seed",
        organization_id: "org_test",
        role_id: "agrole_seed",
        name: "Seed Profile",
        autonomy_tier: "L2",
        permission_scope: {},
        execution_policy: {},
        memory_scope: {},
        metadata: {},
        created_at: "2026-02-13T00:00:00Z",
        updated_at: "2026-02-13T00:00:00Z",
      },
    ]);
    agentApiMock.listPlaybooks.mockResolvedValue([
      {
        id: "agplay_seed",
        organization_id: "org_test",
        role_id: "agrole_seed",
        version: 1,
        name: "Seed Playbook",
        objective: "Seed objective statement",
        constraints: {},
        sop: {},
        success_criteria: {},
        escalation_policy: {},
        dsl: {},
        status: "draft",
        created_at: "2026-02-13T00:00:00Z",
        updated_at: "2026-02-13T00:00:00Z",
      },
    ]);

    renderWithProviders(<AgentsStudioPage />);
    await user.click(await screen.findByRole("button", { name: "Save role" }));
    await user.click(
      await screen.findByRole("button", { name: "Save profile" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Save playbook" })
    );
    await user.click(
      await screen.findByRole("button", { name: "Save deployment" })
    );

    renderWithProviders(<AgentsWorkforcesPage />);
    await user.type(
      await screen.findByLabelText("Mission prompt"),
      "Prepare outbound renewal risk summary."
    );
    await user.click(
      await screen.findByRole("button", { name: "Dispatch mission" })
    );

    renderWithProviders(<AgentsInboxPage />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(agentApiMock.createRole).toHaveBeenCalled();
      expect(agentApiMock.createProfile).toHaveBeenCalled();
      expect(agentApiMock.createPlaybook).toHaveBeenCalled();
      expect(agentApiMock.createDeployment).toHaveBeenCalled();
      expect(agentApiMock.createRun).toHaveBeenCalled();
      expect(agentApiMock.approve).toHaveBeenCalled();
    });
  });

  it("exposes accessible headings and labelled controls on core screens", async () => {
    renderWithProviders(<AgentsInboxPage />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Channel queue and approvals",
      })
    ).toBeTruthy();
    expect(await screen.findByLabelText("Reply")).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Send reply" })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 3, name: "Direct command center" })
    ).toBeTruthy();
  });
});
