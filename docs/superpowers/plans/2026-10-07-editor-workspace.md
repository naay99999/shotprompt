# Editor workspace implementation plan

> **For agentic workers:** Use the approved in-session implementation workflow. Independent page/helper tasks may be delegated using superpowers:dispatching-parallel-agents; review the integrated changes using superpowers:requesting-code-review.

**Goal:** Improve the three primary ShotPrompt screens around import, editing, and export.

**Architecture:** Preserve data hooks and API contracts. Introduce shared visual styles and small motion helpers, restructure the editor's composition, and add pure timeline viewport math.

**Tech stack:** Next.js 16, React 19, Tailwind 4, Vidstack, GSAP, Phosphor, Bun.

**Spec:** `docs/superpowers/specs/2026-10-07-editor-workspace-design.md`

## Global constraints

- Preserve existing API contracts, stored media, pipeline requirements, dirty-edit guards, external AI consent, and destructive-action confirmation.
- Thai remains the main UI language; retain keyboard access, visible focus, useful loading/empty/error states, and reduced-motion support.
- Existing user changes in skills-lock.json and skill directories are unrelated; leave them untouched.
- Work in the current checkout on codex/editor-workspace-redesign. Do not commit or publish without a separate user request.

## Review focus

- Long filenames and narrow screens must wrap or truncate without losing access to meaningful labels.
- Large candidate/subtitle lists must not expand desktop page height indefinitely.
- Switching tool tabs must preserve unsaved subtitle drafts and crop/trim updates.
- Imported video response failures must not navigate to a nonexistent ID.
- Timeline zoom near zero/end and on very long videos must keep times bounded and preserve precision.

## Tasks

### Shared design and shell (primary agent)
- [x] Read installed Next font/styling/client docs; install only declared design dependencies.
- [x] Introduce font variables, palette adjustments, shared button/panel/page classes, responsive layouts, and short GSAP interaction motion.
- [x] Refresh AppShell navigation, system status, brand, and layout hierarchy.

### Library/import (independent task)
- [x] Refresh apps/web/app/page.tsx, upload-zone.tsx, and video-row.tsx with an asymmetric introduction, compact import surface, and visible library.
- [x] Retain import readiness/validation/progress/path behavior; reveal transcription and AI options on demand.
- [x] Navigate to a returned video ID after success; preserve refresh callbacks. Add a behavior test for success-response parsing if introducing a helper.
- [x] Run focused tests and web typecheck.

### Settings (independent task)
- [x] Refresh settings/page.tsx and analysis-settings.tsx; categorized settings and clear connection list/editor.
- [x] Keep panels mounted when switching categories so dirty drafts and guards persist. Preserve all credential/consent/test/activation/model/storage controls.
- [x] Run profile-state tests and web typecheck.

### Timeline (independent task)
- [x] Write failing timeline-view helper tests for clamped zoom/pan, empty duration, long videos, and bounded tick generation.
- [x] Implement pure viewport helper; update timeline.tsx with zoom/pan controls, readable time ruler, range selection, and optional selectedRange prop.
- [x] Keep existing creation validation and keyboard alternatives. Run timeline tests and web typecheck.

### Editor integration (primary agent)
- [x] Restructure videos/[id]/page.tsx into bounded desktop workspace with independent list/inspector scrolling and responsive mobile flow.
- [x] Make ClipStrip compact; disclose AI candidate score details; add trim/frame/subtitle tabs to ClipEditor without unmounting fields.
- [x] Reveal export controls/history from toolbar; preserve batch selection and enable active-clip export.
- [x] Preserve job, retry/repair, player controls, crop overlay, navigation guard, and errors.

### Verification
- [x] Run focused/full tests, typecheck, production build.
- [x] Test actual UI with background browser at desktop/narrow widths and save screenshots.
- [x] Request fresh code review; fix material regressions; record any limitations.

## Verification record

- Full Bun suite: 270 passed, 0 failed, 993 assertions across 61 files. Local HTTP tests require execution outside the localhost-restricted sandbox.
- Workspace TypeScript check passed; production web build passed.
- Browser: editor checked at 1280×767 and 1440×900; mobile checked at 320 and 390 CSS pixels without horizontal overflow. The 75-candidate list scrolls independently within the desktop workspace.
- Disposable database copy: created a clip, verified automatic selection, active-clip export fallback, trim/frame/subtitle tools, crop overlay, keyboard tabs, draft retention across tools/export, and the unsaved-change guard. No test clip or subtitle changes were written to the user's database. The temporary copy was removed.
- Settings: all three categories checked; unsaved profile name retained across category switches and navigation guard remained active. Mobile import options checked expanded.
- Independent code review completed; mobile back-link label and tab keyboard navigation findings resolved.
- Actual media import/transcription and export rendering were not rerun: the local system still reports missing processing tools. Existing prerequisites and API processing behavior are preserved.
- Screenshots: /private/tmp/shotprompt-ui-review/editor.jpg, library.jpg, settings.jpg. Editor screenshot includes the disposable test clip.
