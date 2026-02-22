import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n";

const routeState = new Map<string, { params: Record<string, string>; search: Record<string, string> }>();
const navigateSpy = vi.fn();

const hooksMock = {
  useUIO: vi.fn(),
  useDecisionSupersessionChain: vi.fn(),
  useDismissUIO: vi.fn(),
  useVerifyUIO: vi.fn(),
  useMarkCompleteUIO: vi.fn(),
  useSnoozeUIO: vi.fn(),
  useArchiveUIO: vi.fn(),
  useCorrectUIO: vi.fn(),
  useUpdateTaskPriorityUIO: vi.fn(),
  useUpdateTaskStatusUIO: vi.fn(),
  useUpdateUIO: vi.fn(),
};

const authClientMock = {
  useActiveOrganization: vi.fn(),
  useSession: vi.fn(),
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options: Record<string, unknown>) => ({
    ...options,
    options,
    useSearch: () => routeState.get(path)?.search ?? {},
  }),
  useNavigate: () => navigateSpy,
  useParams: (options?: { from?: string }) =>
    routeState.get(options?.from ?? "")?.params ?? {},
}));

vi.mock("@/hooks/use-uio", () => hooksMock);
vi.mock("@/lib/auth-client", () => ({ authClient: authClientMock }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/unified-object/team-discussion", () => ({
  TeamDiscussion: () => <div data-testid="team-discussion" />,
}));
vi.mock("@/components/evidence", () => ({
  EvidenceRail: () => <div data-testid="evidence-rail" />,
}));
vi.mock("@/components/evidence/source-viewer-sheet", () => ({
  SourceViewerSheet: () => null,
}));
vi.mock("@/components/unified-object/evidence-chain", () => ({
  EvidenceChain: () => <div data-testid="evidence-chain" />,
}));
vi.mock("@/components/unified-object/timeline", () => ({
  Timeline: () => <div data-testid="timeline" />,
}));

function renderWithProviders(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <I18nProvider initialLocale="en">
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </I18nProvider>
  );
}

function setRoute(
  path: string,
  params: Record<string, string>,
  search: Record<string, string> = {}
) {
  routeState.set(path, { params, search });
}

beforeEach(() => {
  navigateSpy.mockReset();
  routeState.clear();
  Object.values(hooksMock).forEach((mock) => mock.mockReset());
  authClientMock.useActiveOrganization.mockReset();
  authClientMock.useSession.mockReset();

  authClientMock.useActiveOrganization.mockReturnValue({
    data: { id: "org_test" },
    isPending: false,
  });
  authClientMock.useSession.mockReturnValue({
    data: {
      user: {
        id: "user_1",
        email: "user@example.com",
        name: "Test User",
      },
    },
  });
});

