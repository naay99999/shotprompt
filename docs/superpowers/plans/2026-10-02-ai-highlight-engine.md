# AI Highlight Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover and score transcript-grounded clips with local or external AI APIs, without requiring categories, while preserving existing media workflows and analysis provenance.

**Architecture:** Pure core helpers construct transcript chunks and validate/rank model output. Server adapters execute a two-stage discovery/evaluation process through the existing analysis queue, snapshot evaluator configuration and publish complete results atomically. Versioned contracts preserve rules history and clip snapshots; the media pipeline schedules AI only after becoming ready.

**Tech Stack:** Bun, TypeScript, bun:test, SQLite/Drizzle, Elysia, Next.js App Router, native fetch/AbortSignal, existing FFmpeg helpers. No model SDK, embedding package or automatic model installation.

**Spec:** `docs/superpowers/specs/2026-10-02-ai-highlight-engine-design.md` — user approved in chat on 2026-10-02.

## Global Constraints

- New options schema v2: min/max defaults 15/60, finite 5–180 seconds, min <= max; instruction <=500 Unicode codepoints; maxClips integer 1–30, default 10. Categories/goals remain legacy-only.
- Ollama `/api/chat` and OpenAI-compatible `/chat/completions` support local or external deployment independently of protocol; default bases `http://127.0.0.1:11434` and `http://127.0.0.1:1234/v1`.
- Provider defaults: request timeout 120 seconds (10–600); run timeout 1800 seconds (60–7200), not shorter than request timeout. Model selected explicitly.
- Read optional `SHOTPROMPT_LLM_API_KEY` only on server. No secrets in DB/browser/logs/run snapshots; reject redirects and URLs containing credentials/query/fragment. External endpoints require explicit externalEnabled.
- Core chunks <=8,000 serialized Unicode codepoints; complete adjacent records <=2,000 each side; <=40 chunks. Discovery 0–3 proposals/request; <=120 unique proposals; <=160 requests including repairs/boundary work.
- Evaluation batches <=4 candidates and <=16,000 serialized payload codepoints. Exactly one repair attempt per invalid response. One request at a time through the single analysis queue.
- Rubric `clip-content-v1`: opening/standalone/substance/closure/relevance scores integer 0–5, weights 20/25/25/20/10; compute total in code. Nonzero dimensions require evidence.
- Thai titles <=120 codepoints, summaries <=600, <=5 tags of <=40 each, <=3 reasons. Original evidence text remains original-language text.
- Complete all chunks before publishing; failure/cancel/restart preserves old results. Never silently fall back to rules or a different endpoint.
- Preserve source revisions, ownership checks, old candidate/clip IDs, edits/exports, Unicode combining marks in deduplication and null-score handling.
- Read `apps/web/AGENTS.md` and relevant installed Next.js docs before web implementation. Preserve all preexisting dirty changes; stage only owned files/hunks.
- Project C is outside this plan. Real-model quality remains unverified until measured on approved sources.

## Review Focus

1. A queued run outlives a Settings change: it must use its original endpoint/model/timeouts, while credentials stay server-only (Tasks 4/7).
2. Pipeline terminal handling schedules AI whose enqueue fails: video and pipeline must remain ready/done, without duplicate automatic analysis (Task 8).
3. A subtitle record exceeds a chunk budget or a valid clip straddles a core boundary: no silent tail truncation or misleading complete result (Tasks 2/6).
4. An endpoint returns HTTP 200 but a truncated body, malformed IDs, or an unrecognized response envelope: fail/repair within budget, without publishing partial analysis (Tasks 5/6/7).
5. Empty/late history responses or SSE reconnect arrive after an edited draft: preserve instructions, selected history and unsaved clip edits (Tasks 9/10).

## File Structure and Interfaces

