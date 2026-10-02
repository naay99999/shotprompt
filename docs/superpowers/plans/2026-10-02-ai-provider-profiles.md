# AI Provider Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure, test and switch saved AI connections entirely through the UI, with first-class OpenRouter model discovery and separate encrypted keys.

**Architecture:** A pure preset/profile contract layer feeds a server profile service, credential vault and model catalog service. Existing inference transports receive provider identity and resolved credentials; queued runs capture nonsecret connection identity/config. A guided Settings editor manages drafts/models/tests independently from activation.

**Tech Stack:** Bun, TypeScript, Elysia, SQLite/Drizzle, Node crypto/fs APIs, Next.js/React, existing styling and bun:test; no new provider SDK or OS keychain dependency.

**Spec:** `docs/superpowers/specs/2026-10-02-ai-provider-profiles-design.md` (user approved: “ok implement”).

## Global Constraints

- Preserve existing upload/transcription, AI rubric/discovery, queues, history, feedback, editor/exports and legacy snapshots. No project C, OAuth/native Anthropic/Azure adapters or automatic model/provider failover.
- Native execution in the existing non-main checkout: capture a fresh baseline of dirty project A/B and unrelated changes; do not stage them together. Independent final review compares against that baseline. Defer unsafe dependent commits with an explicit ledger ruling.
- Five presets: OpenRouter, Gemini, Ollama, Local OpenAI-compatible, Custom. Maximum 20 profiles; names 1–80 Unicode codepoints. Drafts allow empty model/key; runtime requires complete config, matching successful check and external transcript opt-in.
- Retain duration/options schema2 and existing provider limits: request timeout120s (10–600), run timeout1800s (60–7200), run>=request. Preset cloud URLs fixed; changing destination converts to Custom and requires credential replacement/removal.
- Key max4096 UTF-8 bytes, nonempty after trimming, no CR/LF. Explicit keep/replace/remove; no saved key reveal or browser persistence. AES-256-GCM; secret master32bytes outside DB at data/secrets/ai-vault.key; Unix0700/0600; exclusive creation/regular file/no symlinks; missing master with credential rows fails closed.
- Catalog max3000 normalized entries,4MiB response limit,15s overall deadline,5-minute per-revision in-memory cache. Manual model input always available; unknown/zero/truncated/stale metadata truthful.
- Connection test one synthetic scoring-shaped request, <=1024 output tokens, no transcript/repair. OpenRouter schema requests require provider.require_parameters:true; mode/model never silently changed.
- Block destination/credential edits and deletion while profile referenced by queued/running analysis. Other edits invalidate new revision/check; queued config fixed. Profile active pointer only activated after matching check; unverified active edits disable new analysis.
- New outbound/mutation routes validate local web Origin (127.0.0.1:3000/localhost:3000; absent Origin allowed for CLI/tests; null/foreign rejected) and JSON request bodies. Existing loopback binding remains.
- UI/error copy Thai, existing two-space TypeScript style; read apps/web/AGENTS.md and installed Next fetch/forms docs before implementation. No API key/ciphertext in DTOs/logs/SSE/history/error bodies.

## Review Focus

1. A secret keyed to one destination must never be sent after preset/base changes, including global env fallback: Task3/6 tests destination changes and explicit binding.
2. Concurrent edit during catalog/check/activation/enqueue must not activate stale settings or overwrite an edited draft: Task5/7 tests late responses/revision transactions.
3. Missing/corrupted vault or migration must preserve media/history and avoid regenerating master/duplicate legacy profiles: Task2/3/9 tests failure/idempotency.
4. Model catalog unknown prices/schema support, truncated pages and failure must preserve manual selection, distinguish zero and not imply compatibility: Task4/7/8 tests metadata and fallback.
5. Queued runs and accepted clips must retain the original provider/config/key association when another profile is activated or current model edited: Task6/9 tests lifecycle/provenance.

## File ownership map

- Core: new `ai-provider-types.ts`, `ai-provider-presets.ts`; extend `ai-analysis-types.ts` and exports. Pure DTOs/defaults/parsers.
- DB: new `migrations/ai-credentials.ts`; extend schema/client. Encrypted rows only.
- Server AI: new `credential-vault.ts`, `provider-profiles.ts`, `provider-catalog.ts`, `provider-check.ts`; extend provider settings/client. Separate persistence/secret/catalog/probe responsibilities.
- Server integration: existing settings routes, analysis enqueue/service/queue/context and profile metadata display; preserve old snapshot path.
- Web: new `provider-profile-state.ts`, `use-provider-profiles.ts`, `provider-profile-editor.tsx`, `provider-model-picker.tsx`; replace current settings panel composition. Existing defaults indicators/error mapping/navigation guard reused.
- Tests sit in each package's test directory; new integration helper files under server/test/helpers. Fixture secrets/media/vault live only in isolated temp directories.

