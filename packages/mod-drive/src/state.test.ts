import { describe, expect, it } from "vitest";
import { normalizeDriveRouteState } from "./state";

describe("normalizeDriveRouteState", () => {
  it("hydrates a default folder and null selections", () => {
    expect(normalizeDriveRouteState({}, "/vault")).toEqual({
      folder: "/vault",
      doc: null,
      chunk: null,
      quote: null,
      readerOpen: false,
    });
  });

  it("marks reader as open when a document is selected", () => {
    expect(
      normalizeDriveRouteState({
        folder: "/contracts",
        doc: "doc_1",
        chunk: "chn_1",
      })
    ).toMatchObject({
      folder: "/contracts",
      doc: "doc_1",
      chunk: "chn_1",
      readerOpen: true,
    });
  });
});