- `packages/core/src/ai-analysis-types.ts`: v2 contracts and shared evaluator metadata/progress.
- `packages/core/src/analysis-contracts.ts`: v1/v2 parsers, defaults, discriminants and explicit legacy-to-AI option conversion.
- `packages/core/src/ai-analysis-chunks.ts`: pure coverage/context and evaluation batch construction.
- `packages/core/src/ai-analysis-validation.ts`: strict model schema, IDs, evidence, range and string validation.
- `packages/core/src/ai-analysis-score.ts`: rubric totals and v2 result creation.
- `packages/core/src/ai-analysis-rank.ts`: deterministic v2 ranking and duplicate-group selection.
- `apps/server/src/ai/provider-settings.ts`: validation/persistence of public configuration and snapshots.
- `apps/server/src/ai/provider-client.ts`: protocol-specific HTTP transport, cancellation, bounded response reads and sanitized errors.
- `apps/server/src/ai/prompts.ts`: versioned discovery/evaluation/repair prompts and response schemas.
- `apps/server/src/ai/evaluator.ts`: budgeted orchestration; no DB/media side effects.
- `apps/server/src/routes/analysis-settings.ts`: public Settings/check routes.
- Existing `analysis-store.ts`, `analysis-service.ts`, `analysis-queue.ts`: version-aware storage/runtime/progress/publication.
- `apps/server/src/analysis-enqueue.ts`: shared enqueue and pipeline-completion scheduling, extracted to avoid routes/context import cycles.
- New DB migration `packages/db/src/migrations/analysis-v2.ts`: nullable evaluator/progress JSON columns.
- Web `analysis-view.ts` normalizes v1/v2; new `analysis-settings.tsx` and `use-analysis-settings.ts` own provider setup; existing controls/panel/status/history/editor consume versioned views.

Shared types established in Task 1:

`AiAnalysisOptions`, `RulesAnalysisOptions`, `StoredAnalysisOptions = RulesAnalysisOptions | AiAnalysisOptions`; `AiAssessment`, `RulesAssessment`, `AnalysisAssessment = RulesAssessment | AiAssessment`; `AnalysisSource = {segments, scenes, duration, language}`; `AiAnalysisInput = AnalysisSource & {options: AiAnalysisOptions}`.

Keep existing `AnalysisOptions`, `Assessment`, `AnalysisInput`, `HighlightResult` as legacy aliases used by rules algorithms. Introduce `AnyHighlightResult = Omit<HighlightResult, 'assessment'> & {assessment: AnalysisAssessment}` for runtime/storage. Update `CandidateView`, `AnalysisRunView` and `ClipAssessmentSnapshot` to versioned contracts; do not widen rules algorithm inputs accidentally.

`ProviderConfig = {protocol: 'ollama'|'openai-compatible', inferenceLocation: 'local'|'external', baseUrl, model, outputMode: 'schema'|'json', externalEnabled, requestTimeoutSeconds, runTimeoutSeconds}`.

`EvaluatorSnapshot = {provider: ProviderConfig, engineVersion: 'llm-v1', promptVersion: 'highlight-prompts-v1', rubricVersion: 'clip-content-v1', budgets: AiBudgets, triggerPipelineJobId?: string}`. Metadata adds reportedModels, nullable usage, requestCount and elapsedMs; never a key.

`AnalysisProgress = {stage: 'discovery'|'evaluation'|'thumbnails', completed: number, total: number, requestCount: number, elapsedMs: number}`.

`EvaluationOutput = {results: AnyHighlightResult[], metadata: EvaluatorMetadata | null}`. `EvaluationContext = {signal: AbortSignal, snapshot: EvaluatorSnapshot | null, onProgress(progress: AnalysisProgress): void}`.

`AiBudgets = {coreCodepoints:8000, contextCodepoints:2000, maxChunks:40, maxProposals:120, maxRequests:160, evaluationBatchSize:4, evaluationCodepoints:16000}` in production; use numeric field types so unit fixtures can inject smaller limits. `DuplicateLink = {proposalId:string, duplicateOf:string, evidenceSegmentIds:number[]}`. `AiEvaluation` is a union of accepted `{proposalId,startSegmentId,endSegmentId,title,summary,tags,dimensions:Record<AiDimension,{value:number,evidenceSegmentIds:number[]}>,reasons:{text:string,evidenceSegmentIds:number[]}[],warnings:string[],duplicateOf?:string,duplicateEvidenceSegmentIds?:number[]}` and rejected `{proposalId,rejected:true,reason:string,evidenceSegmentIds:number[]}`. Rejected entries participate in validation and do not become candidates.

