# Multicategory Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ส่งมอบโครงการ A: คัดช่วงเด่นสี่หมวดพร้อมคะแนนอธิบายได้ ตั้งหัวข้อ/ความยาว ลดคลิปซ้ำ รับ Feedback และประเมินใหม่โดยไม่ถอดเสียงซ้ำ

**Architecture:** Pure core functions สร้างและประเมินช่วงจาก transcript/scenes; server จัดการ immutable analysis runs, thumbnail staging และ atomic publication. Initial pipeline และ reanalysis เรียก evaluator เดียวกัน UI ใช้ shared contracts และเก็บคะแนน legacy แยกจากคะแนนใหม่

**Tech Stack:** Bun, TypeScript, bun:test, SQLite/Drizzle, Elysia/Eden, Next.js 16, React 19, FFmpeg ที่มีอยู่แล้ว

**Spec:** `docs/superpowers/specs/2026-10-02-multicategory-highlights-design.md` — approved 2026-10-02. B/C เป็นโครงการต่อยอด ไม่รวมในแผน A

## Global Constraints

- ทำงานในเครื่องเป็นค่าเริ่มต้นตามโครงการ รองรับชุดเกณฑ์ภาษาไทยและอังกฤษก่อน
- หมวด sales, podcast, education, story; เป้าหมาย balanced, sell, teach, entertain, drive-full-video
- defaults: ทั้งสี่หมวด, balanced, 15–60 วินาที; min/max ระหว่าง 5–180 วินาที โดย min <= max; query <=500 ตัวอักษร
- คะแนนแต่ละด้าน 0–100; unsupported language และ scene-only ไม่มีคะแนนรวมเทียม
- น้ำหนัก hook/categoryFit/completeness/pacing/goalFit: sales 20/25/20/10/25; podcast 20/20/35/10/15; education 15/25/35/10/15; story 25/20/30/15/10
- ช่องว่างอย่างน้อย 1.5 วินาทีเป็นสัญญาณเริ่มกลุ่ม; ทุกช่วงอยู่ภายใน duration และ max หลัง padding
- ไม่เกิน 500 ช่วงก่อนคัดซ้ำ กระจายตลอดวิดีโอ; ผลหลักไม่เกิน 30 ช่วง
- duplicate overlap/shorter >=0.7 หรือ text Jaccard >=0.8; ข้อความว่างไม่เป็น text duplicate
- เหตุผลผูกกับ segment ID/time/text จริง; evidenceLevel คือความครบของหลักฐานตามกฎ
- ไม่เพิ่ม dependency สำหรับโมเดลภาษาใน A; ไม่วัดคุณภาพเสียง/ภาพจาก transcript
- ใช้ native path APIs, ตรวจ Windows/macOS path assumptions และไม่ commit runtime data/models/media
- งานเดิมใน workspace จำนวนมาก: เก็บ baseline diff ก่อนแก้ ห้าม reset/clean หรือ commit งานเดิมรวมโดยไม่ได้ตั้งใจ
- ก่อน implementation ใช้ using-git-worktrees เพื่อเลือก workspace ที่เก็บงานปัจจุบันครบ; worktree จาก HEAD อย่างเดียวไม่ครบ เพราะ dependencies ของ UI/ภาษาอยู่ใน uncommitted changes
- อ่าน domain skills ที่เกี่ยวข้องและ installed Next.js docs ก่อนแก้เว็บ; ไม่เพิ่ม shadcn หรือ framework ใหม่

## Review Focus

- Thai transcript ไม่มี punctuation และมี Unicode normalization ต่างกัน: ผลถูกขอบเขต ไม่หลุดช่วงหรือได้คะแนนซ้ำจากคำเดียว — Task 2/3
- ผู้ใช้กด cancel ระหว่าง thumbnail เสร็จและ publish: ผลเก่าต้องยัง active และไม่มีไฟล์รอบใหม่ตกค้าง — Task 6
- export เกิดพร้อม analysis และมี job ใหม่กว่า: ลบวิดีโอต้องตรวจทุก active job ไม่ตรวจเฉพาะ latest — Task 7
- SSE reconnect ขณะกำลังพิมพ์ options หรือแก้คลิป: refresh ผลโดยไม่ทับ input ที่ยังไม่บันทึก — Task 9
- candidate จากรอบเก่ายังถูกอ้างโดย clip และ feedback หลัง reanalysis/repair: ยังค้นคืนได้และ snapshot ไม่เปลี่ยน — Task 5/7/8

