export function canUseConsoleModule(
  capabilities: Record<string, boolean>
): boolean {
  return capabilities["ops.internal"] !== false;
}