`EvaluatorMetadata = {snapshot:EvaluatorSnapshot,reportedModels:string[],usage:{inputTokens:number|null,outputTokens:number|null},requestCount:number,elapsedMs:number}`. `ModelRequest.messages` contain only `{role:'system'|'user'|'assistant',content:string}`. Chunk/evaluation response schema types are exported by core; their JSON-schema representations are exported by server prompts to avoid provider dependencies in core.

## Task 1: Versioned public contracts and rubric

**Files:** Create core types/contracts/score files above and `packages/core/test/ai-analysis-contracts.test.ts`; modify `analysis-types.ts`, `index.ts`; update server/web type annotations where compile requires explicit legacy narrowing.

**Interfaces:** `parseStoredAnalysisOptions(value: unknown): StoredAnalysisOptions`; `parseAiAnalysisOptions(value: unknown): AiAnalysisOptions`; `legacyOptionsToAi(value: RulesAnalysisOptions): AiAnalysisOptions`; `isAiAssessment(value: AnalysisAssessment): value is AiAssessment`; `computeAiScore(values: Record<AiDimension, number>): number`.

`AiDimension = 'opening'|'standalone'|'substance'|'closure'|'relevance'`. `AiAssessment` contains schemaVersion 2, engine llm-v1, title/summary/tags, dimension entries `{value, evidence: Evidence[]}`, reasons `{text, evidence: Evidence[]}[]`, warnings, suppressedBy and suppressionReason (`overlap|text|semantic|overflow|null`). Rules assessments retain schemaVersion 1 exactly. AI unavailable dimensions are nullable only in scene-only assessments; model evaluation dimensions must be numeric.

- [x] Write tests `parses old options without reinterpreting scores`, `AI defaults and bounds`, `legacy conversion is explicit`, and `weighted AI score`: assert default maxClips=10/min=15/max=60; reject maxClips 0/31, instruction 501 codepoints and nonfinite durations; all fives ->100, all threes ->60. Mixed `{5,4,3,2,1}` ->65. Verify a legacy score148 remains148.
- [x] Run `bun test packages/core/test/ai-analysis-contracts.test.ts`; observe FAIL for missing contracts.
- [x] Implement the exact types/parsers/helpers; missing schemaVersion is legacy, AI defaults require the AI parser; reject unknown versions. Preserve legacy exports/algorithm behavior.
- [x] Run focused contracts and existing core analysis tests; expect PASS.
- [ ] Commit owned changes only: `feat(core): add versioned AI analysis contracts`.

## Task 2: Transcript coverage and bounded context

**Files:** Create `ai-analysis-chunks.ts`, `packages/core/test/ai-analysis-chunks.test.ts`.

**Interfaces:** `buildAiChunks(source: AnalysisSource, budgets: AiBudgets): AiChunk[]`; chunk `{id, coreSegmentIds, segments, coreStart, coreEnd}`; `buildBoundaryChunk(left: AiChunk, right: AiChunk, source: AnalysisSource, budgets: AiBudgets): AiChunk`; `buildEvaluationBatches(proposals: AiProposal[], source: AnalysisSource, options: AiAnalysisOptions, budgets: AiBudgets): EvaluationBatch[]`. `AiProposal` includes stable server proposalId, start/end segment IDs, provisionalTitle and evidence IDs. Count payload via Unicode codepoints of `JSON.stringify` of serialized records.