## File structure and contracts

Create core files `analysis-types.ts`, `analysis-profiles.ts`, `analysis-signals.ts`, `analysis-windows.ts`, `analysis-score.ts`, `analysis-dedupe.ts`, `analyze-highlights.ts` ใน `packages/core/src/`; export จาก `index.ts`. คง legacy `detectHooks` ไว้จนเปลี่ยน pipeline แล้ว; ไม่เปลี่ยน public legacy type ให้ nullable โดยบังเอิญ

Create DB migration `packages/db/src/migrations/analysis-v1.ts`; update `schema.ts`, `client.ts` และ `index.ts` เมื่อจำเป็น

Create server files `analysis-store.ts` (run DB lifecycle), `analysis-service.ts` (evaluate/stage/publish), `analysis-thumbnails.ts` (ไฟล์ชั่วคราว), `analysis-queue.ts` (runner), `routes/analysis.ts`. Update context, queue, recovery, app, videos/clips/jobs routes, clip-service, pipeline และ detect-hooks/thumbnails steps

Create web components `analysis-controls.tsx`, `analysis-status.tsx`, `score-details.tsx`, `candidate-feedback.tsx`; helpers `lib/analysis-view.ts`, `lib/use-analysis.ts`. Integrate upload-zone, candidate-panel, clip-editor, workspace page, timeline, ui-copy/ui-error; ใช้ primitives เดิม

Shared contracts ที่ Task 1 ต้องส่งมอบ:

- `AnalysisOptions { categories: Category[]; goal: Goal; minDuration: number; maxDuration: number; query: string }`
- `AnalysisSegment { id: number; start: number; end: number; text: string }`
- `AnalysisInput { segments: AnalysisSegment[]; scenes: number[]; duration: number; language: string; options: AnalysisOptions }`
- `HighlightWindow { key: string; start: number; end: number; segmentIds: number[]; source: 'speech'|'scene'; warnings: string[] }`
- `Evidence { code: string; segmentId: number; start: number; end: number; text: string }`
- `Dimensions { hook: number|null; categoryFit: number|null; completeness: number|null; pacing: number|null; goalFit: number|null }`
- `Assessment { schemaVersion: 1; engine: 'rules-v1'; primaryCategory: Category|null; categoryScores: Partial<Record<Category, {score: number; dimensions: Dimensions; evidence: Evidence[]}>>; dimensions: Dimensions; reasons: Evidence[]; warnings: string[]; evidenceLevel: 'limited'|'moderate'|'strong'; suppressedBy: string|null; suppressionReason: 'overlap'|'text'|null }`
- `HighlightResult = HighlightWindow & { score: number|null; assessment: Assessment; rank: number; isPrimary: boolean }`; suppression references use window keys in core and map to candidate UUIDs in persistence
- `FeedbackVerdict = 'good'|'irrelevant'|'starts-mid-thought'|'ends-too-soon'|'duplicate'`
- `AnalysisRunView { id: string; videoId: string; jobId: string; status: 'queued'|'running'|'done'|'failed'|'canceled'; options: AnalysisOptions; engineVersion: string; sourceRevision: string; createdAt: number; completedAt: number|null; error: string|null }`
- `CandidateView { id: string; videoId: string; runId: string|null; start: number; end: number; score: number|null; thumbnailPath: string|null; assessment: Assessment|null; feedback: FeedbackVerdict|null; rank: number|null; isPrimary: boolean }`
- `ClipAssessmentSnapshot { assessment: Assessment; options: AnalysisOptions; runId: string; sourceRevision: string; evaluatedStart: number; evaluatedEnd: number; feedback: FeedbackVerdict|null }`

Server error contract (Task 5): `AnalysisError extends Error { code: 'not-found'|'invalid-options'|'source-not-ready'|'active-job'|'source-changed'|'invalid-state'; jobId?: string }`; route mapping is respectively 404/400/409/409/409/409. Service failures keep human-readable error text on the run. `createAnalysisRun` options are immutable; video.analysisOptionsJson changes only on explicit accepted submission, not passive refresh/history selection.

## Task 1: Profiles, validation and stable contracts

