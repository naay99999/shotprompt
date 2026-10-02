import { ANALYSIS_PROFILES, CATEGORIES, getAnalysisCapabilities } from './analysis-profiles';
import { collectSignals, PROFILE_SIGNALS, queryCoverage } from './analysis-signals';
import type { AnalysisInput, Assessment, Category, Dimensions, HighlightWindow, ScoredHighlight } from './analysis-types';
export function weightedScore(dimensions: Dimensions, category: Category): number {
  return Math.round((Object.keys(dimensions) as (keyof Dimensions)[]).reduce((sum, key) => sum + (dimensions[key] ?? 0) * ANALYSIS_PROFILES[category][key], 0) / 100);
}
export function scoreHighlight(input: AnalysisInput, window: HighlightWindow): ScoredHighlight {
  const warnings = [...window.warnings];
  const empty: Dimensions = { hook: null, categoryFit: null, completeness: null, pacing: null, goalFit: null };
  const assessment: Assessment = { schemaVersion: 1, engine: 'rules-v1', primaryCategory: null, categoryScores: {}, dimensions: empty, reasons: [], warnings, evidenceLevel: 'limited', suppressedBy: null, suppressionReason: null };
  if (!getAnalysisCapabilities(input.language).supportedScoring || window.source === 'scene') {
    warnings.push(window.source === 'scene' ? 'scene-only' : 'unsupported-language');
    return { ...window, score: null, assessment };
  }
  const evidence = collectSignals(input, window), codes = new Set(evidence.map(e => e.code));
  const segments = input.segments.filter(s => window.segmentIds.includes(s.id)).sort((a, b) => a.start - b.start);
  let spoken = 0, covered = window.start;
  for (const s of segments) { const end = Math.min(window.end, s.end); spoken += Math.max(0, end - Math.max(covered, s.start)); covered = Math.max(covered, end); }
  const pacing = Math.min(100, Math.round(100 * spoken / (window.end - window.start)));
  const hook = Math.min(100, evidence.filter(e => e.start < window.start + 5 && ['question', 'problem', 'urgency', 'setup'].includes(e.code)).length * 50);
  const completeness = 25 * (Number(!warnings.includes('starts-mid-thought')) + Number(!warnings.includes('ends-too-soon')) + Number(['answer', 'resolution', 'conclusion'].some(c => codes.has(c))) + Number(!warnings.some(w => w === 'starts-mid-thought' || w === 'ends-too-soon')));
  let bestScore = -1, bestFit = 0;
  for (const category of CATEGORIES.filter(c => input.options.categories.includes(c))) {
    const categoryFit = PROFILE_SIGNALS[category].filter(c => codes.has(c)).length * 25;
    const goalCodes = { sell: ['benefit', 'offer', 'cta'], teach: ['problem', 'instruction', 'example'], entertain: ['conflict', 'change', 'resolution'], 'drive-full-video': ['question', 'opinion', 'experience'] };
    let goalFit = input.options.goal === 'balanced' ? categoryFit : goalCodes[input.options.goal].filter(c => codes.has(c)).length / 3 * 100;
    if (input.options.query) goalFit = goalFit / 2 + queryCoverage(input.options.query, segments.filter(s => s.start >= window.start && s.end <= window.end).map(s => s.text).join(' '), input.language) / 2;
    const dimensions: Dimensions = { hook, categoryFit, completeness, pacing, goalFit: Math.round(goalFit) };
    const score = weightedScore(dimensions, category);
    assessment.categoryScores[category] = { score, dimensions, evidence: evidence.filter(e => PROFILE_SIGNALS[category].includes(e.code)) };
    if (score > bestScore) { bestScore = score; bestFit = categoryFit; assessment.primaryCategory = category; assessment.dimensions = dimensions; }
  }
  if (!bestFit) assessment.primaryCategory = null;
  const primaryCodes = assessment.primaryCategory ? PROFILE_SIGNALS[assessment.primaryCategory] : [];
  assessment.reasons = [...evidence].sort((a, b) => Number(primaryCodes.includes(b.code)) - Number(primaryCodes.includes(a.code))).slice(0, 3);
  assessment.evidenceLevel = codes.size >= 4 ? 'strong' : codes.size >= 2 ? 'moderate' : 'limited';
  return { ...window, score: Math.max(0, bestScore), assessment };
}