- [x] Write `every record belongs to exactly one core including tail`, `context uses full records`, `oversized record and forty-first chunk fail`, `cross-boundary context retains candidate IDs`, `evaluation batches never exceed four or 16000`: assert flattened core IDs equal all nonempty chronological IDs; no duplicated cores; oversized throws input-too-large; batch payload count <=16000. Cover Thai combining marks and single-segment sources.
- [x] Run `bun test packages/core/test/ai-analysis-chunks.test.ts`; expect FAIL.
- [x] Implement chunk packing using complete records, 8000/2000/40 budgets; reject malformed timing/duplicate IDs rather than renumbering source IDs. Nearby evaluation context uses maxDuration each side; optional context records drop at edges to fit, but proposal/explicitly required context never truncate. Boundary request eligibility tied to the adjacent chunk pair, with one request per pair.
- [x] Run focused chunk tests; expect PASS.
- [ ] Commit: `feat(core): build bounded transcript contexts for AI`.

## Task 3: Grounded output validation and ranking

**Files:** Create validation/rank files and `packages/core/test/ai-analysis-validation.test.ts`, `ai-analysis-rank.test.ts`; modify score/chunk exports and `analysis-dedupe.ts` only to extract reusable Unicode-preserving text similarity if necessary.

**Interfaces:** `parseDiscoveryResponse(value: unknown, chunk: AiChunk): DiscoveryResponse`; response status analyzed/unsupported-language/insufficient-transcript, proposals and requestedBoundaryContext. `parseEvaluationResponse(value: unknown, batch: EvaluationBatch, source: AnalysisSource, options: AiAnalysisOptions): AiEvaluation[]`; each proposal has exactly one accepted or rejected response entry. Accepted entries contain bounded text, final supplied IDs, scores with evidence IDs, reasons and optional duplicateOf/evidence. `materializeAiResults(source, options, evaluations): AnyHighlightResult[]`; `rankAiResults(source: AnalysisSource, options: AiAnalysisOptions, rows: AnyHighlightResult[], duplicateLinks: DuplicateLink[]): AnyHighlightResult[]`.

- [x] Write `rejects invented and out-of-span IDs`, `rejects incomplete batch and nonfinite/out-of-range scores`, `refinement cannot cut oversized segment`, `quotes come from original segments`, `empty proposals valid`, `rank preserves suppressed candidates`: assert missing nonzero evidence is invalid; generated quote never appears in stored evidence; weighted total65; overlap threshold .7; Jaccard .8; highest score wins semantic group even if links form cycles; top maxClips primary and remaining overflow. Reject duplicateOf self/unknown/rejected proposals after all batches complete.
- [x] Run `bun test packages/core/test/ai-analysis-validation.test.ts packages/core/test/ai-analysis-rank.test.ts`; expect FAIL.
- [x] Implement strict envelope/string/ID/score validation, midpoint ownership, timestamps derived from ordered supplied IDs, bounded padding, short-source exception and explicit rejection reasons. Build union-find semantic groups from validated links after evaluation; deterministic ties use warnings/start/key. Null scene-only results rank chronologically without fake semantic reasons.
- [x] Run focused and existing deduplication tests; expect PASS.
- [ ] Commit: `feat(core): validate and rank grounded AI highlights`.

## Task 4: Provider settings and compatible storage

**Files:** Create server `ai/provider-settings.ts`, DB migration, `packages/db/test/analysis-v2-migration.test.ts`, `apps/server/test/analysis-settings.test.ts`; modify DB schema/client, server app registration; create `routes/analysis-settings.ts` with GET/PUT now and check route delegated in Task 5.

**Interfaces:** `parseProviderConfig(value: unknown): ProviderConfig`; `readProviderConfig(db: DB): ProviderConfig | null`; `saveProviderConfig(db, config): void`; `createEvaluatorSnapshot(config: ProviderConfig, triggerPipelineJobId?: string): EvaluatorSnapshot`; public Settings `{config: ProviderConfig|null, keyPresent: boolean, check: {fingerprint, status, checkedAt, errorCode}|null}`. Check fingerprint covers protocol/base/model/outputMode/location; a stale check is not returned as current.