## Task 1: Pure preset/profile/catalog contracts

**Files:** Create core `src/ai-provider-types.ts`, `src/ai-provider-presets.ts`, `test/ai-provider-contracts.test.ts`; modify core index/ai-analysis-types.

**Interfaces:** Define ProviderPresetId='openrouter'|'gemini'|'ollama'|'local-compatible'|'custom'; CredentialMode='none'|'stored'|'legacy-env'; CredentialOperation={action:'keep'|'remove'}|{action:'replace',key:string}. Define ProfileDraft={name,presetId,config:ProviderConfig}, ProfileWrite={expectedRevision?:number,draft:ProfileDraft,credential:CredentialOperation}. ProviderProfile has id/revision/draft fields/credentialMode/credentialVersion:string|null/timestamps/check:ProfileCheck|null. ProfileView omits credentialVersion and adds keyPresent/vaultAvailable. ProfileCheck={fingerprint,revision,status:'ready'|'failed',checkedAt,errorCode:string|null}; ProviderRegistry={schemaVersion:1,activeProfileId:string|null,profiles:ProviderProfile[]}. ConnectionSnapshot={profileId,profileName,presetId,profileRevision,credentialMode,credentialVersion}; EvaluatorSnapshot.connection?:ConnectionSnapshot. ModelCatalogEntry={id,name,contextLength:number|null,inputUsdPerMillion:number|null,outputUsdPerMillion:number|null,textCapability:'supported'|'unknown',schemaSupport:'supported'|'unsupported'|'unknown'}; ModelCatalog={entries,fetchedAt,truncated,stale,errorCode?:string}. Export getProviderPresets(), createProfileDraft(presetId):ProfileDraft, parseProfileWrite(value):ProfileWrite, validateRuntimeProfile(profile):ProviderConfig. Runtime endpoint validator remains shared with existing provider-settings behavior; draft validator permits absent model/external opt-in but never invalid destination/limits.

- [x] Write contract tests with table-driven exact preset URLs/protocols; `expect(createProfileDraft('openrouter').config.baseUrl).toBe('https://openrouter.ai/api/v1')`; `expect(parseProfileWrite({draft:emptyModelDraft,credential:{action:'keep'}}).draft.config.model).toBe('')`; reject81-codepoint names,4097byte/CRLF keys, unknown presets, credential-bearing URLs/public-local URLs and timeout inversion. `validateRuntimeProfile` rejects missing model/cloud key/opt-in.
- [x] Run `bun test packages/core/test/ai-provider-contracts.test.ts`; expect FAIL for missing contracts.
- [x] Implement pure contracts/presets/parsers; fixed cloud destinations, no unknown secret fields copied into configs; no global environment dependency. Config optional provider identity for compatible transport is `presetId?:ProviderPresetId`; older configs lack it.
- [x] Run focused contracts plus `bun test packages/core/test/ai-analysis-contracts.test.ts`; expect PASS with unchanged v2/legacy options.
- [ ] Commit safely owned files: `feat(core): define AI connection profiles`.

## Task 2: Encrypted credential storage and DB migration

**Files:** Create DB migration/test `ai-credentials.ts`/`ai-credentials.test.ts`; modify schema/client; create server `ai/credential-vault.ts`, `test/credential-vault.test.ts`.

**Interfaces:** DB table ai_credentials exported as aiCredentials: id TEXT PK,profileId TEXT,version INTEGER=1,ciphertext TEXT,nonce TEXT,authTag TEXT,createdAt INTEGER. CredentialScope={profileId,credentialVersion,protocol,baseUrl}; EncryptedCredential={ciphertext,nonce,authTag,version:1}. createCredentialVault({secretsDir,hasCredentials:()=>boolean}):CredentialVault with encrypt(scope,key):EncryptedCredential, decrypt(scope,cipher):string, available():boolean. Errors sanitized credential-vault-unavailable. Store functions belong to Task3, vault only crypto/files.

