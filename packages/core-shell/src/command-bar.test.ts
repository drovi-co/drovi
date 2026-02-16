import { describe, expect, it } from "vitest";
import { isCommandBarShortcut } from "./command-bar";

function keyEvent(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return partial as KeyboardEvent;
}

describe("isCommandBarShortcut", () => {
  it("matches cmd+k", () => {
    expect(
      isCommandBarShortcut(
        keyEvent({
          metaKey: true,
          ctrlKey: false,
          key: "k",
        })
      )
    ).toBe(true);
  });

  it("matches ctrl+k", () => {
    expect(
      isCommandBarShortcut(
        keyEvent({
          metaKey: false,
          ctrlKey: true,
          key: "K",
        })
      )
    ).toBe(true);
  });

  it("rejects unrelated keys", () => {
    expect(
      isCommandBarShortcut(
        keyEvent({
          metaKey: true,
          ctrlKey: false,
          key: "p",
        })
      )
    ).toBe(false);
  });
});
