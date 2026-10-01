# Cross-platform setup and runtime checks

**Status:** Design approved by the user on 2026-10-01. Implementation has not started.

## Intent and success criteria

ShotPrompt should give accurate setup instructions and usable readiness checks on macOS, Windows, and Linux. The Setup page continues to show commands for the user to copy; it does not run system installers. Existing uncommitted work in the original checkout remains separate from this branch.

The work is complete when FFmpeg accepts subtitle and font paths containing platform-specific syntax and common special characters; setup guidance reflects the detected platform, package manager, and supported architecture; readiness checks confirm the binaries and export encoder work; and automated tests run on macOS, Windows, and Linux without assuming the host platform.

## FFmpeg export paths

Escape values inserted into the `ass` video-filter description using FFmpeg filter syntax, including the additional escaping needed for Windows drive paths. Keep `buildExportArgs` inputs as ordinary filesystem paths and apply escaping only when constructing the filter. Cover POSIX and Windows-style paths with spaces, drive colons, backslashes, commas, brackets, quotes, and Unicode in unit tests.

## Setup guidance

Keep the existing `installGuide` response structure and extend its manager values only as needed. Detect Homebrew on macOS; Homebrew, `apt-get`, or `pacman` on Linux; and Scoop or WinGet on Windows. Use a manual guide for unrecognized managers and platforms. Show the WinGet FFmpeg command only for supported x64 hosts; other architectures receive release guidance rather than a misleading command. Clearly explain when Whisper needs its own installation step.

Commands remain copyable suggestions. README and Setup instructions must say to restart ShotPrompt after installing a binary or changing `PATH`, then recheck, because the running server retains its startup environment.

## Runtime readiness and acceleration

Extend `/system/doctor` to verify that `ffmpeg -version`, `ffprobe -version`, and `whisper-cli --help` can run. Inspect FFmpeg's filter list for subtitle support and its encoder list for `libx264`. Add a `libx264` capability field to the doctor response. Setup and the header's ready state require working FFmpeg, FFprobe, Whisper, `libx264`, and the selected model. `libass` remains an optional warning because subtitle burn-in is optional.

Keep the existing acceleration response field but report its backend as unverified. The current OS/architecture heuristic cannot establish which backend the installed Whisper binary actually uses; the UI must not label an unverified backend as active Metal or CPU acceleration.

Probe failures, missing commands, or missing capabilities return a false capability without crashing the doctor route. Tests inject probe results so route behavior is deterministic and does not depend on installed host binaries.

## Test and delivery plan

Add platform-neutral tests for path escaping, package-manager selection, unsupported architectures, probe success/failure, readiness criteria, and an OS-independent doctor response. Add a GitHub Actions matrix for macOS, Windows, and Ubuntu that installs Bun, then runs `bun test` and `bun run typecheck`.

Acceptance requires all three CI matrix jobs to pass. The implementation branch is `fix/cross-platform-support`; the branch starts from the current committed `HEAD`, and unrelated dirty changes remain in the original checkout.
