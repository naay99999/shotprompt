import { AiAnalysisError, type AcceptedAiEvaluation, type AiAnalysisOptions, type AiAssessment, type AiChunk, type AiEvaluation, type AnalysisSource, type AnyHighlightResult, type DiscoveryResponse, type EvaluationBatch } from './ai-analysis-types';
import { orderedAiSegments } from './ai-analysis-chunks';
import { AI_DIMENSIONS, computeAiScore } from './ai-analysis-score';
import type { AnalysisSegment, Evidence } from './analysis-types';
const invalid = (): never => { throw new AiAnalysisError('invalid-output'); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid();
const string = (v: unknown, max: number): string => typeof v === 'string' && v.trim() && [...v].length <= max ? v.trim() : invalid();
function ids(value: unknown, allowed: Set<number>, required = false): number[] {
  const rows = array(value, 120);
  if ((required && !rows.length) || rows.some(id => typeof id !== 'number' || !Number.isInteger(id) || !allowed.has(id)) || new Set(rows).size !== rows.length) invalid();
  return rows as number[];
}
function selectedRows(start: unknown, end: unknown, rows: AnalysisSegment[]): AnalysisSegment[] {
  const a = rows.findIndex(s => s.id === start), b = rows.findIndex(s => s.id === end);
  if (a < 0 || b < a || rows[b].end <= rows[a].start) invalid();
  return rows.slice(a, b + 1);
}
export function parseDiscoveryResponse(value: unknown, chunk: AiChunk): DiscoveryResponse {
  const o = object(value), status = o.status;
  if (!['analyzed', 'unsupported-language', 'insufficient-transcript'].includes(status as string)) invalid();
  const allowed = new Set(chunk.segments.map(s => s.id));
  const proposals = array(o.proposals, 3).map((v, index) => {
    const p = object(v), rows = selectedRows(p.startSegmentId, p.endSegmentId, chunk.segments);
    const midpoint = (rows[0].start + rows.at(-1)!.end) / 2;
    if (midpoint < chunk.coreStart || midpoint > chunk.coreEnd) invalid();
    return { proposalId: `${chunk.id}:${index}`, startSegmentId: rows[0].id, endSegmentId: rows.at(-1)!.id, provisionalTitle: string(p.provisionalTitle, 120), evidenceSegmentIds: ids(p.evidenceSegmentIds, new Set(rows.map(s => s.id)), true) };
  });
  const requestedBoundaryContext = array(o.requestedBoundaryContext, 2);
  if (requestedBoundaryContext.some(v => v !== 'before' && v !== 'after') || new Set(requestedBoundaryContext).size !== requestedBoundaryContext.length || (status !== 'analyzed' && proposals.length)) invalid();
  return { status: status as DiscoveryResponse['status'], proposals, requestedBoundaryContext: requestedBoundaryContext as DiscoveryResponse['requestedBoundaryContext'] };
}
export const AI_WARNING_CODES = ['starts-mid-thought', 'ends-too-soon', 'needs-context', 'short-source'] as const;
export function parseEvaluationResponse(value: unknown, batch: EvaluationBatch, source: AnalysisSource, options: AiAnalysisOptions): AiEvaluation[] {
  const entries = array(object(value).results, batch.proposals.length), seen = new Set<string>(), allowed = new Set(batch.segments.map(s => s.id));
  const sourceRows = orderedAiSegments(source);
  const result = entries.map((entry): AiEvaluation => {
    const o = object(entry), proposalId = string(o.proposalId, 200);
    if (!batch.proposals.some(p => p.proposalId === proposalId) || seen.has(proposalId)) invalid();
    seen.add(proposalId);
    if (o.rejected === true) return { proposalId, rejected: true, reason: string(o.reason, 600), evidenceSegmentIds: ids(o.evidenceSegmentIds, allowed, true) };
    const rows = selectedRows(o.startSegmentId, o.endSegmentId, sourceRows);
    if (rows.some(s => !allowed.has(s.id))) invalid();
    const duration = rows.at(-1)!.end - rows[0].start;
    if (duration > options.maxDuration || (source.duration >= options.minDuration && duration < options.minDuration) || (source.duration < options.minDuration && (rows[0].id !== sourceRows[0].id || rows.at(-1)!.id !== sourceRows.at(-1)!.id))) invalid();
    const clipIds = new Set(rows.map(s => s.id)), dimensionObject = object(o.dimensions);
    const dimensions = Object.fromEntries(AI_DIMENSIONS.map(key => {
      const d = object(dimensionObject[key]);
      if (typeof d.value !== 'number' || !Number.isInteger(d.value) || d.value < 0 || d.value > 5) invalid();
      const score = d.value as number;
      return [key, { value: score, evidenceSegmentIds: ids(d.evidenceSegmentIds, clipIds, score > 0) }];
    })) as AcceptedAiEvaluation['dimensions'];
    const reasons = array(o.reasons, 3).map(v => { const r = object(v); return { text: string(r.text, 600), evidenceSegmentIds: ids(r.evidenceSegmentIds, clipIds, true) }; });
    const warnings = array(o.warnings, 4).map(v => string(v, 50));
    if (warnings.some(w => !AI_WARNING_CODES.includes(w as typeof AI_WARNING_CODES[number])) || new Set(warnings).size !== warnings.length) invalid();
    const tags = array(o.tags, 5).map(v => string(v, 40));
    const duplicateOf = o.duplicateOf === undefined || o.duplicateOf === null ? undefined : string(o.duplicateOf, 200);
    if (duplicateOf && (duplicateOf === proposalId || !batch.proposals.some(p => p.proposalId === duplicateOf))) invalid();
    return { proposalId, startSegmentId: rows[0].id, endSegmentId: rows.at(-1)!.id, title: string(o.title, 120), summary: string(o.summary, 600), tags: [...new Set(tags)], dimensions, reasons, warnings,
      ...(duplicateOf ? { duplicateOf, duplicateEvidenceSegmentIds: ids(o.duplicateEvidenceSegmentIds, clipIds, true) } : {}) };
  });
  if (seen.size !== batch.proposals.length) invalid();
  for (const row of result) if (!('rejected' in row) && row.duplicateOf && !result.some(target => target.proposalId === row.duplicateOf && !('rejected' in target))) invalid();
  return result;
}
export function materializeAiResults(source: AnalysisSource, options: AiAnalysisOptions, evaluations: AiEvaluation[]): AnyHighlightResult[] {
  const rows = orderedAiSegments(source), lookup = new Map(rows.map(s => [s.id, s]));
  const evidence = (id: number, code: string): Evidence => ({ ...lookup.get(id)!, segmentId: id, code });
  return evaluations.filter((r): r is AcceptedAiEvaluation => !('rejected' in r)).map(r => {
    const selected = selectedRows(r.startSegmentId, r.endSegmentId, rows), first = selected[0], last = selected.at(-1)!;
    const availablePadding = options.maxDuration - (last.end - first.start), before = Math.min(0.25, first.start, availablePadding);
    const shortSource = source.duration < options.minDuration;
    const start = shortSource ? 0 : first.start - before, end = shortSource ? source.duration : Math.min(source.duration, last.end + Math.min(0.5, availablePadding - before));
    const warnings = [...r.warnings, ...(source.duration < options.minDuration && !r.warnings.includes('short-source') ? ['short-source'] : [])];
    const dimensions = Object.fromEntries(AI_DIMENSIONS.map(k => [k, { value: r.dimensions[k].value, evidence: r.dimensions[k].evidenceSegmentIds.map(id => evidence(id, k)) }])) as AiAssessment['dimensions'];
    const assessment: AiAssessment = { schemaVersion: 2, engine: 'llm-v1', title: r.title, summary: r.summary, tags: r.tags, dimensions, reasons: r.reasons.map(reason => ({ text: reason.text, evidence: reason.evidenceSegmentIds.map(id => evidence(id, 'reason')) })), warnings, suppressedBy: null, suppressionReason: null };
    return { key: r.proposalId, start, end, segmentIds: selected.map(s => s.id), source: 'speech', warnings, score: computeAiScore(Object.fromEntries(AI_DIMENSIONS.map(k => [k, r.dimensions[k].value])) as Record<typeof AI_DIMENSIONS[number], number>), assessment, rank: 0, isPrimary: false };
  });
}
