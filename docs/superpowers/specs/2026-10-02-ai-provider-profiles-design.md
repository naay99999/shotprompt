# AI provider profiles and guided settings

Date: 2026-10-02
Status: written spec approved by user (chat: “ok implement”); implementation-plan review pending.

## Intent and success criteria

The user wants varied AI APIs, especially OpenRouter, configured easily through ShotPrompt's UI. They approved multiple saved connections, shared transports with provider-specific additions, and a guided flow: provider → key → model → test → activate. No environment editing should be necessary for new connections.

Success means a user can add OpenRouter, save its key, search/select a suitable model, test and activate it from Settings; retain separate Gemini/local connections; switch the default without affecting queued analysis or clip history; understand actionable errors without seeing protocol details. Continue using the existing AI discovery/scoring engine, upload, transcription, queues, feedback, history, editor and exports.

This is architectural work under `superpowers:brainstorming`. The next prerequisite is approval of this written spec, then approval of an implementation plan. Preserve the user's Native execution preference for that handoff.

## Scope and chosen approach

Use a small preset registry, saved profiles, a server credential vault, normalized model catalogs, and the existing Ollama/OpenAI-compatible transports. Add OpenRouter routing behavior explicitly. Do not build independent inference clients for every provider.

Initial presets:

| Preset | Protocol | Location/default base | Catalog |
| --- | --- | --- | --- |
| OpenRouter | OpenAI-compatible | external; `https://openrouter.ai/api/v1` | `/models`; text models, pricing/context/support metadata |
| Gemini | OpenAI-compatible | external; `https://generativelanguage.googleapis.com/v1beta/openai` | `/models`; normalize available model IDs |
| Ollama | native | local; `http://127.0.0.1:11434` | `/api/tags`; installed models |
| Local OpenAI-compatible | compatible | local; `http://127.0.0.1:1234/v1` | `/models` when available |
| Custom API | compatible or Ollama | explicit local/external selection and URL | best-effort matching protocol; manual model always available |

OpenAI and other compatible services can use Custom API. Native Anthropic, Azure-specific authentication/deployment routes, arbitrary custom headers, OAuth, automatic provider/model failover, simultaneous model comparisons, billing dashboards and project C audiovisual analysis are outside this iteration. Compatibility is established per endpoint/model, not guaranteed for every advertised model.

## Shared contracts and responsibilities

Pure preset/config/profile/catalog contracts and validation belong in `packages/core`. Server modules own profile persistence, credentials, external catalog requests, testing, activation and runtime resolution. Web modules own the guided form, profile list, catalog selection and draft/request state. Keep those responsibilities separate from scoring prompts/rubric.

A profile has a server UUID, revision, display name (1–80 Unicode codepoints), preset ID, a complete existing ProviderConfig, credential mode (`none`, `stored`, `legacy-env`), credential version (opaque UUID or null), created/updated times, and a last check. Maximum 20 saved profiles. Store an active profile ID separately; it may be null. Allow duplicate providers/models with different names/keys.

Saved incomplete connections are drafts: empty model and absent key are allowed. Validate URL, preset/protocol/location, limits and name before saving. A separate runtime-ready validator requires a nonempty model, required credential, valid config, external transcript opt-in and matching successful check. The cloud presets require a key; Ollama/local do not, but can accept one for authenticated servers.

Profile views contain metadata, credential mode, `keyPresent`, vault availability and current check; never plaintext or ciphertext. Do not return even the last key characters. Public analysis options retain schemaVersion 2 and existing fields. Provider selection is the active default for new requests in this iteration, not a new per-analysis request override.

Preset URLs are fixed for OpenRouter/Gemini. Choosing a different URL converts the connection to Custom API, displays that change, and requires the key to be supplied again; it cannot carry the old key silently. Model/protocol labels are UI defaults, not evidence of live model capability.

## Credential handling

The browser submits a new key only on explicit save. Credential operation is explicit (`keep`, `replace`, `remove`); a blank input does not erase an existing key. Keys must be nonempty after trimming, at most 4096 bytes, without CR/LF. Clear the typed key after successful save and when switching profile/provider or closing the editor. Keep drafts in component memory, never localStorage/sessionStorage, URL, analytics or error messages. Show/hide applies only to a newly typed key; saved keys cannot be revealed through a read API.

