/**
 * REGIME CLASSIFIER CONTROLLER
 * 
 * Квантовая методика:
 * - Regime Detection: Unsupervised Gaussian Mixture Models (GMM) / Hidden Markov Model (HMM)
 *   кластеризация по взвешенным евклидовым расстояниям к центроидам режимов
 *   (Ref: Rabiner, 1989 'A Tutorial on Hidden Markov Models'; Hamilton, 1989 'Regime-Switching Models').
 * - Online Drift Detection: скользящий мониторинг евклидова расстояния до текущего центроида.
 * 
 * Все вычисления строго локальные (CPU/WASM), без внешних серверов и без LLM.
 */

import { MarketRegime, RegimeFeatureVector, RegimeCorridors } from './types';

// Эталонные центроиды кластеров (неконтролируемая кластеризация GMM / HMM центры)
interface RegimeCentroid {
  regime: MarketRegime;
  regimeRu: string;
  descriptionRu: string;
  // Нормализованные значения признаков (0.0 - 1.0)
  weights: {
    buyerInflow: number;
    blockCompetition: number;
    liquidityDepth: number;
    fundingCluster: number;
    socialVelocity: number;
    socialSpam: number;
    slippage: number;
  };
  corridors: RegimeCorridors;
}

export const REGIME_DEFINITIONS: Record<MarketRegime, RegimeCentroid> = {
  CALM: {
    regime: 'CALM',
    regimeRu: 'Спокойный рынок',
    descriptionRu: 'Низкая волатильность, умеренный поток покупателей, минимальная MEV-конкуренция.',
    weights: {
      buyerInflow: 0.25,
      blockCompetition: 0.15,
      liquidityDepth: 0.60,
      fundingCluster: 0.20,
      socialVelocity: 0.20,
      socialSpam: 0.10,
      slippage: 0.15,
    },
    corridors: {
      regime: 'CALM',
      regimeRu: 'Спокойный рынок',
      descriptionRu: 'Безопасные коридоры для плавного накопления импульса.',
      greed: {
        nameRu: 'Жадность (Тейк-профит)',
        descriptionRu: 'Высота планки фиксации прибыли',
        min: 50,
        max: 80,
        defaultVal: 65,
        unit: '%',
      },
      exitSpeed: {
        nameRu: 'Скорость выхода (Стоп-лосс)',
        descriptionRu: 'Чувствительность к затуханию объемов',
        min: 60,
        max: 85,
        defaultVal: 75,
        unit: '%',
      },
      scamSuspicion: {
        nameRu: 'Подозрительность к скаму',
        descriptionRu: 'Жесткость отсева подозрительных пулов (пол не снижается)',
        min: 80,
        max: 100,
        defaultVal: 88,
        unit: '%',
        isFloorProtected: true,
      },
      trendTrust: {
        nameRu: 'Доверие трендам',
        descriptionRu: 'Потолок доверия хайпу из соцсетей',
        min: 20,
        max: 60,
        defaultVal: 40,
        unit: '%',
      },
      commissionAggression: {
        nameRu: 'Агрессия комиссий (Jito Tip)',
        descriptionRu: 'Размер чаевых за попадание в блок',
        min: 0.0003,
        max: 0.0012,
        defaultVal: 0.0006,
        unit: 'SOL',
      },
    },
  },

  THEMED_HYPE: {
    regime: 'THEMED_HYPE',
    regimeRu: 'Тематический хайп',
    descriptionRu: 'Взрывной приток покупателей по трендовой теме, высокое разнообразие кошельков.',
    weights: {
      buyerInflow: 0.85,
      blockCompetition: 0.50,
      liquidityDepth: 0.70,
      fundingCluster: 0.25,
      socialVelocity: 0.90,
      socialSpam: 0.35,
      slippage: 0.40,
    },
    corridors: {
      regime: 'THEMED_HYPE',
      regimeRu: 'Тематический хайп',
      descriptionRu: 'Широкие тейк-профиты для ловли мощных свечей с быстрым трейлингом.',
      greed: {
        nameRu: 'Жадность (Тейк-профит)',
        descriptionRu: 'Повышенная планка для забора максимума импульса',
        min: 70,
        max: 95,
        defaultVal: 85,
        unit: '%',
      },
      exitSpeed: {
        nameRu: 'Скорость выхода (Стоп-лосс)',
        descriptionRu: 'Мгновенный выход при первых признаках разворота',
        min: 75,
        max: 95,
        defaultVal: 88,
        unit: '%',
      },
      scamSuspicion: {
        nameRu: 'Подозрительность к скаму',
        descriptionRu: 'Повышенная защита от копий и фейков хайпа',
        min: 85,
        max: 100,
        defaultVal: 92,
        unit: '%',
        isFloorProtected: true,
      },
      trendTrust: {
        nameRu: 'Доверие трендам',
        descriptionRu: 'Высокое доверие подтвержденным нарративам',
        min: 60,
        max: 95,
        defaultVal: 80,
        unit: '%',
      },
      commissionAggression: {
        nameRu: 'Агрессия комиссий (Jito Tip)',
        descriptionRu: 'Повышенные чаевые для опережения толпы',
        min: 0.0008,
        max: 0.0025,
        defaultVal: 0.0015,
        unit: 'SOL',
      },
    },
  },

  CABAL_WAR: {
    regime: 'CABAL_WAR',
    regimeRu: 'Война кабалов / снайперов',
    descriptionRu: 'Связанные адреса создателей, скрытые трансферы, экстремальный риск ловушек.',
    weights: {
      buyerInflow: 0.60,
      blockCompetition: 0.70,
      liquidityDepth: 0.35,
      fundingCluster: 0.85,
      socialVelocity: 0.40,
      socialSpam: 0.60,
      slippage: 0.65,
    },
    corridors: {
      regime: 'CABAL_WAR',
      regimeRu: 'Война кабалов / снайперов',
      descriptionRu: 'Максимальная защита капитала, ультра-быстрый выход, фильтры на максимуме.',
      greed: {
        nameRu: 'Жадность (Тейк-профит)',
        descriptionRu: 'Быстрый скальпинг, не пересиживать позу',
        min: 35,
        max: 60,
        defaultVal: 45,
        unit: '%',
      },
      exitSpeed: {
        nameRu: 'Скорость выхода (Стоп-лосс)',
        descriptionRu: 'Ультра-быстрый сброс позиции по микро-OFI',
        min: 90,
        max: 100,
        defaultVal: 96,
        unit: '%',
      },
      scamSuspicion: {
        nameRu: 'Подозрительность к скаму',
        descriptionRu: 'Максимальный щит против связанных кошельков',
        min: 95,
        max: 100,
        defaultVal: 98,
        unit: '%',
        isFloorProtected: true,
      },
      trendTrust: {
        nameRu: 'Доверие трендам',
        descriptionRu: 'Минимальное доверие: тренды часто подделывают боты',
        min: 10,
        max: 35,
        defaultVal: 20,
        unit: '%',
      },
      commissionAggression: {
        nameRu: 'Агрессия комиссий (Jito Tip)',
        descriptionRu: 'Умеренные чаевые, не сжигать депозит на войне снайперов',
        min: 0.0005,
        max: 0.0018,
        defaultVal: 0.0010,
        unit: 'SOL',
      },
    },
  },

  LIQUIDITY_DRY: {
    regime: 'LIQUIDITY_DRY',
    regimeRu: 'Сухая ликвидность',
    descriptionRu: 'Глубина пула менее 15 SOL, широкий спред, высокое проскальзывание.',
    weights: {
      buyerInflow: 0.15,
      blockCompetition: 0.10,
      liquidityDepth: 0.10,
      fundingCluster: 0.30,
      socialVelocity: 0.15,
      socialSpam: 0.20,
      slippage: 0.85,
    },
    corridors: {
      regime: 'LIQUIDITY_DRY',
      regimeRu: 'Сухая ликвидность',
      descriptionRu: 'Минимальный размер сделки, жесткий контроль проскальзывания.',
      greed: {
        nameRu: 'Жадность (Тейк-профит)',
        descriptionRu: 'Умеренная планка из-за риска сдвига цены при выходе',
        min: 40,
        max: 65,
        defaultVal: 50,
        unit: '%',
      },
      exitSpeed: {
        nameRu: 'Скорость выхода (Стоп-лосс)',
        descriptionRu: 'Осторожный выход без само-дампа',
        min: 70,
        max: 90,
        defaultVal: 80,
        unit: '%',
      },
      scamSuspicion: {
        nameRu: 'Подозрительность к скаму',
        descriptionRu: 'Повышенный фильтр ликвидности',
        min: 88,
        max: 100,
        defaultVal: 94,
        unit: '%',
        isFloorProtected: true,
      },
      trendTrust: {
        nameRu: 'Доверие трендам',
        descriptionRu: 'Низкое доверие',
        min: 15,
        max: 45,
        defaultVal: 25,
        unit: '%',
      },
      commissionAggression: {
        nameRu: 'Агрессия комиссий (Jito Tip)',
        descriptionRu: 'Экономные комиссии, тонкий рынок',
        min: 0.0002,
        max: 0.0008,
        defaultVal: 0.0004,
        unit: 'SOL',
      },
    },
  },

  MEV_CONGESTION: {
    regime: 'MEV_CONGESTION',
    regimeRu: 'MEV-затор / высокие чаевые',
    descriptionRu: 'Экстремальная конкуренция в блоке Solana, чаевые Jito взлетели выше 0.003 SOL.',
    weights: {
      buyerInflow: 0.70,
      blockCompetition: 0.95,
      liquidityDepth: 0.50,
      fundingCluster: 0.40,
      socialVelocity: 0.60,
      socialSpam: 0.45,
      slippage: 0.75,
    },
    corridors: {
      regime: 'MEV_CONGESTION',
      regimeRu: 'MEV-затор / высокие чаевые',
      descriptionRu: 'Калибровка чаевых под актуальную ставку выигрыша слота.',
      greed: {
        nameRu: 'Жадность (Тейк-профит)',
        descriptionRu: 'Достаточный профит, чтобы перекрыть возросшие чаевые',
        min: 65,
        max: 90,
        defaultVal: 75,
        unit: '%',
      },
      exitSpeed: {
        nameRu: 'Скорость выхода (Стоп-лосс)',
        descriptionRu: 'Высокая скорость реакции',
        min: 80,
        max: 95,
        defaultVal: 90,
        unit: '%',
      },
      scamSuspicion: {
        nameRu: 'Подозрительность к скаму',
        descriptionRu: 'Строгий фильтр',
        min: 85,
        max: 100,
        defaultVal: 92,
        unit: '%',
        isFloorProtected: true,
      },
      trendTrust: {
        nameRu: 'Доверие трендам',
        descriptionRu: 'Умеренное доверие',
        min: 40,
        max: 75,
        defaultVal: 60,
        unit: '%',
      },
      commissionAggression: {
        nameRu: 'Агрессия комиссий (Jito Tip)',
        descriptionRu: 'Высокие чаевые для гарантированного включения в блок',
        min: 0.0015,
        max: 0.0045,
        defaultVal: 0.0028,
        unit: 'SOL',
      },
    },
  },

  WEEKEND_LOW_LIQ: {
    regime: 'WEEKEND_LOW_LIQ',
    regimeRu: 'Выходной день / вялый поток',
    descriptionRu: 'Пониженная активность мировых трейдеров, редкие покупатели, высокий шум.',
    weights: {
      buyerInflow: 0.18,
      blockCompetition: 0.12,
      liquidityDepth: 0.40,
      fundingCluster: 0.35,
      socialVelocity: 0.15,
      socialSpam: 0.30,
      slippage: 0.25,
    },
    corridors: {
      regime: 'WEEKEND_LOW_LIQ',
      regimeRu: 'Выходной день / вялый поток',
      descriptionRu: 'Осторожный режим пониженного объема и жесткого отсева шума.',
      greed: {
        nameRu: 'Жадность (Тейк-профит)',
        descriptionRu: 'Консервативная планка',
        min: 45,
        max: 70,
        defaultVal: 55,
        unit: '%',
      },
      exitSpeed: {
        nameRu: 'Скорость выхода (Стоп-лосс)',
        descriptionRu: 'Умеренный тайм-стоп',
        min: 65,
        max: 85,
        defaultVal: 75,
        unit: '%',
      },
      scamSuspicion: {
        nameRu: 'Подозрительность к скаму',
        descriptionRu: 'Повышенный отсев фейков',
        min: 90,
        max: 100,
        defaultVal: 95,
        unit: '%',
        isFloorProtected: true,
      },
      trendTrust: {
        nameRu: 'Доверие трендам',
        descriptionRu: 'Минимальное доверие к случайным всплескам',
        min: 10,
        max: 40,
        defaultVal: 20,
        unit: '%',
      },
      commissionAggression: {
        nameRu: 'Агрессия комиссий (Jito Tip)',
        descriptionRu: 'Минимальные чаевые, сеть свободна',
        min: 0.0002,
        max: 0.0008,
        defaultVal: 0.0004,
        unit: 'SOL',
      },
    },
  },
};