- [x] Write `old analysis DB reopens twice without loss`, `protocol independent of local location`, `external opt-in and endpoint validation`, `settings changes cannot mutate snapshot`: preserve existing candidate IDs/score/clip JSON; native and compatible loopback accepted; private IPv4/IPv6 accepted; public/custom host needs external enabled; embedded userinfo/query/fragment rejected; serialized DB/API lacks secret key; copied snapshot remains original after saving another config.
- [x] Run `bun test packages/db/test/analysis-v2-migration.test.ts apps/server/test/analysis-settings.test.ts`; expect FAIL.
- [x] Add nullable `analysis_runs.evaluator_metadata_json` and `progress_json` transactionally/idempotently, update typed schema. Persist settings via existing settings table. Keep model entry manual; no required model listing route or SDK dependency. Implement settings validation including finite integer deadline ranges and server key-present boolean. Sanitized configuration errors ->400.
- [x] Run focused DB/settings tests; expect PASS.
- [ ] Commit: `feat(server): configure local and external analysis providers`.

## Task 5: HTTP adapters and synthetic connection check

**Files:** Create `ai/provider-client.ts`, `ai/prompts.ts`, `apps/server/test/analysis-provider.test.ts`; complete Settings check route; modify `context.ts` only for injected transport when needed.

**Interfaces:** `createProviderClient(config: ProviderConfig, dependencies?: {fetch?: typeof fetch; apiKey?: () => string|undefined}): ProviderClient`; `client.complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>`; request `{messages, schema, maxOutputTokens}`; response `{value: unknown, reportedModel: string|null, usage: {inputTokens:number|null, outputTokens:number|null}}`. Provider errors carry sanitized `code` and safe message only. `checkProvider(config, client, signal): Promise<ProviderCheckResult>` uses a fixed synthetic payload expecting `{ok:true}`.

- [x] Write fixture HTTP server tests `native and compatible schema/json wire formats`, `cancel during body read`, `200 malformed envelope`, `redirect rejected`, `credential errors sanitized`, `synthetic check never contains subtitle`: assert native format schema/json and stream=false; compatible response_format json_schema/json_object; Authorization absent without a key and absent in client-visible data; 200 malformed body ->invalid-output; local secret reflected in upstream body never reflected in API response. Set bounded response limit 1MiB and test oversized/truncated response failure.
- [x] Run `bun test apps/server/test/analysis-provider.test.ts apps/server/test/analysis-settings.test.ts`; expect FAIL for transport/check behavior.
- [x] Implement native fetch adapters with redirect:error, AbortSignal timeout encompassing body reads, UTF-8 decoding and 1MiB response cap. Recognize provider envelopes, usage and missing content; distinguish invalid-output (repair eligible), unavailable/auth/rate-limit/context-too-large/unsupported-output-mode (not repair eligible). Request temperature0 and max output4096 tokens through protocol-specific options. Decode JSON without extracting arbitrary prose/fenced blocks. Save check fingerprint/status without raw provider messages. No automatic protocol/output-mode downgrade.
- [x] Run focused HTTP/settings tests; expect PASS and close each fixture server in cleanup.
- [ ] Commit: `feat(server): add structured AI provider adapters`.

## Task 6: Two-stage evaluator with budgets and cancellation

**Files:** Create `ai/evaluator.ts`, `apps/server/test/ai-evaluator.test.ts`; complete prompts/schema exports.

**Interfaces:** `evaluateAiHighlights(input: AiAnalysisInput, context: EvaluationContext, client: ProviderClient): Promise<EvaluationOutput>`; prompts `buildDiscoveryRequest(input, chunk): ModelRequest`, `buildEvaluationRequest(input, batch): ModelRequest`, `buildRepairRequest(request, validationIssues): ModelRequest`. Version constants live in prompts, exported in evaluator snapshot creation.

