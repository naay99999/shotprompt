import type { AnalysisInput, HighlightResult } from './analysis-types';
import { buildHighlightWindows } from './analysis-windows';
import { scoreHighlight } from './analysis-score';
import { rankHighlights } from './analysis-dedupe';
export function analyzeHighlights(input: AnalysisInput): HighlightResult[] {
  return rankHighlights(input, buildHighlightWindows(input).map(window => scoreHighlight(input, window)));
}