- [x] Write tests using isolated temp directories: encrypt/decrypt roundtrip; ciphertext differs on same key; `expect(JSON.stringify(cipher)).not.toContain(secret)`; wrong scope/tampered cipher fails; persisted master is32bytes and Unix mode0600; parallel first creation reuses winner; symlink/invalid master refused; removing master when hasCredentials=true never creates another file. DB migration twice retains old rows/scores148 and creates encrypted table once.
- [x] Run `bun test packages/db/test/ai-credentials.test.ts apps/server/test/credential-vault.test.ts`; expect FAIL missing migration/vault.
- [x] Implement idempotent migration, AES-256-GCM with12-byte nonce/16-byte tag and stable JSON AAD scope; master exclusive write, directory/file checks and memory lifetime. Do not name persistent master *.tmp (startup recovery sweeps temporary files). Fail closed on inaccessible/corrupt master.
- [x] Rerun focused plus existing DB migration suites; expect PASS.
- [ ] Commit only owned files/hunks: `feat(server): encrypt saved AI credentials`.

## Task 3: Profile persistence, migration and transactional guards

**Files:** Create `server/src/ai/provider-profiles.ts`, `test/provider-profiles.test.ts`; modify provider-settings for compatibility; add injected vault/service dependency to context/test helpers as needed.

**Interfaces:** createProfileService(db,vault,{legacyKey:()=>string|undefined,now?:()=>number}):ProfileService. Methods migrateLegacy():void; list():{schemaVersion:1,activeProfileId,profiles:ProfileView[],migrationNotice:boolean}; create(write):ProfileView; update(id,write):ProfileView; remove(id,expectedRevision):void; get(id):ProviderProfile; resolveCredential(snapshot:EvaluatorSnapshot):string|undefined; fingerprint(profile):string; recordCheck(id,expectedRevision,check):ProfileView; activate(id:string|null,expectedRevision?:number):void; activeReady():ProviderProfile|null; snapshot(profile):ConnectionSnapshot. All credentials via explicit operations; migration registry key='analysisProviderProfiles', never revive when key exists. New secret updates bump revision/version UUID; metadata updates preserve existing credential version.

- [ ] Write DB-backed tests: create20/draft permitted then21st rejected; keep blank key preserves encrypted row; replace/remove transactional; responses contain neither secret nor ciphertext; wrong expected revision409; old config imports exactly once and env secret never copied; deleted legacy profile not resurrected; migration default selected but unavailable until check; malformed config empty registry. `expect(resolveCredential(snapshotForA)).toBe(keyA)` after default B; no env fallback for new profile; preset/destination changes require replacement/removal. Live referenced run blocks credential/destination/delete but allows model edit with old snapshot unchanged; name/edit invalidates new check; absent master preserves registry/history.
- [ ] Run `bun test apps/server/test/provider-profiles.test.ts`; expect FAIL missing service.
- [ ] Implement registry CRUD, one DB transaction per mutation/activation, ciphertext rows, exact AAD binding, current revision+credential fingerprint (stored version UUID; legacy-env key contributes only inside the combined SHA-256 fingerprint so environment rotation invalidates checks without exposing a standalone key hash); validate credential/key presence from actual vault/env. Live-use scans queued/running analysis snapshot connection profileId. Update legacy save/read helpers as adapters, preserving old fixture creation behind explicit test/setup helpers rather than a second authoritative legacy setting.
- [ ] Run focused profile/settings/migration tests; expect PASS, updating legacy tests to intentional migration+verification expectations rather than deleting coverage.
- [ ] Commit safely separable changes: `feat(server): manage saved AI connection profiles`.

## Task 4: Provider model catalogs and OpenRouter inference behavior

**Files:** Create `ai/provider-catalog.ts`, `test/provider-catalog.test.ts`; modify provider-client; extend analysis-provider tests.

**Interfaces:** createModelCatalogService(profiles,{fetch?:typeof fetch,now?:()=>number}):{load(id:string,expectedRevision:number,refresh?:boolean):Promise<ModelCatalog>}; clear(id):void. Catalog metadata normalized via exported normalizeModelCatalog(presetId,value):ModelCatalogEntry[]. Uses profile credential at saved destination only. ProviderClient accepts nonsecret presetId optional and explicit apiKey resolver; request builders unchanged except OpenRouter provider.require_parameters when schema.