**Files:** Create core analysis-types/profiles and `packages/core/test/analysis-profiles.test.ts`; modify core index.

**Interfaces:** Produce contracts above, `DEFAULT_ANALYSIS_OPTIONS`, `ANALYSIS_PROFILES`, `parseAnalysisOptions(value: unknown): AnalysisOptions` (throws `invalid analysis options`), `getAnalysisCapabilities(language: string): { semantic: false; supportedScoring: boolean }`.

- [ ] Write tests: defaults equal all four categories/balanced/15/60/empty query; each profile's five weights sums to 100; empty/duplicate/unknown categories, NaN/Infinity, 4/181 durations, min>max and 501-character query throw; omitted options use defaults, explicitly malformed options do not silently reset.

  Test `rejects oversized duration without silently resetting`: `expect(() => parseAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, maxDuration: 181 })).toThrow('invalid analysis options')`.
- [ ] Run `bun test packages/core/test/analysis-profiles.test.ts`; expect missing exports initially.
- [ ] Implement enums, readonly profiles, contracts and one validator shared by upload and reanalysis. Length counts Unicode code points; trim query before storage. Do not parse arbitrary natural-language duration instructions in A.
- [ ] Run focused test; expect PASS. Commit only new files and owned index hunks: `feat(core): define highlight analysis profiles`.

## Task 2: Bounded candidate windows

**Files:** Create core analysis-windows and `packages/core/test/analysis-windows.test.ts`; modify index.

**Interfaces:** Consume Task 1; produce `buildHighlightWindows(input: AnalysisInput): HighlightWindow[]`.

- [ ] Write tests: empty input -> []; positive short video below min -> one full-range window with warning; 60-second max including padding never yields 60.1; Thai no punctuation still has valid windows; invalid/nonfinite/reversed source times excluded; a 3-hour fixture retains candidates near beginning/middle/end and <=500 results.

  Test `enforces max after padding`: for each returned window, `expect(window.end - window.start).toBeLessThanOrEqual(60)` and `expect(window.end).toBeLessThanOrEqual(input.duration)` with options.maxDuration=60. A video shorter than the existing 2-second clip minimum may show a suggestion but Add Clip is disabled with a short-video explanation; preserve the existing clip range validation.
- [ ] Run focused file; expect FAIL for missing implementation.
- [ ] Implement sorted/clamped segments and finite scene boundaries, 1.5-second group gaps, ends near min/mid/max targeting actual segment boundaries, 0.25-second start and 0.5-second end padding within budget. Extend to adjacent segment when safe; flag uncertain boundaries. For segments longer than max use constrained windows with explicit cut warning. Include scene-only windows when no speech overlaps.
- [ ] Bound work before materializing all windows: partition duration into 100 equal temporal buckets, keep <=5 starts per bucket with deterministic source-priority then time sampling; expand alternatives within the 500 total budget, then sort by start/end and assign stable keys. Duplicate bounds produce one window.
- [ ] Run focused file; expect PASS. Commit: `feat(core): generate bounded highlight windows`.

## Task 3: Evidence-based multidimensional scoring

**Files:** Create core analysis-signals/score; create `packages/core/test/analysis-score.test.ts` and `packages/core/test/fixtures/analysis.ts`; modify index.

**Interfaces:** Produce `collectSignals(input: AnalysisInput, window: HighlightWindow): Evidence[]`, `scoreHighlight(input: AnalysisInput, window: HighlightWindow): Omit<HighlightResult, 'rank'|'isPrimary'>`.

- [ ] Write table fixtures for 4 categories x th/en with expected dominant category and evidence quote; test “ส่งฟรี” does not also count “ฟรี”, “offer” does not match “coffee”, repeated same phrase does not raise score, NFC equivalents match while stored quote stays original, unsupported language/scene-only score is null. Weighted example: five dimensions all 50 -> total exactly 50 in every category.

  Test `unsupported language preserves absent semantic scores`: `expect(scoreHighlight({ ...input, language: 'ja' }, window).score).toBeNull()` and `expect(scoreHighlight({ ...input, language: 'ja' }, window).assessment.dimensions.hook).toBeNull()`; input/window are valid speech fixtures from this task's fixtures file.
