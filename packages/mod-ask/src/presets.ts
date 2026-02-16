export interface AskPreset {
  id: string;
  title: string;
  prompt: string;
}

export const defaultAskPresets: AskPreset[] = [
  {
    id: "ask.summary",
    title: "Summarize the latest changes",
    prompt: "Summarize what changed this week with evidence.",
  },
  {
    id: "ask.risks",
    title: "Show unresolved risks",
    prompt: "List unresolved risks with proofs and confidence.",
  },
];

export function resolveAskPreset(
  presets: AskPreset[],
  presetId: string
): AskPreset | null {
  return presets.find((preset) => preset.id === presetId) ?? null;
}
