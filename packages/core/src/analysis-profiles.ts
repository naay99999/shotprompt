import type { AnalysisOptions, Category, Dimensions, Goal } from './analysis-types';
export const CATEGORIES: Category[] = ['sales', 'podcast', 'education', 'story'];
export const GOALS: Goal[] = ['balanced', 'sell', 'teach', 'entertain', 'drive-full-video'];
export const CATEGORY_LABELS: Record<Category, string> = { sales: 'ขายของ / รีวิว', podcast: 'Podcast / สัมภาษณ์', education: 'ความรู้ / สอน', story: 'เรื่องเล่า' };
export const GOAL_LABELS: Record<Goal, string> = { balanced: 'สมดุล', sell: 'ขายสินค้า', teach: 'ให้ความรู้', entertain: 'บันเทิง', 'drive-full-video': 'ชวนดูตอนเต็ม' };
export const ANALYSIS_PROFILES: Record<Category, Record<keyof Dimensions, number>> = {
  sales: { hook: 20, categoryFit: 25, completeness: 20, pacing: 10, goalFit: 25 },
  podcast: { hook: 20, categoryFit: 20, completeness: 35, pacing: 10, goalFit: 15 },
  education: { hook: 15, categoryFit: 25, completeness: 35, pacing: 10, goalFit: 15 },
  story: { hook: 25, categoryFit: 20, completeness: 30, pacing: 15, goalFit: 10 },
};
export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = { categories: [...CATEGORIES], goal: 'balanced', minDuration: 15, maxDuration: 60, query: '' };
export function parseAnalysisOptions(value: unknown): AnalysisOptions {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('invalid analysis options');
  const o = { ...DEFAULT_ANALYSIS_OPTIONS, ...(value as Partial<AnalysisOptions> | undefined) };
  if (!Array.isArray(o.categories) || !o.categories.length || o.categories.length > 4 || new Set(o.categories).size !== o.categories.length || o.categories.some(c => !CATEGORIES.includes(c)) || !GOALS.includes(o.goal) || typeof o.query !== 'string' || !Number.isFinite(o.minDuration) || !Number.isFinite(o.maxDuration) || o.minDuration < 5 || o.maxDuration > 180 || o.minDuration > o.maxDuration || [...o.query.trim()].length > 500) throw new Error('invalid analysis options');
  return { ...o, categories: [...o.categories], query: o.query.trim() };
}
export const getAnalysisCapabilities = (language: string) => ({ semantic: false as const, supportedScoring: language === 'th' || language === 'en' });