- [ ] Run focused file; expect FAIL.
- [ ] Define versioned signal groups per profile: sales benefit/proof/offer/CTA; podcast question/opinion/experience/answer; education problem/instruction/example/conclusion; story setup/conflict/change/resolution. Add bilingual curated phrases, not a claim of semantic understanding. Normalize NFC/case for matching, keep offsets mapping to original segment text; English word boundaries and Thai Intl.Segmenter when available, longest phrase fallback with overlap suppression.
- [ ] Score bounded groups: categoryFit = 25 per distinct matching profile group (cap 100); hook = 50 per question/problem/urgency/opening group within first 5 seconds (cap 100); completeness = 25 each for clean start, clean end, answer/resolution/conclusion signal, and no cut warning; pacing = round(100 * unionOfSpeechIntervals / windowDuration). Each group counts once across the whole window.
- [ ] goalFit: balanced = categoryFit; sell uses benefit/offer/CTA, teach uses problem/instruction/example, entertain uses conflict/change/resolution, drive-full-video uses question/opinion/experience, each matched group contributes 100/3 capped at 100. A supplied query blends 50% goal score +50% query match coverage; use Intl word tokens for Thai with exact-phrase fallback, excluding spaces/punctuation. Overall score is rounded weighted mean from the category table; ties resolve profile order. No positive category signal means no primary category label even if structural dimensions score.
- [ ] EvidenceLevel: limited for unsupported/no speech/<2 distinct semantic signal groups, moderate for 2–3, strong for >=4; this is evidence coverage only. Reasons pick <=3 real evidence entries. Unsupported language leaves semantic dimensions null and total null; pacing/boundary evidence may remain available. Scene-only dimensions and total null.
- [ ] Run focused test; expect PASS. Commit: `feat(core): score highlights with traceable evidence`.

## Task 4: Duplicate suppression and evaluator composition

**Files:** Create core analysis-dedupe/analyze-highlights and `packages/core/test/analysis-dedupe.test.ts`, `packages/core/test/analyze-highlights.test.ts`; modify index.

**Interfaces:** Produce `rankHighlights(input: AnalysisInput, results: Omit<HighlightResult, 'rank'|'isPrimary'>[]): HighlightResult[]`, `analyzeHighlights(input: AnalysisInput): HighlightResult[]`.

- [ ] Write tests for exact 0.7 overlap, exact 0.8 Jaccard, nonoverlap repeated text, empty text, ties (fewer warnings then earlier start), <=30 primary results, <=500 stored results, and all-null results sorted by time. Verify suppressedBy points to an unsuppressed representative.

  Test `retains hidden results while limiting primary set`: `expect(results.filter(row => row.isPrimary).length).toBeLessThanOrEqual(30)` and `expect(results.length).toBeLessThanOrEqual(500)`; a fixture with 31 distinct nonoverlapping topics must retain 31 rows, one nonprimary without suppressionReason.
- [ ] Run both files; expect FAIL.
- [ ] Implement greedy suppression after ranking, normalized word bigrams for English and character trigrams for Thai, nonempty shingle sets only. Keep all results: first 30 representatives isPrimary=true; remaining representatives isPrimary=false without fake duplicate reason. includeSuppressed UI option shows both duplicates and overflow with distinct labels. Compose windows/signals/score/rank in one evaluator.
- [ ] Run both files and the three preceding core test files together; expect PASS. Commit: `feat(core): rank and deduplicate highlight suggestions`.

## Task 5: Transactional migration and immutable analysis storage

**Files:** Modify db schema/client/index; create migration analysis-v1 and `packages/db/test/analysis-migration.test.ts`; create server analysis-store and `apps/server/test/analysis-store.test.ts`.

**Interfaces:** Produce `loadAnalysisInput(db: DB, videoId: string, options: AnalysisOptions): AnalysisInput`, `sourceRevision(input: AnalysisInput): string`, `createAnalysisRun(db: DB, videoId: string, jobId: string, options: AnalysisOptions): AnalysisRunView`, `publishAnalysisRun(db: DB, runId: string, input: AnalysisInput, rows: PreparedCandidate[]): void`. Define `PreparedCandidate = HighlightResult & { id: string; thumbnailPath: string }` in store; run assignment comes from runId.

