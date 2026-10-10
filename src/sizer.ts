export const MIN_RESERVE_SOL = 0.01;

export function calculateAvailablePositionSize(balanceSol: number, maxTradeSol: number = 0.02): number {
  const available = Math.max(0, balanceSol - MIN_RESERVE_SOL);
  return Math.min(maxTradeSol, available);
}
