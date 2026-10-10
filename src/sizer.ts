import { MIN_RESERVE_SOL, DEFAULT_LOT_SIZE_SOL } from './limits';

export { MIN_RESERVE_SOL };

export function calculateAvailablePositionSize(balanceSol: number, maxTradeSol: number = DEFAULT_LOT_SIZE_SOL): number {
  const available = Math.max(0, balanceSol - MIN_RESERVE_SOL);
  return Math.min(maxTradeSol, available);
}
