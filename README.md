# ShotPrompt

A local-first tool for turning long recordings into short,
subtitled, 9:16-ready clips — transcription, highlight analysis, trimming, and
export run on your own machine. AI highlight analysis uses the model endpoint you configure; external inference requires explicit opt-in.

## Prerequisites

- [Bun](https://bun.sh) (workspace runtime — `bun install`, `bun dev`, `bun test` all
  run through it)
- `ffmpeg` and `ffprobe` on your `PATH`
- `whisper-cli` (from [whisper.cpp](https://github.com/ggml-org/whisper.cpp)) on your
  `PATH`

On macOS, the quickest path is:

```bash
brew install ffmpeg-full whisper-cpp && brew link --overwrite ffmpeg-full
```

Whisper GPU acceleration depends on the installed binary and is reported as
unverified; ShotPrompt does not infer an active backend from the operating system.

### A caveat: Homebrew's plain `ffmpeg` is missing subtitle-burning support

ShotPrompt's core feature — burning Thai subtitles into an exported clip — depends on
`ffmpeg` being built with **libass**. Homebrew's plain `ffmpeg` formula deliberately
excludes it (along with `fontconfig`/`harfbuzz`/`freetype`); only the separate
`ffmpeg-full` formula — also in homebrew-core, no extra tap needed — bundles them.
Exports *without* burned subtitles work regardless; only the burn-in path needs this.

Check whether your `ffmpeg` has it:

```bash
ffmpeg -filters | grep -i ass
```

If you see a line for the `ass` or `subtitles` filter, you're set. If the grep comes
up empty, subtitle burning will fail at export time (ShotPrompt surfaces this as a
failed export with an error message, not a silent hang — and both the Settings page
and the first-run Setup page show a `libass` check that will read ✕ in this case).

Fix it with:

```bash
brew install ffmpeg-full
brew link --overwrite ffmpeg-full
```

`ffmpeg-full` is keg-only, so the `--overwrite` link is required — it repoints the
`ffmpeg`/`ffprobe`/`ffplay` symlinks at the `-full` build. Restart ShotPrompt after
installing or relinking binaries, then recheck Setup. Note that a later
`brew upgrade ffmpeg` (the plain formula) can silently re-link over this — if libass
disappears again, just re-run the `brew link --overwrite` command above.

### Linux and Windows

The Setup page detects the OS, CPU architecture, and available package manager, then
shows a command you can copy. It never runs an installer automatically.

- **Linux:** Setup prefers Homebrew, then `apt-get`, then `pacman` on x64. On Debian
  or Ubuntu, copy `sudo apt-get update && sudo apt-get install -y ffmpeg`; install
  `whisper-cli` separately from the [Whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases).
  On x64 Arch Linux, copy `sudo pacman -S --needed ffmpeg whisper-cpp`. If no
  supported manager is detected, install FFmpeg with libass and Whisper.cpp manually.
- **Windows:** Setup prefers Scoop (`scoop install ffmpeg whisper-cpp`). On x64 with
  WinGet, copy `winget install --id Gyan.FFmpeg --exact` and install
  `whisper-cli.exe` separately from the Whisper.cpp releases. Other architectures or
  hosts without a supported manager use the manual release guidance.

Setup only shows commands for you to copy; it does not run installers. After installing
or changing `PATH`, restart ShotPrompt, then use the Setup page’s “ตรวจสอบอีกครั้ง”
button. It checks that `ffmpeg`, `ffprobe`, and `whisper-cli` run successfully, that
FFmpeg includes the `libx264` encoder required for export, and reports subtitle
burn-in support as an optional `libass` capability. Whisper GPU acceleration is shown
as unverified.

## Setup

```bash
bun install
bun dev
```

This starts both the API server (`127.0.0.1:3101`) and the web app
(`127.0.0.1:3100`) concurrently. Open `http://127.0.0.1:3100`.

### First run

On first launch (or whenever a required binary/model is missing), the app does **not**
redirect you away — the Library page still renders normally underneath. Instead, the
header shows a red status chip ("ต้องติดตั้งเพิ่ม") that links to a **Setup** screen
(`/setup`), which checks working `ffmpeg`, `ffprobe`, `whisper-cli`, the `libx264`
encoder, and the optional `libass` capability from your machine's `PATH`, shows an
OS/package-manager-specific command with a copy
button, and lets you download the transcription model (`large-v3` by default, ~3.1 GB
— resumable if the download drops mid-way). Once the required tools and model are
verified, the button becomes "เริ่มใช้งาน ShotPrompt →" and
takes you into the app, and the header chip turns into a green "ระบบพร้อม" indicator.
(`libass` is checked and shown there and on the Settings page too, but is optional and
does not block that transition; see the subtitle-burning caveat above. GPU acceleration
is reported as unverified.)

You can revisit these checks any time from **Settings** (`/settings`), which also
lets you switch transcription models and manage disk usage (deleting videos/exports
lives there — the video library itself has no delete button, by design).

## AI highlight analysis

In **Settings → การเชื่อมต่อ AI สำหรับคัดช่วงคลิป**, create up to 20 named profiles.
Built-in choices are **OpenRouter**, **Gemini**, **Ollama**, **Local OpenAI-compatible**,
and **Custom API**. OpenRouter and Gemini use their OpenAI-compatible endpoints; Ollama
uses its native chat endpoint. Custom endpoints can use Ollama or OpenAI-compatible
protocols. ShotPrompt does not install or download an LLM.

For OpenRouter, enter an API key, save the profile, then search its model catalog or
type a model ID manually. Catalog entries may include context limits, prices and
structured-output support. Unknown metadata stays labeled unknown; a stale catalog
remains visible after a refresh failure. Other providers expose models when their
endpoint implements a compatible `/models` or Ollama `/api/tags` catalog.

For cloud inference, explicitly allow sending transcript content before testing or
analyzing. Choose JSON schema output when the model supports it, or JSON mode otherwise.
For OpenRouter schema output, routing requires an endpoint that supports the requested
parameters. Connection tests send only a tiny synthetic scoring-shaped request and may
incur a small provider charge; they do not measure model quality.

API keys are entered through the local Settings UI, encrypted with AES-256-GCM, and
stored separately from profile metadata in SQLite. They are not shown again or saved
in browser storage, job history, or logs. Back up `data/secrets/ai-vault.key` together
with the database: stored keys cannot be decrypted without that 32-byte master key.
On Unix, ShotPrompt sets the secret directory to mode 0700 and key file to 0600;
on Windows, access depends on the account's filesystem ACLs. If the master key is lost,
restore it from backup or remove the affected profiles before creating new credentials.
Profiles imported from the older single-provider setting need a successful connection
test and explicit activation before automatic analysis resumes.

Open **ตั้งค่าการคัดช่วงเด่น** on upload, or **ตั้งค่าการคัดช่วง / ประเมินใหม่**
in the workspace. Specify duration (5–180 seconds; default 15–60), an optional freeform
instruction (up to 500 characters), and maximum primary clips (1–30; default 10).
No predefined category is required. AI reads subtitle context, proposes ranges and
returns titles, summaries, tags, reasons and evidence. The server validates subtitle
IDs and computes the score: opening 20%, standalone clarity 25%, substance 25%,
closure 20%, instruction relevance 10%. Each dimension is 0–5; total is 0–100.
Scores rank content within a run; they do not predict virality or prove factual accuracy.
Language coverage and selection quality depend on the configured model.

The media pipeline finishes before a separate AI job starts. Without a configured
model, videos remain ready for manual editing and later analysis. Scene-only suggestions
have no content score. AI failures never silently fall back to keyword scores.
**ประเมินช่วงใหม่** reuses transcripts and scene times without rerunning Whisper;
failed/canceled runs leave previous results available. History preserves the model,
prompt/rubric version, configuration, request count and reported token usage (unknown
usage is shown as unavailable). Accepted clips preserve their original assessment
and display a notice after boundary edits. Feedback is local and does not train a model.

Request timeout defaults to 120 seconds (10–600), total run timeout to 1800 seconds
(60–7200). Transcript records are split into bounded context chunks; limits include
40 core chunks, 120 unique proposals and 160 model requests including repairs.
Oversized input, invalid evidence/output or expired deadlines fail the whole run
without publishing partial results. The server permits one repair per invalid response.

Old rules histories, scores and clips remain readable with their original values.
Legacy settings can be explicitly converted to AI instructions; category weights are
not reused. SQLite migrations preserve old data. History and thumbnails remain until
the video is deleted. Image/audio understanding (project C) is future work; current AI
content scoring uses subtitles. Real-model ranking accuracy still needs evaluation
with representative user recordings.

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
