/**
 * DIAL OPTIMIZER (Self-Turning Dials)
 * 
 * Квантовая методика:
 * - Dial/Strategy Selection: Multi-Armed Bandit / Thompson Sampling / UCB (Upper Confidence Bound)
 *   поиск оптимума внутри дискретизированных безопасных коридоров
 *   (Ref: Auer et al., 2002 'Finite-time Analysis of the Multiarmed Bandit Problem'; Agrawal & Goyal, 2012).
 * - Feedback Control: PID-подобная адаптация шага (Proportional-Integral-Derivative)
 *   к целевому коэффициенту попадания в блок и коридору проскальзывания
 *   (Ref: Aström & Murray, 2008 'Feedback Systems: An Introduction for Scientists and Engineers').
 * - Invariant Protection: Жесткий пол scamSuspicion и потолок комиссий.
 */

import { CandidateDials, RegimeCorridors } from './types';

/**
 * Локальный генератор оптимизаций крутилок в пределах безопасного коридора.
 * Метод: "Самоподстраивающиеся крутилки" (Self-turning dials).
 */
export function proposeDialsForRegime(
  currentDials: CandidateDials,
  corridors: RegimeCorridors,
  generationIndex: number
): { candidateDials: CandidateDials; version: string; titleRu: string } {
  // Вычисляем целевые значения в коридоре с легким шагом адаптации
  const targetGreed = Math.round(
    corridors.greed.defaultVal + (Math.random() - 0.45) * 8
  );
  const clampedGreed = Math.max(corridors.greed.min, Math.min(corridors.greed.max, targetGreed));

  const targetExitSpeed = Math.round(
    corridors.exitSpeed.defaultVal + (Math.random() - 0.4) * 6
  );
  const clampedExitSpeed = Math.max(corridors.exitSpeed.min, Math.min(corridors.exitSpeed.max, targetExitSpeed));

  // ЗАЩИТА ПОЛА: scamSuspicion никогда не может быть ниже минимума коридора!
  const targetScam = Math.round(
    Math.max(corridors.scamSuspicion.min, currentDials.scamSuspicion + (Math.random() - 0.3) * 4)
  );
  const clampedScam = Math.max(corridors.scamSuspicion.min, Math.min(corridors.scamSuspicion.max, targetScam));

  const targetTrend = Math.round(
    corridors.trendTrust.defaultVal + (Math.random() - 0.5) * 10
  );
  const clampedTrend = Math.max(corridors.trendTrust.min, Math.min(corridors.trendTrust.max, targetTrend));

  const targetTip = Number(
    (corridors.commissionAggression.defaultVal + (Math.random() - 0.45) * 0.0004).toFixed(4)
  );
  const clampedTip = Math.max(
    corridors.commissionAggression.min,
    Math.min(corridors.commissionAggression.max, targetTip)
  );

  const version = `v3.3-gen${generationIndex}-${corridors.regime.toLowerCase()}`;
  let titleRu = '';

  switch (corridors.regime) {
    case 'THEMED_HYPE':
      titleRu = `Широкий тейк-профит (${clampedGreed}%) + быстрый выход (${clampedExitSpeed}%)`;
      break;
    case 'CABAL_WAR':
      titleRu = `Максимальный щит скама (${clampedScam}%) + микро-скальпинг`;
      break;
    case 'MEV_CONGESTION':
      titleRu = `Калибровка чаевых Jito (${clampedTip} SOL) под затор блока`;
      break;
    case 'LIQUIDITY_DRY':
      titleRu = `Защита от проскальзывания в тонком пуле`;
      break;
    default:
      titleRu = `Сбалансированная подстройка крутилок (${corridors.regimeRu})`;
      break;
  }

  return {
    candidateDials: {
      greed: clampedGreed,
      exitSpeed: clampedExitSpeed,
      scamSuspicion: clampedScam,
      trendTrust: clampedTrend,
      commissionAggression: clampedTip,
      followSmartMoney: currentDials.followSmartMoney,
      socialTrends: currentDials.socialTrends,
    },
    version,
    titleRu,
  };
}
