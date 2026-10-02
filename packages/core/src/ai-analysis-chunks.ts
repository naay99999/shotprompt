import { AiAnalysisError, type AiAnalysisOptions, type AiBudgets, type AiChunk, type AiProposal, type AnalysisSource, type EvaluationBatch } from './ai-analysis-types';
import type { AnalysisSegment } from './analysis-types';
export const serializedCodepoints = (value: unknown): number => [...JSON.stringify(value)].length;
export function orderedAiSegments(source: AnalysisSource): AnalysisSegment[] {
  if (!Number.isFinite(source.duration) || source.duration <= 0) throw new AiAnalysisError('invalid-source');
  const ids = new Set<number>();
  return source.segments.map(({ id, start, end, text }) => {
    if (!Number.isInteger(id) || ids.has(id) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > source.duration || end <= start || typeof text !== 'string') throw new AiAnalysisError('invalid-source');
    ids.add(id); return { id, start, end, text };
  }).filter(s => s.text.trim()).sort((a, b) => a.start - b.start || a.id - b.id);
}
function adjacentContext(rows: AnalysisSegment[], budget: number, reverse = false): AnalysisSegment[] {
  const found: AnalysisSegment[] = [];
  for (const row of reverse ? [...rows].reverse() : rows) {
    if (serializedCodepoints([...found, row]) > budget) break;
    found.push(row);
  }
  return reverse ? found.reverse() : found;
}
export function buildAiChunks(source: AnalysisSource, budgets: AiBudgets): AiChunk[] {
  const rows = orderedAiSegments(source), cores: AnalysisSegment[][] = [];
  for (const row of rows) {
    if (serializedCodepoints([row]) > budgets.coreCodepoints) throw new AiAnalysisError('input-too-large');
    const last = cores.at(-1);
    if (last && serializedCodepoints([...last, row]) <= budgets.coreCodepoints) last.push(row);
    else cores.push([row]);
    if (cores.length > budgets.maxChunks) throw new AiAnalysisError('input-too-large');
  }
  let offset = 0;
  return cores.map((core, index) => {
    const before = adjacentContext(rows.slice(0, offset), budgets.contextCodepoints, true);
    offset += core.length;
    const after = adjacentContext(rows.slice(offset), budgets.contextCodepoints);
    return { id: `chunk-${index}`, coreSegmentIds: core.map(s => s.id), coreStart: core[0].start, coreEnd: Math.max(...core.map(s => s.end)), segments: [...before, ...core, ...after] };
  });
}
export function buildBoundaryChunk(left: AiChunk, right: AiChunk, source: AnalysisSource, budgets: AiBudgets): AiChunk {
  const boundary = right.coreStart;
  const rows = orderedAiSegments(source).filter(s => s.end > boundary - 180 && s.start < boundary + 180);
  if (!rows.length || serializedCodepoints(rows) > budgets.coreCodepoints + budgets.contextCodepoints * 2) throw new AiAnalysisError('input-too-large');
  return { id: `${left.id}:${right.id}`, coreSegmentIds: rows.map(s => s.id), coreStart: rows[0].start, coreEnd: Math.max(...rows.map(s => s.end)), segments: rows };
}
export function proposalSegments(proposal: AiProposal, source: AnalysisSource): AnalysisSegment[] {
  const rows = orderedAiSegments(source), start = rows.findIndex(s => s.id === proposal.startSegmentId), end = rows.findIndex(s => s.id === proposal.endSegmentId);
  if (start < 0 || end < start) throw new AiAnalysisError('invalid-output');
  return rows.slice(start, end + 1);
}
export function evaluationPayload(options: AiAnalysisOptions, batch: EvaluationBatch) {
  return { instruction: options.instruction || 'Find engaging, useful, self-contained highlights appropriate to this source.', minDuration: options.minDuration, maxDuration: options.maxDuration, proposals: batch.proposals, source: batch.segments };
}
export function buildEvaluationBatches(proposals: AiProposal[], source: AnalysisSource, options: AiAnalysisOptions, budgets: AiBudgets): EvaluationBatch[] {
  const rows = orderedAiSegments(source), batches: EvaluationBatch[] = [];
  const make = (items: AiProposal[]): EvaluationBatch | null => {
    const required = new Set(items.flatMap(p => proposalSegments(p, source).map(s => s.id)));
    const ranges = items.map(p => proposalSegments(p, source)).map(r => ({ start: r[0].start, end: r.at(-1)!.end }));
    let segments = rows.filter(s => required.has(s.id) || ranges.some(r => s.end > r.start - options.maxDuration && s.start < r.end + options.maxDuration));
    while (serializedCodepoints(evaluationPayload(options, { proposals: items, segments })) > budgets.evaluationCodepoints) {
      const optional = segments.filter(s => !required.has(s.id));
      if (!optional.length) return null;
      const distance = (s: AnalysisSegment) => Math.min(...ranges.map(r => Math.max(r.start - s.end, s.start - r.end, 0)));
      optional.sort((a, b) => distance(b) - distance(a) || b.id - a.id);
      segments = segments.filter(s => s.id !== optional[0].id);
    }
    return { proposals: items, segments };
  };
  let pending: AiProposal[] = [];
  for (const p of proposals) {
    const together = [...pending, p];
    if (together.length > budgets.evaluationBatchSize || !make(together)) {
      if (pending.length) batches.push(make(pending)!);
      pending = [p];
      if (!make(pending)) throw new AiAnalysisError('input-too-large');
    } else pending = together;
  }
  if (pending.length) batches.push(make(pending)!);
  return batches;
}
