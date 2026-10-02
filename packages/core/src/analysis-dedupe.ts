import type { AnalysisInput, HighlightResult, ScoredHighlight } from './analysis-types';
export function shingles(text: string, language: string): Set<string> {
  const value = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').trim();
  if (!value) return new Set();
  const tokens = language === 'th' ? [...value.replace(/\s/g, '')] : value.split(/\s+/);
  const size = language === 'th' ? 3 : 2;
  if (tokens.length < size) return new Set([tokens.join(' ')]);
  return new Set(tokens.slice(0, 1 - size).map((_, i) => tokens.slice(i, i + size).join(' ')));
}
export function rankHighlights(input: AnalysisInput, results: ScoredHighlight[]): HighlightResult[] {
  const text = new Map(input.segments.map(s => [s.id, s.text]));
  const ordered = [...results].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.score === null && b.score === null ? a.start - b.start : a.assessment.warnings.length - b.assessment.warnings.length) || a.start - b.start || a.end - b.end);
  const kept: { row: HighlightResult; words: Set<string> }[] = [];
  return ordered.map((result, rank) => {
    const row: HighlightResult = { ...result, assessment: { ...result.assessment, suppressedBy: null, suppressionReason: null }, rank, isPrimary: false };
    const words = shingles(result.segmentIds.map(id => text.get(id) ?? '').join(' '), input.language);
    for (const other of kept) {
      const overlap = Math.max(0, Math.min(row.end, other.row.end) - Math.max(row.start, other.row.start)) / Math.min(row.end - row.start, other.row.end - other.row.start);
      let intersection = 0;
      for (const word of words) if (other.words.has(word)) intersection++;
      const union = words.size + other.words.size - intersection;
      if (overlap >= 0.7 || (union > 0 && intersection / union >= 0.8)) {
        row.assessment.suppressedBy = other.row.key;
        row.assessment.suppressionReason = overlap >= 0.7 ? 'overlap' : 'text';
        return row;
      }
    }
    row.isPrimary = kept.length < 30;
    kept.push({ row, words });
    return row;
  });
}
