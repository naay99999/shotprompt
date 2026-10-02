import type { AiDimension } from './ai-analysis-types';
export const AI_DIMENSIONS: AiDimension[] = ['opening', 'standalone', 'substance', 'closure', 'relevance'];
export const AI_WEIGHTS: Record<AiDimension, number> = { opening: 20, standalone: 25, substance: 25, closure: 20, relevance: 10 };
export function computeAiScore(values: Record<AiDimension, number>): number {
  for (const key of AI_DIMENSIONS) if (!Number.isInteger(values[key]) || values[key] < 0 || values[key] > 5) throw new Error('invalid dimension score');
  return Math.round(AI_DIMENSIONS.reduce((sum, key) => sum + values[key] / 5 * AI_WEIGHTS[key], 0));
}