- [ ] Write real localhost HTTP fixtures for Ollama tags/compatible models/Gemini-shaped IDs/OpenRouter prices+support. `expect(normalizePrice('0.000002')).toBe(2)` via normalized entry; explicit0 stays0; unknown/NaN/negative becomesnull; no text output filtered for OpenRouter. Test absent support unknown,4MiB oversize/deadline/redirect failure, pagination cap3000 marked truncated,5min cache isolate profile/credential revision, late edit stale revision, catalog errors preserve cached stale data. Transport fixture asserts require_parameters=true only openrouter schema, absent custom/old/schemaJSON requests;402→provider-credits; raw provider errors/echoed secret never returned.
- [ ] Run `bun test apps/server/test/provider-catalog.test.ts apps/server/test/analysis-provider.test.ts`; expect new assertions FAIL.
- [ ] Implement bounded server catalog requests (15s overall across pages,4MiB per response,3000 total entries, max10 pages to bound empty-page loops),5-minute in-memory cache/coalescing and explicit truncated flag. A stale cached response carries sanitized errorCode so UI can show the failed refresh; without cached entries reject with a sanitized error. Normalize endpoints/providers faithfully; current entries manual fallback. Extend compatible client with OpenRouter routing and sanitized402 mapping; no redirects/fallback model lists.
- [ ] Rerun focused catalog/transport tests; expect PASS.
- [ ] Commit owned files/hunks: `feat(server): discover AI models and support OpenRouter routing`.

## Task 5: Scoring-shaped connection check and profile API

**Files:** Create `ai/provider-check.ts`, `test/provider-profile-routes.test.ts`; modify routes/analysis-settings and app registration; extend settings tests.

**Interfaces:** checkSavedProfile(profiles,id,expectedRevision,{clientFactory?:...}):Promise<ProfileView> consumes snapshot/get/fingerprint/recordCheck. Server probe uses schema reduced from real scoring response: results array max2 with accepted/rejected union, five0–5 integer evidence dimensions, nullable duplicateOf, IDs from a tiny synthetic2-segment input; expected one accepted grounded row over synthetic segments IDs1/2 at0–20/20–40seconds, language th and default v2 options; dimensions/evidence are required, no real source text. Validate with existing parseEvaluationResponse then compute score, without publication; max1024 tokens/one request. New API paths exactly spec; JSON DTOs ProfileWrite, {expectedRevision,refresh?} catalogs/check, {profileId:string|null,expectedRevision?} active, expectedRevision query on DELETE.

- [ ] Write route tests via app.handle Requests: cloud draft save without model/key permitted,200/201 redacted,409 missing/revision conflict, explicit credentials, check passes scoring-shaped fixture then activation succeeds; `{ok:true}` probe fails; failed recheck replaces success; late edit during check cannot write/activate stale check; GET legacy projection onlyready default, no active oldwrites409; oldwrites never bypass revision/live guards. Foreign/null Origin403 on new mutate/check/catalog, absent/local accepted; invalid media type415; secret-bearing errors sanitized. A model supports simple JSON but not nested schema test must not activate.
- [ ] Run `bun test apps/server/test/provider-profile-routes.test.ts`; expect FAIL missing routes/probe.
- [ ] Implement profile endpoints, redacted serializers/error status mapping, Origin/body guards before mutation/outbound requests, synthetic check, atomic activation and legacy projections. Check current revision/fingerprint after await; include tiny-provider-charge copy in UI Task8. Map404 profile missing,400 invalid input,409 stale/in-use/not-ready,503 vault failures, while provider probe failures are redacted check status.
- [ ] Rerun focused routes/provider/settings tests; expect PASS.
- [ ] Commit safe changes: `feat(server): expose guided AI connection setup API`.

## Task 6: Queue credential resolution and nonsecret provenance

**Files:** Modify analysis-enqueue/service/queue/context/provider-settings; create `test/provider-profile-analysis.test.ts`; update pipeline/analysis route fixtures and clip snapshots only additive metadata handling.

**Interfaces:** createProfileAnalysisRuntime(db,profiles):AnalysisRuntime reuses default thumbnails/cleanup and evaluateAiHighlights with explicitly resolved key. makeAnalysisRunner accepts injected runtime unchanged; createCtx constructs profile service before queue runtime. enqueue uses profiles.activeReady() plus profiles.snapshot() inside its existing transaction. Old snapshots without connection continue legacy env path; new snapshot without accessible bound credential fails closed with provider-credentials/vault error. Provider profiles getter remains authoritative for compatible GET/analysis/profiles configured status.