- [x] Write `discovers without category or keyword shortlist`, `required boundary gets one expansion`, `late chunk failure never returns partial result`, `invalid output repairs once`, `abort and 160-request budget stop future work`: use deterministic fixture responses keyed to actual supplied IDs; capture every core including late video; nonmatching natural-language intent still produces fixtures; language unsupported fails rather than empty success. Validate two invalid responses fail and no third request; no text sent for scene-only. Use injected small budgets/deadlines for boundary/call-limit tests and controllable abort rather than long sleeps.
- [x] Run `bun test apps/server/test/ai-evaluator.test.ts`; expect FAIL.
- [x] Implement sequential discovery/one expansion per adjacent boundary, range deduplication before evaluation, <=120 proposal enforcement, batching/refinement, one repair per invalid output and <=160 total calls. Resolve cross-batch duplicate links after all accepted responses. Separate system instructions from transcript data, no tools. Aggregate reported model names and usage; a missing count makes that aggregate count null. Emit stage counters and include requests for repairs in budgets. Run deadline wraps the entire evaluator; existing service must carry it through thumbnails/publication in Task 7.
- [x] Run evaluator and core focused suites; expect PASS.
- [ ] Commit: `feat(server): discover and evaluate clips through AI`.

## Task 7: Version-aware analysis lifecycle and provenance

**Files:** Modify `analysis-service.ts`, `analysis-store.ts`, `analysis-queue.ts`, `analysis-thumbnails.ts`, `routes/analysis.ts`, `clip-service.ts`, clip routes; create `apps/server/test/ai-analysis-service.test.ts`, `ai-analysis-routes.test.ts`; update legacy lifecycle fixtures to preserve their original behavioral assertions.

**Interfaces:** `AnalysisRuntime.evaluate(input: AnalysisSource & {options: StoredAnalysisOptions}, context: EvaluationContext): Promise<EvaluationOutput>`; thumbnails consume AnyHighlightResult. `createAnalysisRun(db, videoId, jobId, options: StoredAnalysisOptions, snapshot: EvaluatorSnapshot|null): AnalysisRunView`; `runAnalysis` uses persisted snapshot and progress; `publishAnalysisRun` retains revision/status checks. `runView` parses v1/v2 options plus nullable metadata/progress. Clip snapshots add nullable evaluator metadata without changing original candidate association.

- [x] Write `queued provider snapshot survives settings change`, `deadline during thumbnail stage preserves old active run`, `cancel/restart and source revision preserve clips`, `versioned ownership/history and v1 rejection`: route v2 ->202; v1 new POST ->400 unsupported-options; missing configuration ->409; existing conflicting job ->409 with jobId; old GET results remain readable. Assert final publication updates candidates/metadata/active atomically; progress cannot overwrite a completed run; secret absent in serialized snapshots. A partial batch failure produces zero new published candidates.
- [x] Run `bun test apps/server/test/ai-analysis-service.test.ts apps/server/test/ai-analysis-routes.test.ts`; expect FAIL.
- [x] Adapt storage/load/runtime to union types. Default runtime chooses AI for v2 and explicit rules for legacy test/history execution only. Combine job abort and persisted run deadline through evaluator and thumbnail JobCtx; timeout is failed, human cancel is canceled. Guard progress/failure updates by queued/running status. Persist sanitized error codes/messages; retain null usage. Add AI capabilities/defaults to profiles while keeping legacy profile metadata. Copy full evaluator metadata at acceptance and preserve it on trims. Recover stale runs unchanged in intent.
- [x] Run focused suites plus existing analysis/clips/recovery route tests; expect PASS after updating injected runtimes to return EvaluationOutput.
- [ ] Commit: `feat(server): publish versioned AI analysis runs safely`.

## Task 8: Schedule AI after successful media processing

**Files:** Create `analysis-enqueue.ts`, `apps/server/test/ai-pipeline-scheduling.test.ts`; modify queue/context/pipeline, analysis route enqueue import, video upload options parser, detect-hooks/thumbnails compatibility steps, `apps/web/lib/pipeline-steps.ts` copy.

**Interfaces:** `enqueueAiAnalysis(ctx: Ctx, videoId: string, options: AiAnalysisOptions, triggerPipelineJobId?: string): {runId:string,jobId:string}`; `schedulePipelineAnalysis(ctx: Ctx, completedJobId: string): void`. `JobQueue` accepts optional terminal callback `{onDone?: (jobId: string) => void}`; invoke only after stored status done. Catch callback failure separately from the runner so it never marks a completed pipeline failed. Use snapshot.triggerPipelineJobId to avoid duplicate scheduling if callback is invoked twice.