- [ ] Write legacy file DB fixtures with candidate score 148, selected clip, edited subtitles and export; migrate, close, reopen and assert all identities/data survive. Insert null candidate score successfully; repeated migration is no-op. Simulate migration failure and assert old table intact.

  Test `preserves legacy scores without normalization`: after two createDb opens, `expect(db.select().from(candidates).get()).toMatchObject({ id: 'legacy-candidate', score: 148, runId: null, assessmentJson: null })`; fixture creates this ID explicitly before migration.
- [ ] Run migration file; expect FAIL.
- [ ] Implement transactional candidates rebuild for nullable score; add nullable runId/assessmentJson, rank, isPrimary(default true), videos.activeAnalysisRunId and analysisOptionsJson, clips.assessmentJson. Create analysis_runs and candidate_feedback with indexes on video/run/status. Preserve legacy whisper_model and every existing column. SQL names and Drizzle declarations must match.
- [ ] Write store tests: revision independent of DB row retrieval order but changes with transcript/text/scenes/options-independent source data; publishing stale snapshot rejects and leaves active ID; publish run A then B retains A candidates and feedback; invalid JSON produces explicit read error, not fabricated assessment.
- [ ] Implement hash from canonical sorted source arrays/duration/language using node:crypto; options stored separately. Publish inserts all candidate rows, maps suppressed keys to IDs, marks run done, and changes active pointer in one transaction after revision/status checks. Never publish canceled/failed runs. Source duration must be finite and >0 or return a typed source-not-ready error.
- [ ] Run migration/store tests; expect PASS. Commit owned changes: `feat(db): persist versioned highlight analysis runs`.

## Task 6: Analysis jobs, staged thumbnails and recovery

**Files:** Create server analysis-service/thumbnails/queue; modify queue/context/recovery/routes/jobs; create `apps/server/test/analysis-service.test.ts`, `apps/server/test/analysis-recovery.test.ts`; update queue tests/helpers as needed.

**Interfaces:** `AnalysisRuntime { evaluate(input: AnalysisInput): Promise<HighlightResult[]>; thumbnails(videoId: string, runId: string, results: HighlightResult[], ctx: JobCtx): Promise<PreparedCandidate[]>; cleanup(videoId: string, runId: string): Promise<void> }`; `runAnalysis(db: DB, runId: string, ctx: JobCtx, runtime?: AnalysisRuntime): Promise<void>`; `makeAnalysisRunner(db: DB, runtime?: AnalysisRuntime): JobRunner`; `Ctx.analysisQueue: JobQueue`. Runtime is injectable and tests never need Whisper/models/FFmpeg.

- [ ] Write tests asserting old active ID survives evaluate failure, thumbnail failure, cancellation before evaluation, cancellation after thumbnails, revision mismatch and publication failure. Spy proves no transcription/audio extraction and video remains ready; ready video stays ready after restart.

  Test `cancel after thumbnails cannot publish`: injected runtime.thumbnails aborts the controller before returning rows; `await expect(runAnalysis(db, runId, ctx, runtime)).rejects.toThrow()` then `expect(db.select().from(videos).get()).toMatchObject({ status: 'ready', activeAnalysisRunId: 'old-run' })`; cleanup spy called once and no candidate row belongs to canceled run.
- [ ] Run service/recovery files; expect FAIL.
- [ ] Implement explicit run queued/running/done/failed/canceled transitions, AbortSignal checks before expensive steps and inside publish transaction, emitting analysis:update with runId/videoId. CPU work is bounded; yield with setImmediate before evaluation and after evaluation to receive cancel requests before thumbnail work/publication.
- [ ] Thumbnail files use `thumbs/<runId>.tmp/` during preparation, then renamed to `thumbs/<runId>/` before publication; store candidate thumbnailPath there and serve by candidate ID lookup rather than constructing legacy flat path. Cleanup removes only unpublished run directories on failure; old published paths stay intact. Preserve extension on tmp images for ffmpeg. Completed publication is commit point: later cancel returns 409 and cannot relabel successful run canceled.
- [ ] Extend JobQueue type union and cancellation lifecycle with terminal check; queued cancellation updates associated run too. Recovery marks stale runs failed/interrupted and removes their staged/final unpublished directories only; never delete published directories or resumable model downloads. Context autoRun:false still disables all queues in tests.
- [ ] Run service/recovery/queue tests; expect PASS. Commit: `feat(server): run cancellable highlight analysis jobs`.

## Task 7: Analysis API, pipeline integration and deletion

