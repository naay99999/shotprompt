import {
  AiAnalysisError, AI_DIMENSIONS, DEFAULT_ANALYSIS_OPTIONS, buildAiChunks, buildBoundaryChunk, buildEvaluationBatches, buildHighlightWindows,
  materializeAiResults, parseDiscoveryResponse, parseEvaluationResponse, rankAiResults,
  type AcceptedAiEvaluation, type AiAnalysisInput, type AiAssessment, type AiEvaluation, type AiProposal, type AnyHighlightResult, type EvaluationContext, type EvaluationOutput,
} from '@shotprompt/core';
import type { ModelRequest, ProviderClient } from './provider-client';
import { buildDiscoveryRequest, buildEvaluationRequest, buildRepairRequest } from './prompts';
export async function evaluateAiHighlights(input: AiAnalysisInput, context: EvaluationContext, client: ProviderClient): Promise<EvaluationOutput> {
  if (!context.snapshot) throw new AiAnalysisError('provider-not-configured');
  const snapshot = context.snapshot, budgets = snapshot.budgets, started = Date.now();
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new AiAnalysisError('run-timeout')), snapshot.provider.runTimeoutSeconds * 1000);
  const signal = AbortSignal.any([context.signal, deadline.signal]);
  let requestCount = 0, inputTokens: number | null = 0, outputTokens: number | null = 0; const models = new Set<string>();
  const metadata = () => ({ snapshot, reportedModels: [...models], usage: { inputTokens, outputTokens }, requestCount, elapsedMs: Date.now() - started });
  const report = (stage: 'discovery' | 'evaluation', completed: number, total: number) => context.onProgress({ stage, completed, total, requestCount, elapsedMs: Date.now() - started });
  async function validated<T>(request: ModelRequest, parse: (value: unknown) => T): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      if (requestCount >= budgets.maxRequests) throw new AiAnalysisError('request-budget-exceeded');
      requestCount++;
      try {
        const response = await client.complete(attempt ? buildRepairRequest(request, 'invalid-output') : request, signal);
        signal.throwIfAborted();
        if (response.reportedModel) models.add(response.reportedModel);
        inputTokens = inputTokens === null || response.usage.inputTokens === null ? null : inputTokens + response.usage.inputTokens;
        outputTokens = outputTokens === null || response.usage.outputTokens === null ? null : outputTokens + response.usage.outputTokens;
        return parse(response.value);
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof AiAnalysisError) || error.code !== 'invalid-output' || attempt === 1) throw error;
      }
    }
    throw new AiAnalysisError('invalid-output');
  }
  try {
    signal.throwIfAborted();
    const chunks = buildAiChunks(input, budgets);
    if (!chunks.length) {
      const windows = buildHighlightWindows({ ...input, options: { ...DEFAULT_ANALYSIS_OPTIONS, minDuration: input.options.minDuration, maxDuration: input.options.maxDuration } });
      const rows: AnyHighlightResult[] = windows.map(w => {
        const assessment: AiAssessment = { schemaVersion: 2, engine: 'llm-v1', title: 'ช่วงจากการเปลี่ยนฉาก', summary: 'ไม่มีบทพูดสำหรับประเมินเนื้อหา', tags: [], dimensions: Object.fromEntries(AI_DIMENSIONS.map(k => [k, { value: null as number | null, evidence: [] }])) as unknown as AiAssessment['dimensions'], reasons: [], warnings: [...w.warnings, 'scene-only'], suppressedBy: null, suppressionReason: null };
        return { ...w, score: null, assessment, rank: 0, isPrimary: false };
      });
      return { results: rankAiResults(input, input.options, rows, []), metadata: metadata() };
    }
    const proposals: AiProposal[] = [], requested = new Set<number>();
    const add = (rows: AiProposal[]) => {
      for (const p of rows) if (!proposals.some(old => old.startSegmentId === p.startSegmentId && old.endSegmentId === p.endSegmentId)) proposals.push(p);
      if (proposals.length > budgets.maxProposals) throw new AiAnalysisError('proposal-budget-exceeded');
    };
    report('discovery', 0, chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i], response = await validated(buildDiscoveryRequest(input, chunk), value => parseDiscoveryResponse(value, chunk));
      if (response.status !== 'analyzed') throw new AiAnalysisError(response.status);
      add(response.proposals);
      if (response.requestedBoundaryContext.includes('before') && i > 0) requested.add(i - 1);
      if (response.requestedBoundaryContext.includes('after') && i < chunks.length - 1) requested.add(i);
      report('discovery', i + 1, chunks.length);
    }
    let expanded = 0;
    for (const i of [...requested].sort((a, b) => a - b)) {
      const chunk = buildBoundaryChunk(chunks[i], chunks[i + 1], input, budgets);
      const response = await validated(buildDiscoveryRequest(input, chunk), value => parseDiscoveryResponse(value, chunk));
      if (response.status !== 'analyzed') throw new AiAnalysisError(response.status);
      if (response.requestedBoundaryContext.length) throw new AiAnalysisError('input-too-large');
      add(response.proposals); expanded++; report('discovery', chunks.length + expanded, chunks.length + requested.size);
    }
    const batches = buildEvaluationBatches(proposals, input, input.options, budgets), evaluations: AiEvaluation[] = [];
    report('evaluation', 0, batches.length);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      evaluations.push(...await validated(buildEvaluationRequest(input, batch), value => parseEvaluationResponse(value, batch, input, input.options)));
      report('evaluation', i + 1, batches.length);
    }
    const links = evaluations.filter((r): r is AcceptedAiEvaluation => !('rejected' in r) && !!r.duplicateOf).map(r => ({ proposalId: r.proposalId, duplicateOf: r.duplicateOf!, evidenceSegmentIds: r.duplicateEvidenceSegmentIds! }));
    signal.throwIfAborted();
    return { results: rankAiResults(input, input.options, materializeAiResults(input, input.options, evaluations), links), metadata: metadata() };
  } finally { clearTimeout(timer); }
}