- [x] Write `ready without configured AI`, `pipeline done before enqueue`, `AI failure and scheduling failure preserve ready/done`, `double completion callback creates one run`, `retry does not publish rules or erase accepted clip`: actual queue with injected media steps/AI runtime; assert video ready before analysis starts; at most one auto analysis for a completed pipeline ID. Active-job transaction rejects race with manual reanalysis; do not queue an automatic retry after failure. Config absent ->no analysis run and setup-required capabilities visible.
- [x] Run `bun test apps/server/test/ai-pipeline-scheduling.test.ts`; expect FAIL.
- [x] Extract enqueue from route to avoid context import cycles. Apply v2 defaults at upload, parsing multipart before file copy; old uploaded v1 options explicitly map for auto AI processing after completed retries. Make legacy pipeline highlight/thumbnail steps no-ops for new runs with clear skipped metadata/copy; no hidden second evaluator. Keep historical step readers tolerant. Attach successful completion callback; schedule only when configuration is usable and no pipeline/analysis job remains active. Keep exports independent.
- [x] Run scheduling, pipeline, queue, videos and API-contract tests; expect PASS.
- [ ] Commit: `feat(server): schedule AI separately from media preparation`.

## Task 9: Provider setup UI and shared AI controls

**Files:** Create `apps/web/components/analysis-settings.tsx`, `apps/web/lib/use-analysis-settings.ts`, `apps/web/test/analysis-settings-state.test.ts`; modify Settings page, analysis controls, upload zone, reducer/hook/ui copy/errors; update `analysis-state.test.ts`.

**Interfaces:** `useAnalysisSettings()` returns `{config,keyPresent,check,loading,saving,error,refresh,save,checkConnection}`. `AnalysisControls` consumes AiAnalysisOptions. Draft reducer always stores v2; selected history may hold v1 read-only options. New `useLegacyOptionsForAi(options: RulesAnalysisOptions)` action explicitly calls Task 1 conversion; do not automatically reset a draft when selecting old history.

- [x] Read installed Next docs for App Router client data fetching/forms before writing UI. Write `late saved options never overwrite an edited instruction`, `history selection/reconnect preserves draft`, `settings edit invalidates check and stale request ignored`: assert edited instruction survives matching load-success and late previous request; an old goal/category does not appear in AI controls; same video refresh never resets clip editor state.
- [x] Run `bun test apps/web/test/analysis-state.test.ts apps/web/test/analysis-settings-state.test.ts`; expect FAIL for v2/provider behavior.
- [x] Implement labeled protocol/location/base/model/output-mode/deadline settings, explicit externalEnabled disclosure, server key-present/env guidance and synthetic check. Default local endpoint follows selected protocol when not edited. Controls show durations/instruction/maxClips and get defaults from API. Upload remains enabled without AI; setup help explains prepared video can be analyzed later. Preserve whitespace while typing and trim only validation/submission. No API key input or direct browser provider request.
- [x] Run focused state tests; expect PASS.
- [ ] Commit: `feat(web): configure AI and request category-free clips`.

## Task 10: Version-aware results, history and score explanations

**Files:** Modify `analysis-view.ts`, candidate panel, score details/status, workspace page, clip editor/strip, timeline, hook; extend `apps/web/test/analysis-view.test.ts` and state tests.

**Interfaces:** `toAnalysisDisplay(candidate: CandidateView): AnalysisDisplay`; display `{engineLabel,title,summary,tags,scoreLabel,dimensions,reasons,warnings,suppressionLabel}` with safe v1/null mappings. Filter `{tag:string|null,minScore:number|null,includeSuppressed:boolean}`; exact generated tag selection never affects analysis. Scene-only disables minScore. Clip stale checks retain .01-second tolerance.

