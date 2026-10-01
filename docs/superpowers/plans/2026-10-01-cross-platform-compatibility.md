# Cross-platform compatibility fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make ShotPrompt's subtitle export, setup guidance, and readiness checks work predictably across macOS, Windows, and Linux.

**Architecture:** Keep OS/package-manager selection in the existing server `getInstallGuide` function and keep install commands as user-run suggestions. Add a focused FFmpeg filter-value escaper in core, injectable system probes in the server, and one pure readiness helper shared by the web setup and header. Run the existing checks on a three-OS CI matrix.

**Tech Stack:** Bun, TypeScript, Elysia, Next.js, FFmpeg, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-01-cross-platform-compatibility-design.md`

## Global Constraints

- Setup displays copyable package-manager commands and never runs system installers.
- WinGet's FFmpeg command is available only on supported x64 Windows hosts.
- A server restart is required after installing binaries or changing `PATH`.
- Readiness requires working FFmpeg, FFprobe, Whisper, `libx264`, and the selected model; missing `libass` remains an optional warning.
- Report Whisper acceleration as unverified; do not infer the active backend from OS or architecture.
- CI covers macOS, Windows, and Ubuntu.

## Review Focus

- Windows drive letters and backslashes survive both FFmpeg escape levels: Task 1 tests a `C:\...` path and expects the encoded path value.
- Commas, brackets, semicolons, quotes, and Unicode in subtitle/font paths do not alter the filter graph: Task 1 tests each character class in both path fields.
- A command found in `PATH` but failing to start or returning a nonzero status is reported unavailable: Task 3 injects spawn failure and nonzero results.
- A hung system binary does not hang the doctor route: Task 3 verifies the command timeout and false result.
- Unsupported OS/architecture/package-manager combinations do not receive a misleading install command: Task 2 tests Windows ARM64 with WinGet only and Linux without a recognized manager.

---

### Task 1: Escape FFmpeg subtitle filter paths

**Files:**
- Modify: `packages/core/src/ffmpeg.ts`
- Test: `packages/core/test/ffmpeg.test.ts`

**Interfaces:**
- Consumes: the existing `buildExportArgs` options `assPath` and `fontsDir`.
- Produces: exported `escapeFfmpegFilterValue(value: string): string`, used only when serializing FFmpeg filter-option values.

- [x] **Step 1: Write failing path-escaping tests.** Add `escapeFfmpegFilterValue` cases for a Windows drive path and POSIX paths containing a space, comma, colon, brackets, semicolon, apostrophe, backslash, and Thai characters. Assert the literal output required by FFmpeg's filter-option and filtergraph escaping levels. Extend the `buildExportArgs` test to verify both `ass=` and `fontsdir=` use escaped values while ordinary input/output arguments remain unchanged.

- [x] **Step 2: Run the core FFmpeg tests and confirm the new tests fail.**

  Run: `bun test packages/core/test/ffmpeg.test.ts`

  Expected: the new tests fail because the escape helper is not implemented.

- [x] **Step 3: Implement `escapeFfmpegFilterValue(value: string): string`.** First escape FFmpeg filter-option characters (`\`, `'`, and `:`); then escape filtergraph characters (`\`, `'`, `[`, `]`, `,`, and `;`). Apply the helper to `assPath` and `fontsDir` when `buildExportArgs` builds the `ass` filter. Keep the option separator between `ass` and `fontsdir` unescaped.

- [x] **Step 4: Run the core FFmpeg tests and confirm they pass.**

  Run: `bun test packages/core/test/ffmpeg.test.ts`

  Expected: all tests pass, including the existing crop and loudness assertions.

- [x] **Step 5: Commit the FFmpeg path fix.**

  ```bash
  git add packages/core/src/ffmpeg.ts packages/core/test/ffmpeg.test.ts
  git commit -m "fix(core): escape subtitle paths for ffmpeg filters"
  ```

### Task 2: Match setup guidance to OS and package manager

**Files:**
- Modify: `apps/server/src/routes/system.ts`
- Modify: `apps/server/test/system.test.ts`
- Modify: `apps/web/app/setup/page.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `getInstallGuide(platform, architecture, hasCommand)` and the existing `installGuide` response shape.
- Produces: `InstallGuide.manager` values `apt-get` and `pacman` in addition to the existing values; no new response fields.