describe("Detail route mutation wiring", () => {
  it("wires decision verify action to verify mutation", async () => {
    const verifyMutate = vi.fn();
    hooksMock.useUIO.mockReturnValue({
      data: {
        id: "decision_1",
        canonicalTitle: "Adopt new onboarding flow",
        userCorrectedTitle: null,
        canonicalDescription: "Roll out new flow in Q2",
        decisionDetails: {
          statement: "Adopt new onboarding flow",
          rationale: "Higher activation",
          status: "made",
          decidedAt: "2026-02-01T00:00:00.000Z",
          supersedesUioId: null,
          supersededByUioId: null,
        },
        decisionMaker: null,
        owner: null,
        createdBy: null,
        overallConfidence: 0.88,
        isUserVerified: false,
        sources: [],
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    hooksMock.useDecisionSupersessionChain.mockReturnValue({
      data: { chain: [] },
    });
    hooksMock.useVerifyUIO.mockReturnValue({ mutate: verifyMutate });
    hooksMock.useDismissUIO.mockReturnValue({ mutate: vi.fn() });

    setRoute("/dashboard/decisions/$decisionId", { decisionId: "decision_1" });

    const module = await import("./decisions/$decisionId");
    const Component = (
      module.Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    renderWithProviders(<Component />);

    await userEvent.setup().click(screen.getByRole("button", { name: /verify/i }));

    expect(verifyMutate).toHaveBeenCalledTimes(1);
    expect(verifyMutate.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_test",
      id: "decision_1",
    });
  });

  it("wires commitment complete action to completion mutation", async () => {
    const completeMutate = vi.fn();
    hooksMock.useUIO.mockReturnValue({
      data: {
        id: "commitment_1",
        canonicalTitle: "Send weekly ops report",
        userCorrectedTitle: null,
        canonicalDescription: "Summarize weekly operations",
        commitmentDetails: {
          status: "pending",
          priority: "medium",
          direction: "owed_by_me",
        },
        debtor: null,
        creditor: null,
        owner: null,
        createdBy: null,
        overallConfidence: 0.75,
        isUserVerified: false,
        sources: [],
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    hooksMock.useMarkCompleteUIO.mockReturnValue({ mutate: completeMutate });
    hooksMock.useSnoozeUIO.mockReturnValue({ mutate: vi.fn() });
    hooksMock.useDismissUIO.mockReturnValue({ mutate: vi.fn() });
    hooksMock.useVerifyUIO.mockReturnValue({ mutate: vi.fn() });

    setRoute("/dashboard/commitments/$commitmentId", { commitmentId: "commitment_1" });

    const module = await import("./commitments/$commitmentId");
    const Component = (
      module.Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    renderWithProviders(<Component />);

    await userEvent.setup().click(screen.getByRole("button", { name: /complete/i }));

    expect(completeMutate).toHaveBeenCalledTimes(1);
    expect(completeMutate.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_test",
      id: "commitment_1",
    });
  });

  it("wires task status keyboard shortcut to typed task-status mutation", async () => {
    const statusMutate = vi.fn();
    hooksMock.useUIO.mockReturnValue({
      data: {
        id: "task_1",
        canonicalTitle: "Prepare board memo",
        userCorrectedTitle: null,
        canonicalDescription: "Draft and circulate the memo",
        taskDetails: {
          status: "todo",
          priority: "medium",
        },
        dueDate: null,
        sources: [],
        assignee: null,
        overallConfidence: 0.8,
        isUserVerified: true,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    hooksMock.useCorrectUIO.mockReturnValue({ mutate: vi.fn() });
    hooksMock.useUpdateTaskStatusUIO.mockReturnValue({ mutate: statusMutate });
    hooksMock.useUpdateTaskPriorityUIO.mockReturnValue({ mutate: vi.fn() });
    hooksMock.useArchiveUIO.mockReturnValue({ mutate: vi.fn() });

    setRoute("/dashboard/tasks/$taskId", { taskId: "task_1" });

    const module = await import("./tasks/$taskId");
    const Component = (
      module.Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    renderWithProviders(<Component />);

    fireEvent.keyDown(window, { key: "5" });

    expect(statusMutate).toHaveBeenCalledTimes(1);
    expect(statusMutate.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_test",
      id: "task_1",
      status: "done",
    });
  });

  it("wires uio verify action to status update mutation", async () => {
    const updateMutate = vi.fn();
    hooksMock.useUIO.mockReturnValue({
      data: {
        id: "uio_1",
        title: "Finalize response memo",
        type: "decision",
        status: "dismissed",
        confidence: 0.8,
        overallConfidence: 0.8,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
        sources: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    hooksMock.useUpdateUIO.mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    });
    hooksMock.useCorrectUIO.mockReturnValue({ mutate: vi.fn() });

    setRoute("/dashboard/uio/$uioId", { uioId: "uio_1" });

    const module = await import("./uio/$uioId");
    const Component = (
      module.Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    renderWithProviders(<Component />);

    await userEvent.setup().click(screen.getByRole("button", { name: /verify/i }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]?.[0]).toMatchObject({
      id: "uio_1",
      status: "active",
    });
  });
});
