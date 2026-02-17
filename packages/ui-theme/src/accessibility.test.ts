import { describe, expect, it } from "vitest";
import { getThemePack, type ThemeVariables } from "./packs";

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelToLinear(value: number): number {
  const srgb = value / 255;
  if (srgb <= 0.03928) {
    return srgb / 12.92;
  }
  return ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const fg = luminance(foregroundHex);
  const bg = luminance(backgroundHex);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function expectContrast(
  variables: ThemeVariables,
  foregroundVar: string,
  backgroundVar: string,
  minimum: number
): void {
  const foreground = variables[foregroundVar];
  const background = variables[backgroundVar];
  expect(foreground).toBeTypeOf("string");
  expect(background).toBeTypeOf("string");
  if (typeof foreground !== "string" || typeof background !== "string") {
    throw new Error(
      `Missing theme variables: ${foregroundVar} / ${backgroundVar}`
    );
  }
  expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum);
}

describe("institutional theme accessibility", () => {
  it("meets baseline contrast in light mode", () => {
    const light = getThemePack("institutional").light;
    expectContrast(light, "--foreground", "--background", 7);
    expectContrast(light, "--card-foreground", "--card", 7);
    expectContrast(light, "--primary-foreground", "--primary", 4.5);
    expectContrast(light, "--sidebar-foreground", "--sidebar", 4.5);
    expectContrast(light, "--ring", "--background", 3);
  });

  it("meets baseline contrast in dark mode", () => {
    const dark = getThemePack("institutional").dark;
    expectContrast(dark, "--foreground", "--background", 7);
    expectContrast(dark, "--card-foreground", "--card", 7);
    expectContrast(dark, "--primary-foreground", "--primary", 4.5);
    expectContrast(dark, "--sidebar-foreground", "--sidebar", 4.5);
    expectContrast(dark, "--ring", "--background", 3);
  });
});
