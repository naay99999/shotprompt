# ShotPrompt

A local-first tool for turning long Thai live-commerce recordings into short,
subtitled, 9:16-ready clips — transcription, scene/hook detection, trimming, and
export all run on your own machine. Nothing is uploaded anywhere.

## Prerequisites

- [Bun](https://bun.sh) (workspace runtime — `bun install`, `bun dev`, `bun test` all
  run through it)
- `ffmpeg` and `ffprobe` on your `PATH`
- `whisper-cli` (from [whisper.cpp](https://github.com/ggml-org/whisper.cpp)) on your
  `PATH`

On macOS, the quickest path is:

```bash
brew install ffmpeg whisper-cpp
```

Apple Silicon Macs get GPU-accelerated transcription via Metal automatically — no
extra configuration needed.

### A caveat: Homebrew's `ffmpeg` may be missing subtitle-burning support

ShotPrompt's core feature — burning Thai subtitles into an exported clip — depends on
`ffmpeg` being built with **libass**. Homebrew's `ffmpeg` formula does not always
include it, depending on which formulas/taps are already installed on your machine.
Exports *without* burned subtitles work regardless; only the burn-in path needs this.

Check whether your `ffmpeg` has it:

```bash
ffmpeg -filters | grep -i ass
```

If you see a line for the `ass` or `subtitles` filter, you're set. If the grep comes
up empty, subtitle burning will fail at export time (ShotPrompt surfaces this as a
failed export with an error message, not a silent hang — and both the Settings page
and the first-run Setup page show a `libass` check that will read ✕ in this case).

There isn't one universal fix — what works depends on your existing Homebrew setup.
Things worth trying, roughly in order of least to most effort:

1. `brew reinstall ffmpeg` after checking whether a variant/tap with libass baked in
   is available for your OS version.
2. Build `ffmpeg` from source with `--enable-libass` (requires `libass` itself to be
   installed first, e.g. `brew install libass`, then compiling ffmpeg against it).

Be prepared for this to take some manual troubleshooting — it's a real gap in the
"just `brew install` and go" story on some systems, not a bug in ShotPrompt.

## Setup

```bash
bun install
bun dev
```

This starts both the API server (`127.0.0.1:3001`) and the web app
(`127.0.0.1:3000`) concurrently. Open `http://127.0.0.1:3000`.

### First run

On first launch (or whenever a required binary/model is missing), the app redirects
you to a **Setup** screen (`/setup`) that checks `ffmpeg`, `ffprobe`, `whisper-cli`,
and the `libass` capability from your machine's `PATH`, shows the `brew install`
command with a copy button, and lets you download the transcription model
(`large-v3` by default, ~3.1 GB — resumable if the download drops mid-way). Once
`ffmpeg`/`ffprobe`/`whisper-cli` are found and the model is downloaded, the button
becomes "เริ่มใช้งาน ShotPrompt →" and takes you into the app. (`libass` is checked and
shown there and on the Settings page too, but — since the app is otherwise fully
usable without subtitle burning — it does not block that transition; see the
subtitle-burning caveat above.)

You can revisit these checks any time from **Settings** (`/settings`), which also
lets you switch transcription models and manage disk usage (deleting videos/exports
lives there — the video library itself has no delete button, by design).

## Where your data lives

Everything ShotPrompt creates — uploaded/normalized video, extracted audio,
thumbnails, transcripts, clips, subtitle files, exports, the downloaded whisper
model, and the SQLite database — lives under `data/` at the repo root. It is
git-ignored. Deleting `data/` gives you a clean slate (you'll be routed back through
Setup and need to re-download the model).

## Network exposure

Both the API server and the web app bind to `127.0.0.1` only. There is no
authentication layer — this is intentional, since the app is not meant to be
reachable from anywhere but the machine it runs on. Do not put it behind a reverse
proxy or expose the port to your network without adding your own auth in front of
it.

## Design reference

The screen-by-screen visual spec this UI was built against lives at
`docs/design/ShotPrompt.dc.html`.

## Development

```bash
bun test packages apps/server   # unit/integration tests
bun run typecheck                # tsc across the whole workspace
```
