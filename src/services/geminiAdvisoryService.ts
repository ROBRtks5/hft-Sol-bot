import { GoogleGenAI, Type, Schema } from '@google/genai';

/**
 * ИЗОЛИРОВАННЫЙ СЕРВИС ИИ-СОВЕТНИКА GEMINI (Stage 29-FIX)
 *
 * RUNTIME AUTONOMY & ISOLATION INVARIANTS:
 * 1. ИИ НЕ ИМЕЕТ Доступа к ключам, не подписывает транзакции, не управляет выводами.
 * 2. ИИ НЕ МОЖЕТ ослабить скам-фильтры, отменить стоп-лосс или превысить лимит риска (0.02 SOL).
 * 3. Результат ИИ ограничивается коэффициентом доверия нарративу в строго заданных рамках [0.8x - 1.2x].
 * 4. При сбое сети или отсутствующем API ключе автопилот мгновенно возвращает нейтральный коэффициент 1.0x.
 */

export interface AdvisoryAnalysisRequest {
  tokenSymbol: string;
  mintAddress: string;
  liquiditySol: number;
  volume5mSol: number;
  bondingCurvePct: number;
  smartWalletsCount: number;
}

export interface AdvisoryAnalysisResponse {
  multiplier: number; // 0.8x - 1.2x
  cabalRiskPct: number; // 0 - 100
  recommendation: 'BUY' | 'SKIP' | 'WATCH';
  reasoningRu: string;
}

const advisoryResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    multiplier: {
      type: Type.NUMBER,
      description: 'Множитель доверия нарративу от 0.8 до 1.2',
    },
    cabalRiskPct: {
      type: Type.NUMBER,
      description: 'Оценка риска сговора кабала или сброса разработчиком от 0 до 100',
    },
    recommendation: {
      type: Type.STRING,
      enum: ['BUY', 'SKIP', 'WATCH'],
      description: 'Рекомендация ИИ по монете',
    },
    reasoningRu: {
      type: Type.STRING,
      description: 'Краткое объяснение на понятном русском языке (до 2 предложений)',
    },
  },
  required: ['multiplier', 'cabalRiskPct', 'recommendation', 'reasoningRu'],
};

export class GeminiAdvisoryService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (apiKey) {
      try {
        this.ai = new GoogleGenAI({ apiKey });
      } catch (err) {
        console.warn('[Gemini Advisory]: Ошибка инициализации SDK:', err);
      }
    }
  }

  public async analyzeCandidate(req: AdvisoryAnalysisRequest): Promise<AdvisoryAnalysisResponse> {
    if (!this.ai) {
      return this.getNeutralFallback('ИИ недоступен (API ключ не задан). Хот-патч торгует по жёстким правилам Solana.');
    }

    try {
      const prompt = `Проанализируй монету-кандидат на Solana:
Символ: ${req.tokenSymbol}
Минт: ${req.mintAddress}
Ликвидность: ${req.liquiditySol} SOL
Объём за 5м: ${req.volume5mSol} SOL
Прогресс Бондинга: ${req.bondingCurvePct}%
Умные кошельки: ${req.smartWalletsCount}

Оцени риск кабала и дай рекомендацию в формате JSON.`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: advisoryResponseSchema,
          temperature: 0.2,
        },
      });

      const text = response.text;
      if (!text) {
        return this.getNeutralFallback('ИИ вернул пустой ответ. Применен нейтральный фактор 1.0x.');
      }

      const parsed = JSON.parse(text);
      // Ограничиваем мультипликатор жесткими рамками [0.8x - 1.2x]
      const rawMult = typeof parsed.multiplier === 'number' ? parsed.multiplier : 1.0;
      const boundedMultiplier = Math.max(0.8, Math.min(1.2, rawMult));

      return {
        multiplier: boundedMultiplier,
        cabalRiskPct: Math.max(0, Math.min(100, parsed.cabalRiskPct || 20)),
        recommendation: parsed.recommendation || 'WATCH',
        reasoningRu: parsed.reasoningRu || 'ИИ одобрил вход по метрикам объема и ликвидности.',
      };
    } catch (err: any) {
      console.warn('[Gemini Advisory]: Ошибка запроса к ИИ, фоллбэк на нейтральный коэффициент:', err?.message);
      return this.getNeutralFallback('ИИ временно недоступен. Хот-патч ведет сделку по локальным инвариантам.');
    }
  }

  private getNeutralFallback(reasoningRu: string): AdvisoryAnalysisResponse {
    return {
      multiplier: 1.0,
      cabalRiskPct: 15,
      recommendation: 'WATCH',
      reasoningRu,
    };
  }
}

export const defaultGeminiAdvisoryService = new GeminiAdvisoryService();