- [ ] Write queue tests: firstA queued then activateB => old HTTP uses A key/model, next B; A model edited while pending uses original config; key/destination edits blocked while live; current env unrelated key never applied to new keyless local/custom; encrypted keys absent from runs/clips/SSE/DTOs; deleting completedA leaves history readable. Unverified default means video media ready/manual editing and autoAI skipped; manual analysis409 setup notice. Legacy snapshots continue with original base/env; errors retain prior active result. Restart recovery terminates live runs then permits key replacement/delete.
- [ ] Run `bun test apps/server/test/provider-profile-analysis.test.ts`; expect FAIL new snapshot/resolver behavior.
- [ ] Implement profile-aware runtime factory/context/enqueue and configured projection; snapshot config/identity copied, credentials resolved from matching scope/version; queue destination/credential guards share transaction with enqueue. Preserve run deadlines/atomic publication/cancellation. Do not widen public options or put raw secrets in EvaluationContext.
- [ ] Rerun profile analysis plus existing AI lifecycle/pipeline/snapshot suites; expect PASS.
- [ ] Commit safe hunks: `feat(server): bind AI jobs to saved connection profiles`.

## Task 7: Web profile draft/catalog state and API hook

**Files:** Create web lib `provider-profile-state.ts`,`use-provider-profiles.ts`, test `provider-profile-state.test.ts`; adapt old analysis-settings-state/use-analysis-settings as necessary, removing redundant authoritative hooks after consumers moved.

**Interfaces:** ProviderEditorState={profileId,expectedRevision,draft,credentialOperation,typedKey,dirty,editVersion,requestSerial,loading/check/catalog/errors}; reduceProfileEditor(state,action):state. Every async request carries profileId/revision/editVersion/requestSerial. useProviderProfiles exposes list/presets/activeProfileId, editor/openNew/openEdit/close/edit/save/loadModels/check/activate/remove, busy states and sanitized errors; catalog client filtering via filterModels(entries,query,schemaOnly). Save first before models/check, explicit activation only; API key only in replace write.

- [ ] Read installed Next App Router fetch/forms docs and navigation-guard usage, then write tests: late list/catalog/check/save cannot replace newer edited form or another selected profile; manual model survives catalog failure/truncation; replacing provider clears typed key/selection and saved-key association, URL override converts custom; blank key=>keep, explicitremove=>remove; close/save clears typed key; stale price/support remains labeled; unknown not filtered as supported; query matches Unicode model name/ID. Editing invalidates check, activation does not silently save drafts.
- [ ] Run `bun test apps/web/test/provider-profile-state.test.ts`; expect FAIL missing reducer/contracts.
- [ ] Implement reducer/hook with edit versions and cancellation/response guards, memory-only drafts/keys, saved revision catalog/check actions, separate busy/error states. Reuse existing API typed client/navigation guard, no direct browser provider fetch.
- [ ] Run web profile state and existing analysis state/error tests; expect PASS.
- [ ] Commit safe owned files: `feat(web): manage AI connection drafts and model selection`.

## Task 8: Guided Settings and current-provider indicators

**Files:** Create `components/provider-profile-editor.tsx`,`provider-model-picker.tsx`; replace composition of analysis-settings; modify settings page, upload-zone/candidate-panel/status displays and ui-error/ui-copy; extend ui-error tests.

**Interfaces:** Editor/picker consume Task7 hook and normalized core DTOs. Five-stage same-page editor: provider/name → password key → save/load and choose model → synthetic test → explicit default activation. Profile list has active/verified/unverified/unavailable-vault badges and Edit/Use/Delete; active display derives from registry, history display solely snapshot.

- [ ] Add Thai error assertions for credits/key/vault/in-use/stale/unsupported schema, and view helper assertions for unknown price vs0. Add observable browser checklist for OpenRouter model search/manual fallback, failedcheck/noactivation, keyclear/replace/remove, activeprofile switching, migration banner, dirty leave guard and hidden Advanced controls.
- [ ] Run focused web tests; expect FAIL new error/view helper mappings.
- [ ] Implement accessible labeled controls with keyboard model search, metadata/reference price display, external consent and key-management links; no saved-key reveal, no falsely successful check after edit. Advanced URL changes reset destination credential association. Delete uses reviewable confirmation; in-use edits explain wait/cancel. Show selected unverified default/setup notice while keeping media/manual editing available. Reuse established styling; no new UI library.
- [ ] Rerun focused tests; isolated browser acceptance1280x900/390x844 verifies flow, loading/errors/drafts, focus/labels/nooverflow and actual requests through HTTP fixtures. Record exact observed interactions; no real paid API calls.
- [ ] Commit reviewed changes: `feat(web): guide AI provider setup and switching`.