Encrypt stored keys with AES-256-GCM using a fresh random nonce for each replacement. Ciphertext records belong in a separate SQLite credential table; profiles only reference them. Bind authenticated encryption to profile ID, credential version, protocol and canonical base URL. Never reuse a credential for another profile/origin.

Generate a 32-byte vault master key lazily in `data/secrets/ai-vault.key`, outside SQLite. On Unix, use directory mode 0700/file 0600, exclusive creation, regular-file checks and reject symlinks. Avoid regenerated keys when credential rows already exist: missing, unreadable or invalid master key yields `credential-vault-unavailable`; do not erase ciphertext or silently create a replacement. On platforms without Unix permissions, report their limitation in operator documentation; no OS keychain dependency in this version. This protects a copied database without its master key; it is not protection against access to the entire local account/data directory.

Saving config and credential changes is transactional once vault availability is established. Replacing/removing deletes the old encrypted row only after the transaction commits. No raw key/ciphertext in analysis snapshots, feedback, SSE, logs, provider error bodies or browser responses. Resolve the secret on the server at execution, then retain it only in the lifetime of that provider client. Sanitize echoed key content in returned model metadata/errors using the actually resolved key.

The legacy `SHOTPROMPT_LLM_API_KEY` remains supported only for the migrated legacy connection/old snapshots. Do not use it as an automatic fallback for every new provider. Switching a legacy-env profile's destination requires explicit replacement or removal of credentials. UI explains legacy environment usage and offers replacement with a UI-saved key.

## Profile edits, jobs and activation

New analysis records a complete nonsecret config snapshot plus optional profile identity/name/preset/revision/credential mode/version. Older snapshots without these fields keep their existing parser/runtime path. Model name, routing behavior and identity are fixed when enqueued. A default switch only affects subsequent jobs.

While queued/running analysis references a profile, reject changes to its endpoint/protocol/preset/location or credential, and reject deletion with `profile-in-use` (409). Display “wait for or cancel this analysis before changing the connection/key.” Model, name, output mode and timeout edits may be saved as a new revision: existing jobs use their captured config, credential remains the same. All edits invalidate the new revision's check. Activation of another ready profile remains allowed while jobs run. Check/update/enqueue/delete enforce these rules transactionally; late check/catalog responses cannot overwrite a newer revision.

Deleting an active profile with no live job clears the active pointer and disables automatic AI until another profile is activated. Confirm deletion in UI and explain the effect. Completed histories/clip snapshots retain their saved metadata after profile deletion. Do not dereference current profiles to render historical model names.

Only a successful matching synthetic check permits activation. Do not silently activate on save/test; offer “Use as default” after success. Active profiles edited into an unverified state remain selected but cannot enqueue new AI until retested. Show this clearly in Settings and the workspace. Media processing/manual editing remains available. Automatic pipeline scheduling skips an unavailable/unverified default, and provides a setup notice rather than failing the ready video.

## Model catalog behavior

Catalog requests originate on the server using only the saved profile's destination and credential. Save a draft connection before loading its models; the UI explains this through a “Save and load models” action so users need no model name to start. Catalog loading does not send transcripts or infer model quality. Refresh is explicit, with an in-memory five-minute cache keyed by profile/config/credential revision. It may be shared among concurrent requests for that same key. No cross-profile credential or stale-result reuse.

Normalize entries to ID, display name, nullable context length, nullable input/output USD per million tokens, text capability, schema support (`supported`, `unsupported`, `unknown`) and metadata timestamp. OpenRouter prices are converted from published per-token prices; missing/nonfinite/negative values become unknown. Zero is only free when explicitly reported as zero. Show a price reference, not an exact run cost; no hardcoded live prices or currency conversion. Basic catalogs generally expose only IDs, so missing price/capability is “unavailable,” not zero/unsupported.

Fetch at most 3000 entries with a 4 MiB response limit and 15-second overall catalog deadline. Follow provider pagination only within those bounds, and mark `truncated` when the catalog cannot be fully listed; offer a manual model input. Never label a truncated catalog complete. Reject redirects and reapply the existing local/private-host versus external rules. Concurrent user edits discard stale responses. Catalog failures preserve the chosen model and all unsaved nonsecret form fields, show retry and manual entry, and do not erase previous successful catalog data; stale data is visibly labeled.

