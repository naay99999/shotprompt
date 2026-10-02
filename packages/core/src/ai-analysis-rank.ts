import { AiAnalysisError, type AiAnalysisOptions, type AnalysisSource, type AnyHighlightResult, type DuplicateLink } from './ai-analysis-types';
import { shingles } from './analysis-dedupe';
export function rankAiResults(source: AnalysisSource, options: AiAnalysisOptions, rows: AnyHighlightResult[], links: DuplicateLink[]): AnyHighlightResult[] {
  const byId = new Map(rows.map(r => [r.key, r])), parent = new Map(rows.map(r => [r.key, r.key]));
  function find(id: string): string { const p = parent.get(id)!; if (p !== id) parent.set(id, find(p)); return parent.get(id)!; }
  for (const link of links) {
    const row = byId.get(link.proposalId), target = byId.get(link.duplicateOf);
    if (!row || !target || row === target || !link.evidenceSegmentIds.length || link.evidenceSegmentIds.some(id => !row.segmentIds.includes(id))) throw new AiAnalysisError('invalid-output');
    parent.set(find(row.key), find(target.key));
  }
  const text = new Map(source.segments.map(s => [s.id, s.text]));
  const ordered = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.assessment.warnings.length - b.assessment.warnings.length || a.start - b.start || a.key.localeCompare(b.key));
  const kept: { row: AnyHighlightResult; words: Set<string> }[] = []; let primaryCount = 0;
  return ordered.map((r, rank) => {
    const row: AnyHighlightResult = { ...r, rank, isPrimary: false, assessment: { ...r.assessment, suppressedBy: null, suppressionReason: null } };
    const words = shingles(row.segmentIds.map(id => text.get(id) ?? '').join(' '), source.language);
    for (const other of kept) {
      const overlap = Math.max(0, Math.min(row.end, other.row.end) - Math.max(row.start, other.row.start)) / Math.min(row.end - row.start, other.row.end - other.row.start);
      const intersection = [...words].filter(w => other.words.has(w)).length, union = words.size + other.words.size - intersection;
      const semantic = find(row.key) === find(other.row.key);
      if (overlap >= 0.7 || (union > 0 && intersection / union >= 0.8) || semantic) {
        row.assessment.suppressedBy = other.row.key;
        if (row.assessment.schemaVersion === 2) row.assessment.suppressionReason = overlap >= 0.7 ? 'overlap' : union > 0 && intersection / union >= 0.8 ? 'text' : 'semantic';
        return row;
      }
    }
    row.isPrimary = primaryCount < options.maxClips;
    if (row.isPrimary) primaryCount++;
    else if (row.assessment.schemaVersion === 2) row.assessment.suppressionReason = 'overflow';
    kept.push({ row, words }); return row;
  });
}
