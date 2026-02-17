import { describe, expect, it } from "vitest";
import { isTeamAdminRole, resolveTeamMemberDisplay } from "./members";

describe("isTeamAdminRole", () => {
  it("treats owner and admin as privileged roles", () => {
    expect(isTeamAdminRole("pilot_owner")).toBe(true);
    expect(isTeamAdminRole("pilot_admin")).toBe(true);
    expect(isTeamAdminRole("pilot_member")).toBe(false);
  });
});

describe("resolveTeamMemberDisplay", () => {
  it("uses explicit display name when available", () => {
    expect(
      resolveTeamMemberDisplay({
        id: "usr_1",
        name: "Jules Garcia",
        email: "jules@drovi.co",
        role: "pilot_member",
      })
    ).toEqual({
      displayName: "Jules Garcia",
      initials: "JG",
      isOwner: false,
    });
  });

  it("falls back to email prefix and owner detection", () => {
    expect(
      resolveTeamMemberDisplay({
        id: "usr_2",
        email: "legal.partner@drovi.co",
        role: "pilot_owner",
      })
    ).toEqual({
      displayName: "legal.partner",
      initials: "L",
      isOwner: true,
    });
  });
});