**Files:** Create routes/analysis and `apps/server/test/analysis.test.ts`; modify app, routes/videos/clips, pipeline, steps/detect-hooks/thumbnails, test/videos/pipeline/api-contract and test/helpers/app.

**Interfaces:** Routes exactly as spec; `GET /videos/:id/analysis -> { active: AnalysisRunView|null; latest: AnalysisRunView|null; history: AnalysisRunView[] }`; candidates -> CandidateView[] preserving original required fields. Add `enqueueAnalysis(ctx: Ctx, videoId: string, options: AnalysisOptions): {runId: string; jobId: string}` and `assertNoActiveVideoWork(db: DB, videoId: string): void` in analysis-store (typed conflict includes jobId); allow self jobId when initial pipeline creates its internal run.

- [ ] Write `app.handle(new Request('http://x/...'))` tests for 202 success, defaults, 400 invalid options (including Elysia validation response mapping), 404 cross-video run/candidate, 409 concurrent pipeline/analysis, history <=20 with deterministic createdAt/id ordering, and default candidate query excludes nonactive/hidden rows. Test includeSuppressed=true and legacy-only fallback when active ID absent; never expose unpublished runs' candidates.

  Test `rejects run owned by another video`: seed v1/v2 and a completed run `r2` owned by v2; `expect((await app.handle(new Request('http://x/videos/v1/candidates?runId=r2'))).status).toBe(404)`.
- [ ] Run analysis route test; expect FAIL.
- [ ] Implement routes and register app plugin; normalize validation failures to 400 without globally rewriting unrelated API semantics. Feedback upsert/delete verifies video ownership and persists verdict. Profile route returns capabilities/defaults. Upload accepts analysisOptions object for JSON and validated JSON string for multipart before copying media; missing uses defaults. Save options on video for pipeline/retry.
- [ ] Enqueue inside a DB transaction with active-work check and run/job insertion; enqueue to in-memory queue after commit. Reanalysis requires ready video; missing transcript with available scenes is valid. If neither exists allow completed empty result when duration is known.
- [ ] Replace detect-hooks step body with creation/execution of a run through runAnalysis using pipeline job context; it includes thumbnail preparation/publication. Existing thumbnails step becomes a no-op for published new runs and remains legacy repair only when needed, scoped to active results. Prevent unconditional recomputation of a completed internal run on retry. Preserve existing pipeline step labels and public progress events.
- [ ] Remove candidate deletion in full reprocessing; serialize pipeline/analysis starts and retain prior runs. Count only active primary candidates in video detail; select latest pipeline job for pipeline status, not latest analysis/export job. Resolve `/thumb/:file` legacy `<candidateId>.jpg` by verified video-owned candidate thumbnailPath, with flat-path fallback for legacy rows.
- [ ] Write deletion test: an older active analysis/export plus a newer completed job returns 409; after all jobs terminal, deleting video removes run/feedback/candidate data and video media directory, not other videos. Implement check over all active jobs and transactional DB delete with existing filesystem policy.
- [ ] Run analysis/videos/pipeline/api-contract focused tests; expect PASS. Commit owned hunks: `feat(server): expose analysis and integrate highlight pipeline`.

## Task 8: Clip score snapshots and view helpers

**Files:** Modify server clip-service and tests/clips; create web lib/analysis-view and `apps/web/test/analysis-view.test.ts`; update shared Candidate/Clip/Timeline types.

**Interfaces:** `formatAnalysisScore(candidate: Pick<CandidateView,'score'|'assessment'>): string`, `filterCandidates(rows: CandidateView[], filters: {category: Category|null; minScore: number|null; includeSuppressed: boolean}): CandidateView[]`, `isAssessmentStale(snapshot: ClipAssessmentSnapshot, start: number, end: number): boolean` (0.01s tolerance).

- [ ] Write tests: accepted candidate snapshot retains run/options/evidence/feedback after reanalysis and transcript replacement; manual clip snapshot null; changing trim leaves snapshot intact and flags stale. Existing subtitle bounds still use clampToClip.
- [ ] Write view tests: legacy 148 -> “คะแนนระบบเดิม 148”; new 82 -> “82/100”; null -> “ยังประเมินคะแนนไม่ได้”; null scores never coerce to zero; changing category includes matching secondary category; mixed legacy/new results are not normalized together; hidden duplicates and overflow appear only when requested.

  Test `does not misrepresent missing scores`: `expect(formatAnalysisScore({ score: null, assessment: null })).toBe('ยังประเมินคะแนนไม่ได้')`; `expect(formatAnalysisScore({ score: 148, assessment: null })).toBe('คะแนนระบบเดิม 148')`.
