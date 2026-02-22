import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkAuth: vi.fn(),
  getState: vi.fn(),
  requireGuest: vi.fn(),
  redirect: vi.fn((payload) => payload),
  lazyRouteComponent: vi.fn(() => "lazy-component"),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
    options,
  }),
  lazyRouteComponent: mocks.lazyRouteComponent,
  redirect: mocks.redirect,
}));

vi.mock("@memorystack/mod-auth", () => ({
  requireGuest: mocks.requireGuest,
}));

vi.mock("@/lib/auth", () => ({
  useAdminAuthStore: { getState: mocks.getState },
}));

vi.mock("@/modules/runtime", () => ({
  getAdminPostLoginRedirect: () => "/dashboard",
}));

import { Route } from "./login";

describe("Admin login route smoke", () => {
  beforeEach(() => {
    mocks.checkAuth.mockReset();
    mocks.getState.mockReset();
    mocks.requireGuest.mockReset();
    mocks.redirect.mockClear();
    mocks.lazyRouteComponent.mockClear();
  });

  it("runs beforeLoad auth check and allows guests", async () => {
    mocks.checkAuth.mockResolvedValue(undefined);
    mocks.getState
      .mockReturnValueOnce({ checkAuth: mocks.checkAuth })
      .mockReturnValueOnce({
        checkAuth: mocks.checkAuth,
        me: null,
        isLoading: false,
      });
    mocks.requireGuest.mockReturnValue({ allow: true, redirectTo: null });

    await (Route as { options: { beforeLoad: () => Promise<void> } }).options.beforeLoad();

    expect(mocks.checkAuth).toHaveBeenCalledTimes(1);
    expect(mocks.requireGuest).toHaveBeenCalledWith(
      { isAuthenticated: false, isLoading: false },
      "/dashboard"
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects authenticated users during beforeLoad", async () => {
    mocks.checkAuth.mockResolvedValue(undefined);
    mocks.getState
      .mockReturnValueOnce({ checkAuth: mocks.checkAuth })
      .mockReturnValueOnce({
        checkAuth: mocks.checkAuth,
        me: { id: "admin_1" },
        isLoading: false,
      });
    mocks.requireGuest.mockReturnValue({ allow: false, redirectTo: "/dashboard" });

    await expect(
      (Route as { options: { beforeLoad: () => Promise<void> } }).options.beforeLoad()
    ).rejects.toEqual({ to: "/dashboard" });

    expect(mocks.redirect).toHaveBeenCalledWith({ to: "/dashboard" });
  });
});