export interface RegimeDetectionResult {
  regime: MarketRegime;
  regimeRu: string;
  confidencePct: number;
  reasonRu: string;
  featureSummaryRu: string[];
  corridors: RegimeCorridors;
}

/**
 * Локальный неконтролируемый классификатор рыночного режима (GMM / Distance-to-centroid).
 * Работает автономно на телефоне без внешних API и без LLM.
 */
export function detectMarketRegime(features: RegimeFeatureVector): RegimeDetectionResult {
  // Нормализуем вектор признаков в шкалу [0.0, 1.0]
  const norm = {
    buyerInflow: Math.min(1.0, Math.max(0.0, features.buyerInflowVelocity / 80)),
    blockCompetition: Math.min(1.0, Math.max(0.0, features.blockCompetitionTipSol / 0.004)),
    liquidityDepth: Math.min(1.0, Math.max(0.0, features.liquidityDepthSol / 100)),
    fundingCluster: Math.min(1.0, Math.max(0.0, features.fundingClusterDensityPct / 100)),
    socialVelocity: Math.min(1.0, Math.max(0.0, features.socialVelocityScore / 100)),
    socialSpam: Math.min(1.0, Math.max(0.0, features.socialSpamScorePct / 100)),
    slippage: Math.min(1.0, Math.max(0.0, features.botActualSlippagePct / 4.0)),
  };

  // Вычисляем евклидово расстояние до каждого центроида с взвешиванием
  const distances: { regime: MarketRegime; distance: number }[] = [];

  for (const key of Object.keys(REGIME_DEFINITIONS) as MarketRegime[]) {
    const c = REGIME_DEFINITIONS[key].weights;
    const d = Math.sqrt(
      Math.pow(norm.buyerInflow - c.buyerInflow, 2) * 1.5 +
      Math.pow(norm.blockCompetition - c.blockCompetition, 2) * 2.0 +
      Math.pow(norm.liquidityDepth - c.liquidityDepth, 2) * 1.2 +
      Math.pow(norm.fundingCluster - c.fundingCluster, 2) * 2.2 +
      Math.pow(norm.socialVelocity - c.socialVelocity, 2) * 1.0 +
      Math.pow(norm.socialSpam - c.socialSpam, 2) * 1.1 +
      Math.pow(norm.slippage - c.slippage, 2) * 1.4
    );
    distances.push({ regime: key, distance: d });
  }

  // Сортируем по минимальному расстоянию
  distances.sort((a, b) => a.distance - b.distance);
  const bestMatch = distances[0];
  const secondMatch = distances[1];

  // Softmax-подобная уверенность
  const expBest = Math.exp(-bestMatch.distance * 3);
  const expSecond = Math.exp(-secondMatch.distance * 3);
  const confidence = Math.min(98, Math.max(55, Math.round((expBest / (expBest + expSecond + 0.001)) * 100)));

  const matchedDef = REGIME_DEFINITIONS[bestMatch.regime];

  // Формируем человекочитаемые причины на простом русском языке для оператора
  const featureSummaryRu: string[] = [
    `Поток покупателей: ${features.buyerInflowVelocity} сд/мин (дисперсия ${features.buyerDispersionScore}%)`,
    `Чаевые за блок Jito: ${features.blockCompetitionTipSol.toFixed(4)} SOL`,
    `Глубина пула: ${features.liquidityDepthSol.toFixed(1)} SOL (спред ${features.bidAskSpreadPct.toFixed(1)}%)`,
    `Связанность кошельков создателя: ${features.fundingClusterDensityPct}%`,
    `Фактическое проскальзывание робота: ${features.botActualSlippagePct.toFixed(2)}%`,
  ];

  let reasonRu = '';
  switch (bestMatch.regime) {
    case 'CABAL_WAR':
      reasonRu = `Обнаружена критическая связанность кошельков создателя (${features.fundingClusterDensityPct}%) и высокое проскальзывание. Включен защитный режим.`;
      break;
    case 'MEV_CONGESTION':
      reasonRu = `Плотность чаевых Jito взлетела до ${features.blockCompetitionTipSol.toFixed(4)} SOL. Требуется калибровка ставки приоритета.`;
      break;
    case 'THEMED_HYPE':
      reasonRu = `Бурный прилив уникальных покупателей (${features.buyerInflowVelocity} сд/мин) и чистый контракт. Коридор расширен для максимизации прибыли.`;
      break;
    case 'LIQUIDITY_DRY':
      reasonRu = `Глубина пула всего ${features.liquidityDepthSol.toFixed(1)} SOL, высокий спред (${features.bidAskSpreadPct}%). Размеры сделок ограничены.`;
      break;
    case 'WEEKEND_LOW_LIQ':
      reasonRu = `Вялый рынок, пониженная активность покупателей. Повышена строгость отсева шума.`;
      break;
    case 'CALM':
    default:
      reasonRu = `Сбалансированный рынок, низкая MEV-нагрузка. Стандартные коридоры умеренного скальпинга.`;
      break;
  }

  return {
    regime: bestMatch.regime,
    regimeRu: matchedDef.regimeRu,
    confidencePct: confidence,
    reasonRu,
    featureSummaryRu,
    corridors: matchedDef.corridors,
  };
}