- [x] **Step 1: Write failing install-guide tests.** Cover macOS Homebrew; Linux Homebrew, `apt-get`, and `pacman`; Windows Scoop priority; WinGet on x64; WinGet-only Windows ARM64 fallback; and unknown managers. Assert exact commands, manager values, manual URLs, and notes about manual Whisper installation.

- [x] **Step 2: Run the system route tests and confirm the new cases fail.**

  Run: `bun test apps/server/test/system.test.ts`

  Expected: new manager and architecture cases fail against the existing guide.

- [x] **Step 3: Implement manager and architecture selection.** Preserve the current macOS guide and Homebrew command. On Linux choose Homebrew, then `apt-get` (`sudo apt-get update && sudo apt-get install -y ffmpeg`), then `pacman` (`sudo pacman -S --needed ffmpeg whisper-cpp` only on x64); otherwise show manual guidance. On Windows choose Scoop first; use the existing WinGet FFmpeg command only on x64; otherwise show manual release guidance. State when `whisper-cli` must be installed separately.

- [x] **Step 4: Update Setup types/text and README instructions.** Add the two manager values to the Setup page type. Explain that PATH changes require restarting ShotPrompt before rechecking. Document the supported Linux commands and the manual fallback without claiming that Setup runs an installer.

- [x] **Step 5: Run install-guide tests and inspect the rendered guidance text.**

  Run: `bun test apps/server/test/system.test.ts`

  Expected: all install-guide tests pass; each supported and fallback branch has clear instructions.

- [x] **Step 6: Commit the install guidance change.**

  ```bash
  git add apps/server/src/routes/system.ts apps/server/test/system.test.ts apps/web/app/setup/page.tsx README.md
  git commit -m "fix(setup): show platform-specific install guidance"
  ```

### Task 3: Probe system binaries and export capabilities

**Files:**
- Modify: `apps/server/src/routes/system.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/test/helpers/app.ts`
- Test: `apps/server/test/system.test.ts`

**Interfaces:**
- Consumes: `getInstallGuide` from Task 2 and the current `/system/doctor` response.
- Produces: `SystemRuntime` with `platform: string`, `architecture: string`, `hasCommand(command: string): boolean`, and `run(command: string, args: string[], timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>`; injectable through `createApp(ctx: Ctx, systemRuntime?: SystemRuntime)`. The doctor response adds `libx264: boolean` and sets `acceleration` to `unverified`.

- [x] **Step 1: Write failing probe and doctor tests.** Inject a fake `SystemRuntime` through `createTestApp`. Verify successful version/help probes, absent commands, spawn rejection, nonzero exit, timeout, parsed `libass` and `libx264` support, unsupported acceleration value, and stable doctor response independent of the host OS.

- [x] **Step 2: Run the system route tests and confirm the new assertions fail.**

  Run: `bun test apps/server/test/system.test.ts`

  Expected: the new assertions fail because the route currently checks command presence and does not report `libx264`.

- [x] **Step 3: Implement injectable, bounded system probes.** Define `SystemRuntime` in `system.ts` and pass it through `createApp` into `systemRoutes`. The production runtime uses `Bun.which` and `Bun.spawn`; cap each probe at 10 seconds and kill a timed-out child. Represent timeout with `exitCode: null` and `timedOut: true`; represent a spawn error with `exitCode: null`, the error text in `stderr`, and `timedOut: false`. Run independent doctor probes concurrently.

- [x] **Step 4: Implement doctor capability checks.** Require successful `ffmpeg -version`, `ffprobe -version`, and `whisper-cli --help` runs for their booleans. Read `ffmpeg -filters` for `ass`/`subtitles` and `ffmpeg -encoders` for a `libx264` encoder entry. Return `false` for missing commands, failed starts, timeouts, nonzero exits, or absent capabilities; do not infer acceleration from `process.platform` or `process.arch`.

