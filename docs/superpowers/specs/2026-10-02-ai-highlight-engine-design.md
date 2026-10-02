# ShotPrompt: AI highlight discovery and scoring

Date: 2026-10-02
Status: Written design for user review; implementation has not started.

## Intent and agreed decisions

Replace the category-driven highlight discovery/scoring engine with an AI evaluator that reads subtitle context, proposes useful standalone clips, and explains each result. The user wants varied subjects without selecting a category first, less manual boundary adjustment, and scores supported by actual transcript evidence. Preserve upload, transcription, queues, analysis history, feedback, editing and exports.

The user selected support for both local models accessed through an API and external APIs, with local processing as the default. API protocol and inference location are separate settings: an OpenAI-compatible API can run entirely locally. A local endpoint can itself proxy to a cloud model; ShotPrompt cannot prove where that endpoint performs inference. The UI describes the configured endpoint/location rather than promising verified local execution.

This is project B. Project C (visual events, demonstrations, laughter, sound quality and feedback-trained ranking) remains a separate design. This implementation evaluates transcript content, not factual truth or observed audiovisual performance. Success means functional reliability plus measurable improvement in clip selection on user-approved examples; model access alone does not establish quality.

## Selected architecture and alternatives

Use AI to discover candidates across the full transcript, then evaluate those candidates against a shared rubric. The server validates and ranks results before atomically publishing a completed run.

Alternatives considered: placing AI after the keyword shortlist is cheaper but inherits missed candidates; rebuilding the full application increases migration work without improving discovery. Preserve the existing run lifecycle and replace the evaluator and its data contracts.

Responsibilities:

- Core: versioned options/assessments, chunk construction, segment validation, score calculation, range validation and deterministic ranking/deduplication. These remain pure functions.
- Server: endpoint adapters, prompt templates, request budgets, cancellation, provider configuration, run snapshots, thumbnail generation, publication and credential access.
- DB: compatible options/assessment storage, immutable evaluator metadata and progress. Existing run/candidate/clip IDs remain valid.
- Web: endpoint setup, natural-language instructions, clip titles/summaries/reasons, progress/errors and version-aware history presentation.

Extend `AnalysisRuntime.evaluate` to receive an AbortSignal and a progress callback. Inject the selected runtime into both queue execution and tests; current initial-pipeline wiring must be adapted rather than leaving its evaluator hardcoded to rules. Thumbnails and publication retain the same interface responsibility.

## Provider configuration

Initial adapters:

1. Ollama native: `/api/chat`, non-streaming, JSON schema in `format`.
2. OpenAI-compatible: `/chat/completions` relative to a configured API base such as `/v1`, non-streaming. Schema mode uses `response_format`; JSON mode uses the schema in the prompt and strict server validation for endpoints without schema support.

Settings: protocol, inferenceLocation (`local` or `external`), baseUrl, model, outputMode (`schema` or `json`), externalEnabled, requestTimeoutSeconds (default 120; 10–600), runTimeoutSeconds (default 1800; 60–7200). Run timeout must be at least the request timeout. Default local base URLs are `http://127.0.0.1:11434` for Ollama and `http://127.0.0.1:1234/v1` for compatible servers. The model must be selected explicitly; do not install or download a model automatically or pretend all models have suitable Thai support.

All requests originate on the server. Base URLs must be HTTP(S), without embedded credentials, query or fragment. Requests reject redirects so credentials/transcript cannot silently move to another destination. Local mode accepts loopback/private-network host literals and `localhost`; a custom host or public endpoint requires external mode and explicit externalEnabled. This is a configuration boundary, not proof against a forwarding local server. No arbitrary per-analysis endpoint override.

Read an optional API key from the server environment `SHOTPROMPT_LLM_API_KEY`. Do not put keys in options, SQLite, browser responses, run metadata or logs. Settings show only whether a key is present. Replacing the environment key requires restarting the server. This first version does not add a browser credential vault.

An external configuration is inactive until the user enables external processing in Settings, where the UI explains that subtitle text and analysis instructions are sent to that endpoint. Each run records location/protocol/base URL/model without secrets. No automatic provider switch on failure.

The connection check uses a small synthetic request with no real transcript, verifies structured output and displays a sanitized error if unsupported. Optional model listing is best effort; manual model entry remains possible. Changing protocol, endpoint, model or output mode invalidates the prior check. No availability claim solely from a successful models listing.