- [ ] Run clips/view files; expect FAIL for new behavior.
- [ ] Implement creation snapshot in clip-service, parsed assessment response for clip routes, shared view helpers and nullable score types. UI must treat missing legacy JSON as legacy, invalid new JSON as an error. Add copy distinguishing “คะแนนของช่วงแนะนำเดิม” from score of a currently trimmed clip.
- [ ] Run focused files; expect PASS. Commit: `feat: preserve clip analysis provenance`.

## Task 9: Upload controls, analysis workspace and feedback UI

**Files:** Create web analysis-controls/status/score-details/candidate-feedback, lib/use-analysis; modify upload-zone, candidate-panel, clip-editor, workspace page, ui-copy/ui-error, pipeline-steps if needed; create `apps/web/test/analysis-state.test.ts` and pure `lib/analysis-state.ts` reducer helper.

**Interfaces:** `AnalysisControls({value: AnalysisOptions,onChange:(value:AnalysisOptions)=>void,disabled?:boolean})`; `ScoreDetails({assessment:Assessment})`; `CandidateFeedback({videoId:string,candidate:CandidateView,onSaved:()=>void})`; `useAnalysis(videoId:string)` returns runs/candidates/loading/error/draftOptions/draftDirty/setDraftOptions/reanalyze/cancel/refresh; reducer `reduceAnalysisState(state: AnalysisState, action: AnalysisAction): AnalysisState` owns draft-vs-server and request revision handling.

- [ ] Read `apps/web/AGENTS.md` and installed Next docs `01-app/01-getting-started/05-server-and-client-components.md`, `06-fetching-data.md`, `10-error-handling.md`, plus accessible form conventions from existing components before editing UI.
- [ ] Write state tests: reconnect and terminal job refresh preserve dirty options; video ID switch resets state; late fetch from previous video/run ignored; failed request retains old candidates; changing selected run restores its options only through explicit action. Verify analysis job events don't set full video processing state.

  Reducer actions: `edit-options` carries options; `load-start` carries videoId/requestId; `load-success` carries videoId/requestId/runs/candidates; `load-error` carries videoId/requestId/error; `select-run` carries runId; `restore-options` carries options; `change-video` carries videoId. `AnalysisState` stores videoId, requestId, draftOptions, draftDirty, active/latest/history, selectedRunId, candidates, loading and error. Test `refresh preserves user draft`: after edit-options then matching load-success, `expect(state.draftOptions.query).toBe('มือใหม่')` and `expect(state.draftDirty).toBe(true)`.
- [ ] Run state test; expect FAIL.
- [ ] Implement reducer/hook and reusable controls: 4 category checkboxes with at least one selected, goal select, min/max, 500-codepoint topic field and explicit keyword-match help. Upload sends same options as workspace; defaults come from profiles API rather than duplicated weights.
- [ ] Integrate status + cancel + reanalyze + last-20 history selector; keep previous candidates available during work, show failure inline, prevent repeat submit, refetch on analysis:update/job:update/$reconnect. Unsaved clip navigation guard remains active when switching editor panels; passive refresh never resets editor/draft.
- [ ] Integrate score/details/reasons/evidence timestamps, primary/secondary categories, warnings, legacy/null copy, feedback with change/clear and error state. Filters share data with timeline; load all <=500 candidates once with includeSuppressed=true then filter locally. Disable minScore when scoring unsupported, show duplicate versus overflow labels separately. All controls labeled, focusable, status announced; use existing UI style.
- [ ] Run state/view tests; expect PASS. In running app inspect at mobile 390px and desktop 1280px: default/upload/workspace, details, no results, null/legacy score, keyboard navigation, feedback, reanalysis fail/cancel/history and SSE reconnect. Record screenshots only for changed UI; do not claim checked if runtime unavailable.
- [ ] Commit owned UI changes: `feat(web): add multicategory highlight controls and explanations`.

## Task 10: Integrated acceptance and handoff