OpenRouter UI searches names/IDs, offers all text models or schema-supported models, and displays unknown capability honestly. Support is based on the current catalog and may differ by serving endpoint. Default to schema mode for a known schema-supported selection. Otherwise offer JSON mode or a schema test explicitly; do not silently change a saved output mode. Never automatically change provider/model to rescue a failed run.

## OpenRouter transport and checking

OpenRouter uses the compatible client plus provider-specific request options: in schema mode include `provider.require_parameters: true` so routing must honor requested parameters. Do not pin a named downstream provider or add fallback model lists. Preserve bounded nonstreaming output, complete-response detection, request/run timeouts, one invalid-response repair, grounded evidence validation, deterministic scoring and atomic publication from project B.

Introduce provider identity as an optional config/snapshot extension, so old compatible endpoints do not receive OpenRouter-only fields. A custom endpoint never gets provider-specific parameters merely because its hostname resembles OpenRouter.

Testing uses the selected saved model/config/credential, not real subtitle content. Use a small synthetic payload/schema exercising the scoring response's essential nested structures, arrays, bounded integers and accepted/rejected union. The existing `{ok:true}` probe alone cannot establish support for the scoring schema. Limit output to 1024 tokens and one request; no repair in a connection check. JSON mode still passes parsed output through the same synthetic validator. Return a redacted result, checked revision/config/credential fingerprint and time, not raw text. A successful check verifies that response contract at that moment, not ranking quality or future availability.

Changing any config or credential invalidates success. A failed retest replaces the old success for that same revision. Activation compares the fingerprint/revision again in its transaction. Concurrent edit while a check is running returns stale-check, and leaves the new draft intact.

## Guided UI/UX

Settings has a responsive profile list, active badge, last check/credential status, Add connection, Edit, Use as default and Delete. A profile editor can be inline in the same page; no separate full-screen wizard is required.

Flow:

1. Choose provider and name. Preset selection fills URL, location and protocol; cloud selection shows the external subtitle disclosure.
2. Enter optional/required key, or keep the saved one. Provide provider key-management/documentation links.
3. Save and load models; search/select or type an exact model ID. For OpenRouter, show name/ID, reference input/output price, context and schema status. No quality/Thai-support claims based on a catalog listing.
4. Test the saved connection. Explain that a tiny synthetic completion may incur a small provider charge; transcripts are not sent. Keep loading/status feedback adjacent to the action.
5. Use as default after matching test success and external transcript opt-in. Show active connection in upload/analysis controls and link back to Settings.

URL/protocol/output mode/timeouts and local-proxy disclosure live under Advanced settings. OpenRouter schema capability remains visible beside model selection. Saving a draft is distinct from activation; no surprise external inference on save. UI button names and busy/dirty/ready states explain the next step. Prevent duplicate submissions; retain edited inputs on catalog/check/API failures and refresh; warn when leaving a dirty editor. Key inputs have proper labels, password semantics and no persisted autofill by the application. Keyboard focus/error association and 390px/1280px layouts are acceptance requirements.

Errors distinguish missing/invalid key, insufficient credits (OpenRouter 402), rate limit, invalid/unavailable model, unsupported output/schema, context limit, request/run timeout, inaccessible vault, in-use profile and stale revision. Use sanitized Thai messages with an action (replace key, add credits, choose model/mode, retry, wait/cancel job). No provider-body excerpts or undocumented promise to cover every error variant.

## API and persistence boundaries

Use a versioned registry/profiles response instead of overloading the old flat config:

- GET `/settings/analysis/providers`: preset metadata and form defaults.
- GET/POST `/settings/analysis/profiles`: redacted list/create draft.
- PUT/DELETE `/settings/analysis/profiles/:id`: expected revision and explicit credential operation; update/delete.
- POST `/settings/analysis/profiles/:id/models`: fetch/cache model catalog for saved revision; no raw key argument.
- POST `/settings/analysis/profiles/:id/check`: test saved revision.
- PUT `/settings/analysis/active`: expected profile revision (or null) and activation validation.

Every new mutation/outbound catalog/check route requires application/json as applicable and validates Origin against the existing local web origins; reject nonmatching/null origins. Calls without Origin remain available to local CLI/tests, since this is still a loopback-only app with no general authentication system. CORS alone is insufficient to reject state-changing cross-origin requests. No change to network binding or new remote administration feature.