- [x] Write `AI and rules histories render distinct dimensions`, `legacy score148 remains labeled legacy`, `null is not zero`, `semantic and overflow suppression distinguished`, `legacy conversion leaves edited draft untouched unless explicitly requested`: verify original quoted evidence and seek times; score filtering shared by panel/timeline; no access to v1.categoryScores for v2; history model/version metadata does not leak secrets.
- [x] Run `bun test apps/web/test/analysis-view.test.ts apps/web/test/analysis-state.test.ts`; expect FAIL for new view contracts.
- [x] Implement AI title/summary/tags, five rubric dimensions, original-text reasons/seek links, progress stage counts and retry/settings action. Present v1 categories only in legacy details/history; convert button explains dropped goals/weights. Preserve selected history/draft/unsaved-editor guard through SSE reconnect. Show original evaluator metadata in accepted clip details and stale assessment notice after trimming.
- [x] Run focused web tests; expect PASS. In isolated running app inspect 1280px/390px layouts, focus/labels, provider check/error, upload without AI, history v1/v2, null score, cancel/retry and evidence seek. Record which interactions were actually observed.
- [ ] Commit: `feat(web): explain and compare AI highlight results`.

## Task 11: Integrated acceptance and documentation

**Files:** Create `apps/server/test/ai-analysis-integration.test.ts`; update README, spec/plan completion checkboxes and execution ledger.

**Interfaces:** Public routes, fixture HTTP endpoints, real in-memory DB and injected thumbnail/media process boundary. No real provider/media data in default suites.

- [x] Write `pipeline to AI to accepted clip to reanalysis preserves provenance`: complete media, auto enqueue AI, publish, accept, feedback, save another model config, manual reanalysis, confirm original clip JSON/candidate ID unchanged; cancel next run and assert active result remains; delete removes associated rows. Add legacy migration/read path and a late invalid HTTP response proving no partial publication. Assert fixtures include Thai, English and another language without real-model quality claims.
- [x] Run `bun test apps/server/test/ai-analysis-integration.test.ts`; expect PASS once Tasks 1–10 implemented, fixing contract mismatches while retaining valid assertions.
- [x] Run `bun run test`, `bun run typecheck`, `bun run --cwd apps/web build` sequentially; expect exit0. Avoid bare bun test's preexisting dist duplicates; remove only generated artifacts proven created by this work. If sandbox port restrictions block build/browser, use approved escalation and record actual outcomes.
- [x] Perform isolated browser acceptance through the HTTP adapter and real application. Record provider protocol/body/cancellation behavior with fixtures; inspect both desktop/mobile, errors and drafts. Use user-configured real local endpoint only if available; external real-transcript execution requires already enabled configuration. Measure top-five selection, boundary edits, time/latency on user-approved sources if available; otherwise mark real-model ranking quality unverified.
- [x] Complete independent whole-change review per executing skill; fix findings, rerun only affected checks then broader checks when justified. Compare new changes against captured starting baseline so preexisting work is preserved.
- [x] Document endpoint setup/model entry/env key, v2 analysis usage, history compatibility, limits/timeouts and remaining C scope. Commit safely separable owned integration/docs changes: `test: cover AI highlight lifecycle`; no merge/deploy requested.

## Execution and Review Checkpoints

- [x] Spec approved by user.
- [x] Tasks cover core discovery, providers, lifecycle, pipeline, UI and acceptance.
- [x] Interface names/types, spec constraints and Review Focus mapped to owned tasks.
- [x] User reviews this written plan (approved Native execution).
- [x] Execute Tasks 1–11 and record actual verification.

Preserve the user's previously selected **Native execution**: implement in this session, then one independent final reviewer. Tasks share versioned types and lifecycle interfaces; per-task parallel implementation would add integration churn. The existing dirty checkout includes project A and earlier work; at execution preflight capture a new baseline, inspect attached worktrees and use the current non-main branch when isolation would omit those required changes. Any implementation commits must stage only owned new files/reviewed hunks. Keep dependent changes uncommitted when separating them would include unrelated user work.

Implementation commit steps deferred under the baseline-preservation ruling: code depends on preexisting uncommitted project A. See execution ledger for actual checks and final review. Real-model quality remains unverified; C not implemented.