## Task 9: Integrated acceptance, documentation and independent review

**Files:** Create `server/test/provider-profiles-integration.test.ts` and helpers for catalog/check/inference fixture HTTP; update README/spec/plan/ledger.

**Interfaces:** Production routes, credential vault temp path, real in-memory DB, localhost HTTP endpoints and injected media boundary. Keep compatibility/crypto/transport assertions independent of mocked model quality.

- [ ] Write lifecycle test: migrate existing config/historical clip; add draftA/keyA/loadcatalog/select/check/activate; automatic pipeline AI succeeds; accept clip; add/check/activateB; queuedA retains key/config; credit402 and late invalid response preserve active results; in-use key/delete409; finisheddelete clears selection ifactive but old provenance persists; missing master/newcheck failure leaves video/history intact; restart migration idempotent. Assert recorded requests carry correct key and all public history/profile responses lack key/ciphertext. UI browser fixture exercises scoring-shaped probes/caches/catalog failures, not simple `{ok:true}` only.
- [ ] Run `bun test apps/server/test/provider-profiles-integration.test.ts`; expect PASS after Tasks1–8, fixing integration mismatches without weakening secret/job/history assertions.
- [ ] Run `bun run test`, `bun run typecheck`, `bun run --cwd apps/web build` sequentially; require exit0. Escalate only localhost fixture/build sandbox restrictions, record evidence and do not touch real data. Repeat browser checks after material UI changes.
- [ ] Update README presets, UI key/vault backup semantics and Unix permission/platform limitation, manual catalog fallback, model/endpoint compatibility limits, tiny test charge, migrated-default recheck, active-profile behavior. Do not claim live-provider quality based on fixtures.
- [ ] Complete one independent baseline-relative whole-change review per executing-plans; verify/fix Important/Critical findings with RED→GREEN regressions and full suite. Record minors/rulings and retained dirty files; no merge/push/deploy requested. Commit only safely separable owned work, otherwise keep uncommitted under documented baseline-preservation ruling.

## Self-review and execution handoff

- [x] Spec approved; all sections mapped to contracts/vault/profiles/catalog/probe/API/runtime/state/UI/integration tasks.
- [x] Interfaces/types consistent; DTOs keep secret input separate, optional snapshot extension backward-compatible.
- [x] Five Review Focus cases owned by explicit tests; tasks include deterministic failure/success evidence and no product implementation before approval.
- [x] User reviews this written plan (approved: “ok continue implement”).
- [x] Execute implementation Tasks1–9 using preserved Native execution and record actual checks below. The planned browser/device acceptance remains unperformed; live paid-provider quality was not assessed.

## Execution results (2026-10-03)

- Implemented the profile registry/vault, provider catalog and OpenRouter routing, scoring-shaped connection check, routes, queue snapshots, Settings UI, docs and focused regressions. Final independent targeted review found no remaining actionable findings.
- `bun run typecheck`: passed.
- `bun run --cwd apps/web build --webpack`: passed. Turbopack mode previously hit the sandbox's local-port restriction; Webpack completed the production build.
- Focused profile/catalog/settings suite: 14 passed, 0 failed.
- `bun test`: 251 passed, 4 failed out of 255. The four failures are local HTTP fixture tests in `ai-analysis-integration.test.ts` and `analysis-provider.test.ts`; each fails at `Bun.serve({hostname:'127.0.0.1',port:0})` with `EADDRINUSE` in this sandbox. No product assertion failed. The other route compatibility regression passes independently.
- Browser/device acceptance and live-provider checks were not performed. No implementation commits were created because the shared checkout contains pre-existing Project A/B/font changes; preserve the baseline ruling above.

Before execution, read spec+plan; capture a fresh baseline in this plan's own scratch directory; inspect the current non-main checkout/worktree state. Follow repository instructions; do not reread/reuse previous plan scratch as this plan's baseline. The existing dependent A/B code is uncommitted, so native checkout reuse is appropriate unless a complete isolated state can be preserved safely. Nine tasks share the profile/vault/snapshot interfaces, so keep inline execution and one independent final reviewer. User requested implementation and approved the written plan; Native execution was selected for project B and is preserved here.