Persist profiles/active selection in an explicitly schema-versioned settings record; persist encrypted credentials in their own idempotently migrated table. Profile service validates references and owns updates; database transactions protect active pointers, revisions, credentials and live-job checks. Keep request DTOs separate from persisted/view DTOs to prevent key fields entering config snapshots.

Old GET `/settings/analysis` returns a compatibility projection of the active ready config/defaults/keyPresent/check. Old PUT/check endpoints delegate to the migrated/active profile service and enforce revision/activation invariants; they cannot overwrite the registry or silently switch a new profile. If no active profile exists, return a clear setup-required conflict for old writes. New web UI uses the profile API. Do not leave a parallel legacy setting authoritative after migration.

## Migration and compatibility

An idempotent startup migration imports a valid legacy `analysisProvider` as one “Existing connection” profile, preserving protocol/base/model/limits/external flag. Infer OpenRouter/Gemini preset only on exact canonical known URL and compatible protocol; otherwise choose local/Ollama/custom as appropriate. Mark credential source legacy-env if a server key is present, otherwise none. Do not copy plaintext environment keys into SQLite.

Keep imported selection as the default pointer, but require one new scoring-shaped synthetic check before new AI requests. Display an explicit migration banner/action; retain prepared videos/manual editing. Existing queued old-style snapshots continue under their original config/env behavior and restart recovery remains unchanged. Migration never rewrites analysis options, prior scores, run metadata, accepted clip snapshots or feedback.

Subsequent starts do not resurrect deleted profiles or overwrite edited settings from the legacy key. Malformed legacy config yields an empty registry plus a setup notice. A lost vault key does not damage history/media and never triggers provider/credential fallback.

## Verification and review focus

Before implementation capture the current dirty checkout as the new baseline; preserve all project A/B and unrelated work. Plan Native execution inline with one independent final review. Stage only safely separable owned changes.

Tests must cover profile drafts/default/revisions/migration idempotency; encryption roundtrip/authentication binding, missing-master failure, key replacement/removal and absence of keys/ciphertext in all public DTOs/history; exact credential selection and no global-key fallback; endpoint/key edit and delete guards during jobs; default switch preserving queued config/history; OpenRouter request options/402; catalog fixtures across providers, Unicode search/metadata/unknown/zero/limits/cache/stale responses; synthetic scoring-shaped check/activation gating; Origin rejection; UI edited drafts/key clearing/manual model fallback/dirty editor and action states. Use real in-memory DB and local HTTP fixtures, injected vault paths/media boundaries. Never call live paid providers in default tests.

Run focused suites, `bun run test`, `bun run typecheck`, and production web build. Isolated browser acceptance covers adding OpenRouter, key replace/remove, searchable model selection, test success/failure, activation/default switch, missing credits, legacy migration notice, manual model entry when catalog fails, and mobile/desktop keyboard/focus/layout. Live provider compatibility remains unverified unless a user-configured connection is available and authorized; fixture probes are not evidence of real model quality.

Review particularly: credential destination binding, concurrent profile edits/check/default activation/enqueue, secret redaction, old snapshot compatibility, required-parameter routing, catalog truncation and price units, and no hidden transcript transmission/fallback.

## Primary references checked 2026-10-02

- OpenRouter authentication: https://openrouter.ai/docs/api/reference/authentication
- OpenRouter model catalog/fields: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- OpenRouter structured outputs/routing: https://openrouter.ai/docs/guides/features/structured-outputs
- Gemini compatible completions/model listing: https://ai.google.dev/gemini-api/docs/openai
- Ollama installed model listing: https://docs.ollama.com/api/tags

## Checkpoints

- [x] User intent and multi-profile preference established.
- [x] User approved profiles/shared transports with OpenRouter additions.
- [x] User approved guided UI/UX (chat: “ok ตามที่แนะนำ”).
- [x] Existing provider settings/transport, queues/snapshots and browser form explored.
- [x] Written spec self-reviewed for scope, secrets, compatibility and activation invariants.
- [x] User approves this written spec (chat: “ok implement”).
- [ ] Write and review implementation plan; retain Native execution preference.
- [ ] Implement and verify after required approvals.
