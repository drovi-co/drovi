import { describe, expect, it } from "vitest";
import { getThemePack } from "./packs";

describe("theme variant visual tokens", () => {
  it("keeps institutional token snapshots stable", () => {
    const institutional = getThemePack("institutional");
    expect(institutional.light).toMatchSnapshot("institutional-light-tokens");
    expect(institutional.dark).toMatchSnapshot("institutional-dark-tokens");
  });

  it("keeps vertical accent packs stable", () => {
    expect(getThemePack("legal").light).toMatchSnapshot("legal-light-tokens");
    expect(getThemePack("legal").dark).toMatchSnapshot("legal-dark-tokens");
    expect(getThemePack("accounting").light).toMatchSnapshot(
      "accounting-light-tokens"
    );
    expect(getThemePack("accounting").dark).toMatchSnapshot(
      "accounting-dark-tokens"
    );
    expect(getThemePack("gov").light).toMatchSnapshot("gov-light-tokens");
    expect(getThemePack("gov").dark).toMatchSnapshot("gov-dark-tokens");
    expect(getThemePack("construction").light).toMatchSnapshot(
      "construction-light-tokens"
    );
    expect(getThemePack("construction").dark).toMatchSnapshot(
      "construction-dark-tokens"
    );
  });
});