- [x] **Step 5: Run system tests and confirm all probe scenarios pass.**

  Run: `bun test apps/server/test/system.test.ts`

  Expected: all tests pass with no dependency on locally installed media binaries.

- [x] **Step 6: Commit the doctor capability checks.**

  ```bash
  git add apps/server/src/routes/system.ts apps/server/src/app.ts apps/server/test/helpers/app.ts apps/server/test/system.test.ts
  git commit -m "fix(server): verify media tool capabilities in doctor"
  ```

### Task 4: Share readiness rules in Setup and the app header

**Files:**
- Create: `apps/web/lib/system-readiness.ts`
- Test: `apps/web/test/system-readiness.test.ts`
- Modify: `apps/web/app/setup/page.tsx`
- Modify: `apps/web/components/app-shell.tsx`
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: the Task 3 doctor booleans `ffmpeg`, `ffprobe`, `whisper`, `libx264`, and `model.downloaded`.
- Produces: `isSystemReady(status: { ffmpeg: boolean; ffprobe: boolean; whisper: boolean; libx264: boolean; model: { downloaded: boolean } }): boolean` shared by Setup and AppShell; acceleration displays an unverified state in Setup, the app header, Settings, and README.

- [x] **Step 1: Write failing readiness tests.** Add table-driven tests showing ready is true only when all five required capabilities are true, and false when each individual capability is false. Confirm `libass` is not part of the readiness helper.

- [x] **Step 2: Run the readiness tests and confirm they fail.**

  Run: `bun test apps/web/test/system-readiness.test.ts`

  Expected: failure because `system-readiness.ts` does not exist.

- [x] **Step 3: Implement `isSystemReady(status: { ffmpeg: boolean; ffprobe: boolean; whisper: boolean; libx264: boolean; model: { downloaded: boolean } }): boolean`.** Define the input type beside the helper and require all five values. Use the same helper in Setup and AppShell so their ready states cannot drift.

- [x] **Step 4: Update doctor UI types and acceleration labels.** Add `libx264` to doctor types and show it as a required export capability. Display acceleration as unverified instead of labeling it Metal or CPU. Keep missing `libass` as an optional subtitle warning. Update README first-run requirements to match the `libx264` readiness check and unverified acceleration label.

- [x] **Step 5: Run focused web tests and typecheck.**

  Run: `bun test apps/web/test/system-readiness.test.ts`

  Run: `bun run typecheck`

  Expected: readiness tests pass and TypeScript reports no errors.

- [x] **Step 6: Commit the readiness UI change.**

  ```bash
  git add apps/web/lib/system-readiness.ts apps/web/test/system-readiness.test.ts apps/web/app/setup/page.tsx apps/web/components/app-shell.tsx apps/web/app/settings/page.tsx README.md
  git commit -m "fix(web): align readiness with verified capabilities"
  ```

### Task 5: Run verification on all supported operating systems

**Files:**
- Create: `.github/workflows/cross-platform.yml`

**Interfaces:**
- Consumes: the existing root `bun test` and `bun run typecheck` scripts.
- Produces: a pull-request and push workflow with Ubuntu, macOS, and Windows jobs.

- [x] **Step 1: Add the OS matrix workflow.** Use `actions/checkout@v4` and `oven-sh/setup-bun@v2` with Bun `1.3.14`. Matrix over `ubuntu-latest`, `macos-latest`, and `windows-latest`; run `bun install --frozen-lockfile`, `bun test`, and `bun run typecheck` on pull requests and pushes.

- [x] **Step 2: Validate workflow structure locally.** Run `ruby -e 'require "yaml"; YAML.load_file(ARGV[0])' .github/workflows/cross-platform.yml`; confirm the file parses and includes all three runners and all three commands. Mark native Windows/Linux results pending until those matrix jobs report pass.

- [x] **Step 3: Run the full local verification suite.**

  Run: `bun test`

  Run: `bun run typecheck`

  Expected: both commands pass locally; the GitHub matrix supplies native Windows/Linux evidence after push.

- [x] **Step 4: Commit the cross-platform CI workflow.**

  ```bash
  git add .github/workflows/cross-platform.yml
  git commit -m "ci: test on macos windows and linux"
  ```