**Files:** Create `apps/server/test/analysis-integration.test.ts`; update approved spec/plan checkboxes and repository usage documentation (`README.md` if present) only for shipped behavior.

**Interfaces:** Use public routes + injected AnalysisRuntime + actual in-memory SQLite; no production media or model dependencies in automated fixtures.

- [ ] Add one meaningful integration test covering video -> initial analysis -> accept candidate -> feedback -> change options -> reanalysis -> old clip/snapshot preserved -> cancel next run -> old results still active -> delete removes analysis data. Add unsupported-language/scene-only flow to prove null survives DB/API/UI helper boundaries. Use actual service evaluator with synthetic transcript fixtures, only thumbnail process mocked.

  Test `reanalysis preserves accepted clip provenance`: save returned clip assessment before second run; `expect(reloadedClip.assessment).toEqual(savedAssessment)` and `expect(reloadedClip.candidateId).toBe(originalCandidate.id)` after second run publication; candidate lookup by original run still returns original ID. Clip route serializes DB assessmentJson as `assessment: ClipAssessmentSnapshot|null` alongside existing fields.
- [ ] Run `bun test apps/server/test/analysis-integration.test.ts`; expect PASS after preceding tasks. Fix integration mismatches, not assertions that encode valid user behavior.
- [ ] Run `bun test`, `bun run typecheck`, `bun run --cwd apps/web build` sequentially; expect all exit 0. If ignored emitted tests cause duplicates, remove only generated artifacts proven created by this run. Record preexisting failures separately and investigate any newly introduced failure.
- [ ] Complete UI acceptance from Task 9 and review migrations, job races, unsupported languages, old candidate links and score explanations. Compare baseline diff so no unrelated changes are lost or included in commits. Review Focus's five risks must map to passing focused tests.
- [ ] Document available four categories, scoring limitations, topic keyword matching, history/reanalysis/feedback and B/C remaining scope. Do not claim improved real-world quality without user-authorized media evaluation; report functional test evidence and whether real-media assessment was possible.
- [ ] Commit owned integration/docs changes: `test: cover multicategory analysis lifecycle`. Prepare final report of delivered features, checks and limitations. No merge/deploy requested.

## Execution and review checkpoints

- [x] Spec approval recorded
- [x] Plan maps all project A requirements to Tasks 1–10
- [x] Interfaces, enum values, nullable score flow and failure paths reviewed
- [x] User selects Native execution (option 1)
- [x] Execute Tasks 1–10; evidence and deviations recorded in completion record below

Recommendation: **Native execution** in this session, since tasks share tight core/DB/server/UI interfaces and the checkout contains existing unfinished work. A final independent review follows implementation per executing-plans. If the user selects Subagent-driven, use isolated task ownership and never let concurrent agents edit shared contract/migration files together.

Commit commands during execution must stage only newly created task files and reviewed owned hunks in modified files; do not use `git add .` or whole-file staging on preexisting changed files. When a clean commit cannot separate dependent preexisting work, retain the patch and explain rather than include unrelated changes.

## Completion record — 2026-10-02

Tasks 1–10 implemented in the existing workspace. Historical step checkboxes above remain a planning checklist; this record and the execution ledger describe actual acceptance rather than asserting every proposed manual check was performed.

- Source suites: `bun run test` — 188 pass, 0 fail, 572 expectations across 35 files.
- `bun run typecheck` — exit 0.
- `bun run --cwd apps/web build` — exit 0; sandbox port-binding restriction required an escalated build.
- Isolated synthetic-media browser checks: desktop 1280px/mobile 390px, no horizontal overflow/page errors, controls, reanalysis draft preservation, feedback, acceptance, details, null/legacy scores and upload controls passed. Real-media ranking quality, long-video thumbnail performance and manual browser reconnect timing remain unmeasured.
- Independent review completed; repeated phrase counting, Thai combining marks in deduplication and late-arriving saved options fixed with regression coverage. Additional fixes cover partially overlapping transcript evidence/query signals, long-segment tail windows and blocking job IDs.
- Integration fixtures exercise persistence, cancellation, recovery and provenance. Server and web helper suites remain separate to respect TypeScript project boundaries.
- Planned implementation commits deferred because dependent preexisting changes share files. No merge or deployment performed. Baseline and execution ledger retained under `.superpowers/sdd/2026-10-02-multicategory-highlights/`.
- Project B/C remain future scope.