Compatibility sources: [Ollama chat](https://docs.ollama.com/api/chat), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility). Compatible endpoints vary; schema mode is tested, not assumed.

## New user flow

Analysis options schema v2: `{ schemaVersion: 2, minDuration, maxDuration, instruction, maxClips }`. Defaults: 15–60 seconds, empty instruction, 10 primary clips. Durations remain finite 5–180 seconds with min <= max. Instruction is optional, trimmed, at most 500 Unicode codepoints. maxClips is an integer 1–30.

An empty instruction asks for engaging, useful, self-contained highlights appropriate to the content. An instruction such as “mistakes beginners make” affects semantic relevance even if those words do not appear verbatim. It is user intent, not a system prompt override. Categories and fixed goals are removed from the new controls; AI tags are optional output metadata and never gate discovery.

Settings configure/test the endpoint. Upload and workspace share the new controls. With a configured endpoint, a completed transcription/media pipeline schedules a separate analysis job automatically. Without one, the video still becomes ready and presents a setup action; transcription/editing/export remain usable.

New uploads no longer run AI in `detect-hooks`. Preserve reading old pipeline steps/history; new pipeline processing marks legacy highlight/thumbnail stages as skipped or treats them as compatibility no-ops. Schedule analysis only after the pipeline job is stored as done, checking for active video work in the transaction. Reanalysis uses the same enqueue path. Retry of an old pipeline must not publish a second rules result or destroy active results. A failure in AI analysis leaves the prepared video ready.

An AI failure shows the failed run alongside the previous active results. No silent rules fallback or cloud fallback. The rules evaluator remains readable for historical runs and available internally for comparison fixtures; a second public rules-mode UI is outside this scope.

## Discovery, validation and scoring

### Stage 1: transcript coverage and candidate discovery

Use stable segment IDs and chronological ordering. Every nonempty segment belongs to one core chunk; adjacent chunks add shared context. Do not shortlist with keywords, fixed categories or existing rules scores.

Initial budgets: core chunks at most 8,000 Unicode codepoints of serialized segment content, adjacent context up to 2,000 on each side, maximum 40 chunks. Include full segment records; do not silently truncate a segment or omit a tail. If a single record, required context or overall transcript exceeds supported limits, fail with `input-too-large` and a clear explanation. Character budgets bound payload size, not exact model token count; a model context rejection is a distinct actionable failure.

Each chunk proposes 0–3 candidates with startSegmentId/endSegmentId, a provisional title, and evidence IDs. It distinguishes `analyzed` from `unsupported-language` or `insufficient-transcript`; an inability to interpret the input is not an empty successful recommendation. Candidate midpoint must lie in that chunk's core range, avoiding repeated proposals caused by context overlap. A proposal may span into its shared context. The discovery response also reports whether more context is needed at a boundary; allow one bounded adjacent-context discovery request per affected boundary, subject to the overall call limit. If that required context cannot fit, fail rather than claiming complete boundary coverage. This handles ordinary boundary crossings but cannot guarantee finding every highlight.

Deduplicate identical proposed segment ranges before evaluation; maximum 120 unique proposals including boundary requests. If over budget, fail explicitly instead of privileging the beginning of the video or pre-ranking by keywords. Empty proposals from all successfully analyzed chunks can produce a completed empty result, with the explanation that no suitable transcript-based clips were found. A reported inability to analyze any chunk fails the run with an actionable explanation, preserving the previous active result.

### Stage 2: evaluate and refine

Provide the proposed range and nearby original segments, including up to maxDuration of speech context before and after where it fits the request budget. The model may refine boundaries to supplied segment IDs and must explain any outside-context dependency. Evaluation requests contain at most 4 candidates and 16,000 serialized payload codepoints; split batches when needed. If one candidate plus necessary context cannot fit, fail explicitly.

The result contains title (<=120 codepoints), summary (<=600), up to 5 short topic tags (<=40 each), final start/end IDs, five dimension scores, up to 3 reasons linked to evidence IDs, and boundary/context warnings. Titles, summaries and explanations use Thai for the current UI; quoted evidence preserves the original language. Summaries describe the selected content without inventing facts or claiming its statements have been verified. Zero or more proposals may be rejected with a supported reason. A valid zero-result response is not a parsing error.

Use rubric `clip-content-v1`. Each dimension is an integer 0–5 with described anchors: 0 absent/unsuitable, 1 weak, 2 limited, 3 usable, 4 strong, 5 exceptional within the source. Every nonzero dimension needs at least one evidence reference. Dimensions and weights:

| Dimension | Weight | Meaning |
| --- | --- | --- |
| opening | 20% | A clear reason to keep watching appears early in the selected text |
| standalone | 25% | Understandable without omitted questions, definitions or setup |
| substance | 25% | A useful insight, concrete example, story development or interesting payoff |
| closure | 20% | The chosen span completes its point or a coherent narrative beat |
| relevance | 10% | Fits the user's instruction; otherwise fits the default highlight objective |

The server computes `round(sum(score / 5 * weight))`; it ignores any model-supplied total or rank. Score is an editorial estimate for sorting within that run, not confidence, virality probability, factual correctness or a directly comparable metric across models/videos. Model-generated tags do not influence weights.

The same model may perform both stages with distinct prompts; two calls are not independent verification. Temperature 0 is requested where supported, without claiming deterministic model output. Final order: total descending, fewer boundary warnings, chronological start, then stable key. The shared rubric enables cross-chunk ordering; calibrating it requires real examples.

### Server validation and ranking

Validate complete schemas, finite scores, string limits, known supplied segment IDs and chronological ranges. Evidence must be within the final clip and refer to original nonempty text. Build quoted evidence from server-side segments rather than trusting generated quotes. Structural grounding does not prove the interpretation is correct.

Derive timestamps from segment boundaries; clamp only padding to source duration and maxDuration. Never accept arbitrary generated seconds. If a requested span cannot meet duration limits without cutting a segment, reject it; do not silently change its assessed text. A source shorter than minDuration may use the full available span with a short-source warning. Oversized segments without word timings cannot be clipped precisely by this engine.

Reduce overlap at the existing 0.7 overlap/shorter threshold. Keep Unicode-preserving text deduplication for near-identical speech. During evaluation, an optional duplicateOf reference may identify repeated ideas; both proposal IDs must exist and each must have evidence. Treat it as a model interpretation displayed separately from deterministic overlap/text suppression. Resolve groups without cycles, retaining the highest-ranked representative and preserving suppressed candidates. Do not add an embedding dependency in this version.

Retain all evaluated accepted candidates (<=120), with maxClips primary and explicit overlap/text/semantic/overflow suppression. Models never need to fill a quota with weak clips. Rank all accepted candidates before selecting primary results.

## Failure handling and execution budgets

Maximum 160 model requests per run including boundary requests and repair attempts; one active analysis request at a time per server to fit a local runtime. The existing analysis queue serializes runs; pipeline completion schedules work rather than independently running an evaluator.

AbortSignal reaches fetch, response-body reading and every stage. Request/run deadlines are enforced without waiting for all batches. Canceling HTTP cannot guarantee a remote/local model server stops inference; ShotPrompt stops further requests and publication. Timeout and cancellation preserve previous active results and clean unpublished thumbnails.

Permit one schema/ID repair attempt per failed model response, sending bounded validation errors and the same supplied evidence. A second invalid response fails the run. Do not retry authentication, unavailable model, context-size errors or unsupported schema options indefinitely. Sanitized errors distinguish unavailable provider, credentials, timeout, context/input limits, invalid output and rate limits. Never copy raw upstream headers/bodies or secrets to client errors.

All chunk requests must complete successfully before publication. Do not publish a partial video analysis or pretend failed chunks were reviewed. Progress stores stage, completed/total work items, request count and elapsed time; announce progress through `analysis:update`. Counters reset per stage; do not display them as a calibrated total percentage or ETA.

Transcripts are untrusted data. Prompts delimit them as source content; models have no tool access, cannot select an endpoint, execute code or overwrite settings. Schema/evidence validation still applies when a subtitle asks the model to ignore instructions.

## Versioned persistence and compatibility

Keep rules options/assessments as schema v1 and add AI schema v2 as a discriminated union. Introduce a separate normalized UI view rather than casting v1 JSON to v2. Parse legacy missing schemaVersion as v1; do not reinterpret existing scores or migrate old clips into AI claims. Old history restores v1 options for display; a button “use for AI analysis” explicitly maps query to instruction and min/max to new options, dropping category weights/goals with a visible note.

New AI assessments include engine `llm-v1`, title/summary/tags, five dimensions, reasons/evidence, warnings and suppression metadata. Clip snapshots keep the complete assessment, evaluated boundaries, original options, source revision and evaluator metadata at acceptance. Trimmed clips show that the score describes the original suggestion.

Add nullable run fields for evaluator metadata JSON and progress JSON using an idempotent transactional migration. Metadata snapshots protocol, inferenceLocation, endpoint, requested model, response-reported model when available, engine/prompt/rubric versions, output mode, deadlines/budgets, request/token usage when provided and elapsed duration. Missing usage stays null, not zero. No invented monetary cost. Metadata cannot contain keys. Settings changes after enqueue do not change that run's evaluator snapshot; credentials are resolved at execution and not snapshotted.

Candidate rows already support nullable scores and assessment JSON; no destructive candidate table rewrite is needed. A transcript-empty/scene-only source returns scene-based suggestions with null semantic scores and an explicit unavailable-content warning, without sending an empty transcript to the model. AI language capability is unverified until evaluated; do not impose rules-v1's Thai/English keyword restriction on other languages or claim all languages equally accurate.

Initial upload and reanalysis keep revision checks, video ownership checks, mutual exclusion, atomic thumbnail publication, cancellation/restart recovery and deletion ordering. Old candidates and accepted clip IDs remain accessible. Recovery marks interrupted runs failed and preserves published results. Run metadata shown in the UI omits credential material.

## API and UI changes

- `GET/PUT /settings/analysis`: public configuration fields and key-present boolean; validate location/protocol/URL/limits. External mode requires externalEnabled.
- `POST /settings/analysis/check`: synthetic structured-output check of the saved configuration; sanitized capabilities/errors, no transcript.
- `GET /analysis/profiles`: version-aware capabilities/defaults; retain legacy profile data for historical views and add the AI option/rubric metadata. Do not advertise semantic readiness without configured settings.
- `POST /videos/:id/analysis`: accepts options v2 for new AI runs; same 202 runId/jobId response. Wrong options ->400, absent/unusable configuration ->409, conflicting work ->409 with jobId.
- `GET /videos/:id/analysis`: retain active/latest/history and add nullable evaluator/progress metadata. Candidates and clip API expose v1/v2 assessments; array/list ownership behavior stays compatible.
- Existing cancel and feedback routes keep their contracts. Legacy clients can still read old records; new run requests with v1 options return an actionable unsupported-options response rather than silently running AI with category weights.

Workspace/upload controls show duration, optional instruction and desired clip count. Candidate cards show title, summary, time, /100 score or explicit unavailable state, tags, reasons, expandable rubric/evidence and seek links. History identifies AI versus rules, model and rubric versions. Failures offer retry/configuration actions while old results remain visible. Draft options and the existing unsaved clip guard survive passive refresh/history changes.

Settings distinguish API format from configured inference location and explain that a local server may forward requests. Browser never contacts the model endpoint or receives an API key. Responsive, labeled controls and announced statuses follow the existing UI patterns.

## Acceptance evidence

Automated behavior checks must cover:

- Full transcript coverage, tail chunks, overlapping context and boundary discovery budgets; no keyword gate.
- Thai/English fixtures plus another language contract fixture without asserting model language quality.
- Invalid IDs, out-of-range evidence, reversed spans, oversized content, nonfinite scores, repaired and unrepaired responses, empty results, prompt-injection text, duration limits and deterministic totals/ties.
- Protocol request/response contracts using fixture HTTP servers; schema/JSON modes, synthetic check, credentials kept server-side, rejected redirects and external opt-in.
- Abort/deadline propagation, budget limits, provider errors, draft preservation, configuration snapshots, history v1/v2, clip snapshots, pipeline readiness when AI is absent/fails, restart and atomic publication.
- Isolated browser checks for provider setup, instructions, results, evidence seeking, history, failure/cancel, null/legacy records and desktop/mobile presentation.

Run focused suites, workspace source suites, typecheck and production build. Preserve existing dirty work; commits stage only owned new files/reviewed hunks. Do not use generated fixtures as proof of ranking quality.

Real-model acceptance requires the user's configured endpoint/model and user-approved transcripts. Compare the original rules engine and AI on the same diverse sources: record useful clips among top five, start/end edits in seconds, selection time, repeat/missed-context errors, latency and resource usage. Keep a separate held-out group when tuning prompts. Review score-order consistency and blind human preference; no universal accuracy target is invented without a labeled dataset. If no endpoint is available, deliver adapter/fixture/browser evidence and explicitly report real-model quality as unverified.

## Review checkpoints

- [x] User approved the AI discovery direction and preservation of the existing application foundation.
- [x] User chose support for local API models and external endpoints (option 1).
- [x] Read current evaluator, API, options, migrations, pipeline integration and web controls.
- [x] Written spec reviewed for scope, budgets, compatibility and failure paths.
- [ ] User reviews and approves this written spec.
- [ ] Write implementation plan and select execution method.
- [ ] Implement and verify project B.
- [ ] Design project C separately.
