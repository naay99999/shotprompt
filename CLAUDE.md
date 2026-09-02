# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ShotPrompt is a single-user, local-first tool: ingest a long Thai/English live-commerce video, transcribe it with whisper.cpp, score "hook" moments (keyword tiers + scene detection), let the user turn candidates or hand-drawn time ranges into clips, edit trim/subtitles, and export with aspect conversion + loudness normalization. No auth, no cloud — server binds `127.0.0.1:3001`, web `127.0.0.1:3000` only. External binaries required on PATH: `ffmpeg`/`ffprobe` (must be a libass-enabled build — Homebrew's plain `ffmpeg` formula lacks it, use `ffmpeg-full`) and `whisper-cli`.

## Commands

```bash
bun install
bun dev                 # server (Elysia, :3001) + web (Next.js, :3000) concurrently
bun test packages apps/server            # all tests (bun:test; apps/web has none)
bun test apps/server/test/clips.test.ts  # single file
bun test -t "name"                       # filter by test name
bun run typecheck       # tsc -b for packages+server, tsc --noEmit for web
```

Tooling quirk: `tsc -b` emits `.js`/`.d.ts` next to sources including under `test/`, so `bun test` on an unclean tree double-runs compiled test copies (pass counts double). The artifacts are gitignored; delete stray `test/**/*.test.js`/`.test.d.ts` files if counts look wrong.

Tests reach routes via `app.handle(new Request('http://x/...'))` — the short fake hostname works because `app.ts` sets `standardHostname: false` (a no-op for real hostnames; do not remove it).

## Architecture

Bun workspaces: `packages/core` (pure logic, no I/O side effects) → `packages/db` (Drizzle + `bun:sqlite`, WAL) → `apps/server` (Elysia) → `apps/web` (Next.js App Router, Tailwind v4, Eden Treaty client typed off `App` exported from `apps/server/src/app.ts`).

**Candidates vs clips** — the load-bearing distinction. Pipeline output (`candidates` table) is read-only and wiped on re-detection; user-created `clips` reference a candidate only via a soft `candidateId` (deliberately no FK) so re-running detection never corrupts user work. Clip subtitles are copied from `segments` into `clip_subtitles` at clip creation and edited independently of the raw transcript.

**Render at export time** — the pipeline never cuts video. It produces candidates (time range + score + thumbnail); preview plays the normalized source in `<video>` with JS-enforced bounds; ffmpeg only runs when the user exports a clip.

**Pipeline** (`apps/server/src/pipeline.ts`, steps in `src/steps/`): normalize → extract-audio → transcribe → detect-scenes → detect-hooks → thumbnails. Two in-process `JobQueue` instances (pipeline, export), each concurrency 1, persisted in `jobs`/`job_steps`. On startup `recovery.ts` marks stale queued/running rows failed (also `videos`/`exports` statuses) and sweeps `.tmp` files.

**Hook detection** (`packages/core/src/hooks.ts`): 4-phase algorithm (activity walk, scene coverage, merge, pad) ported verbatim from the old repo — constants like `SCORE_THRESHOLD=40`, `MERGE_GAP=15`, `MAX_CLIP_DURATION=90` are fixed; don't "improve" them. Keyword tiers (tier1=25 urgency, tier2=15 promotion, tier3=8 CTA) live in `keywords.ts` and are seeded into SQLite.

**Subtitle trim rules** — extending a clip's range copies only newly-covered transcript segments into `clip_subtitles`; shrinking deletes nothing; export/SRT always filter+clamp+shift against the clip's *current* bounds through the single shared `clampToClip` in `packages/core/src/subtitles.ts`. Never bypass it.

**SSE discipline** — `GET /events` is a refetch trigger only, never a source of truth. Web consumers (`lib/use-events.ts`) refetch via REST on `$reconnect` and on domain events. In event payloads, `job:update` uses `jobType` because `type` is the SSE envelope discriminator.

**Atomic writes** — every artifact is written as `<stem>.tmp.<ext>` (extension must stay last so ffmpeg's muxer can infer format) then renamed. Cancel paths clean up their own in-flight tmp file; the startup sweep catches the rest (excluding in-progress model downloads under `data/models/`).

**Storage**: `data/` (gitignored) — `data/shotprompt.db`, `data/videos/<id>/{source.mp4,audio.wav,thumbs/,exports/}`, `data/models/ggml-<name>.bin`. Override root with `SHOTPROMPT_DATA`. Bundled subtitle font: `assets/fonts/NotoSansThai-Bold.ttf`, passed to libass via `fontsdir`.

**Upload size**: `index.ts` sets `maxRequestBodySize` on `listen()` — Bun's 128 MB default 413s any real recording.

## Notes

- `apps/web/AGENTS.md` warns the installed Next.js is newer than training data — read `node_modules/next/dist/docs/` before nontrivial Next.js work.
- Design references: spec `docs/superpowers/specs/2026-07-19-shotprompt-mvp-design.md`, plan `docs/superpowers/plans/2026-07-19-shotprompt-mvp.md`, UI mockup `docs/design/ShotPrompt.dc.html` (visual source of truth; dark theme, Anuphan font, Thai UI copy).
- UI conventions from the adopted design: video deletion lives on the Settings page only (not the library); manual clips are created by dragging on the timeline.
