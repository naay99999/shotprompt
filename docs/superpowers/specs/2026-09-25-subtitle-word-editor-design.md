# Subtitle word timing and editor

**Status:** Conversational design approved on 2026-09-25; written spec pending review. This is the first of three subtitle work packages.

## Intent and delivery sequence

ShotPrompt users should be able to finish a Thai or English clip ready to post without leaving the app. The completed subtitle feature will let them choose grouped words or spoken-word highlighting, edit the result, style it, preview it, and export the same result. They may later choose original, translated, or bilingual subtitle tracks, with local automatic translation and manual entry or import.

Work proceeds in this order:

1. **This design:** word timing, grouping, and a word-level editor.
2. Style presets, visual controls, faithful preview, SRT, and video export from the edited timeline.
3. Local translation plus manual translated-track entry/import and bilingual display.

The subtitle feature is complete when every selected display and language mode agrees between editor preview and exported video. The first work package establishes the data and editing contract; the second connects it to final rendering. This design supersedes the MVP design's segment-only subtitle model where they conflict. Clip selection, hook scoring, trim, and crop behavior remain in their existing flows.

## Source timing pipeline

The current `transcribe` step streams Whisper segment text into `segments`. Preserve that stream because hook detection and progress reporting consume it. Enable the installed `whisper-cli` token timing and detailed JSON output in the same transcription pass. The local CLI exposes `--dtw` and `--output-json-full`; the implementation must check support for the configured model and validate the output shape before accepting it. The upstream CLI documents both options: <https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/README.md>.

After Whisper finishes, parse its detailed output into immutable source words associated with source segments. Thai and English text is segmented by word, not by whitespace alone. Map each word's character span to the timed tokens that cover it. Attach punctuation and surrounding spacing so joining the words reproduces the transcript text. Clamp valid times to the parent segment and preserve source order. If a token cannot be mapped reliably, assign an approximate time within the parent segment and mark that word `needsReview`; never silently claim exact alignment. Reject malformed or non-monotonic input rather than inserting a partial source-word set.

Write the source-word set in one transaction after validation. Keep the detailed JSON as a recoverable runtime artifact until the word transaction succeeds, then remove it. A failed word conversion leaves the existing segment transcript intact and exposes a retry action; it does not replace user-edited clip subtitles. If the installed CLI or selected model lacks required timing support, show an actionable unsupported state and retain segment-level editing.

## Persistent model

- `transcript_words`: immutable `id`, `segmentId`, order, text, absolute video start/end, and `needsReview`. `segments` remains the input to hook detection.
- `subtitle_tracks`: `id`, `clipId`, language, kind (`original` initially), display mode (`grouped` or `karaoke`), maximum words per cue (default 3, allowed 1–10), and an integer revision. The track model allows translated tracks in work package 3 without changing the word-editor contract.
- `subtitle_words`: stable `id`, `trackId`, order, text, absolute video start/end, `breakAfter`, `needsReview`, and nullable source-word reference. These rows are the editable copy for one clip.
- `subtitle_word_imports`: unique `(trackId, sourceWordId)` records which source words have ever been copied into a track. This record survives edits, merges, and deletion so a trim change cannot resurrect a removed word.

All timing is stored in seconds on the source-video timeline, matching current clip subtitles. The cue engine clamps visible words to the current clip and converts to clip-relative time only for preview or output. Every word must have nonempty visible text, finite time, `start < end`, and a range inside the source video. A track may retain words outside the current clip after a trim reduction.

## Cue engine and editing rules

A pure function in `packages/core` derives display cues from a track. A cue contains a contiguous sequence of words and their timing; karaoke mode adds the active word interval. The grouping limit is a **maximum**, so a user break, sentence-ending punctuation, or a speech gap of at least 0.8 seconds may end a cue earlier. An explicit `breakAfter` always wins. The same function and timing rules will feed editor preview, SRT, and video export; style and translation are separate inputs in later work packages.

The editor in the existing clip panel displays the video with a subtitle overlay, an ordered word list, and an adjustable time rail. Users can edit text, add/delete words, split at a chosen character boundary, merge adjacent words, adjust each word's start/end, set/remove a cue break, choose grouped/karaoke mode, and set the word limit. The preview updates immediately from the local draft. Split and merge preserve the complete text and time span; the user can then correct each boundary. Undo/redo covers all draft edits. Save is explicit and shows dirty/saving/error states; closing with unsaved changes prompts the user.

Overlapping adjacent words, gaps, and words outside the clip are shown as review issues. Invalid ranges block save with the affected word identified. Gaps and overlaps can be intentionally retained after the user reviews them, because speech can overlap; the renderer's active-word choice is deterministic by word order and latest start time. `needsReview` stays visible until the user edits or explicitly accepts that word.

The server exposes one versioned read/write contract for the track and its words. A write validates the whole draft and replaces its ordered words/configuration atomically; a revision mismatch returns a conflict rather than overwriting another edit. A successful response includes the new revision and canonical order. Existing segment-only subtitle endpoints remain available while old clips transition, and are retired only when SRT/export have moved to the new track model.

## Clip creation, trim, and existing data

Creating a clip copies overlapping source words into its original track when word alignment is available; otherwise the existing segment subtitle path remains available and the editor offers conversion later. Expanding a word-backed clip imports source words from the newly visible interval that do not appear in `subtitle_word_imports`; it never rewrites existing editable words. Shrinking only hides out-of-range words. Re-expanding reveals the same edits. Import and trim updates are transactional.

Existing `clip_subtitles` rows remain untouched until the user accepts a conversion. On opening an old clip, the editor offers a draft that splits its current edited text into words and distributes each row's existing time across those words. It preserves text and cue order, marks approximate times for review, and shows the draft before save. The user can instead request fresh Whisper-aligned words, compare the resulting text to the edited rows, and explicitly accept replacement. Conversion records source words already covered by the original clip range as imported, including words the user had removed, so later trim changes cannot reintroduce them. Declining either path leaves the old subtitle data and export behavior intact. Saving a converted track does not delete the old rows until the later renderer/export migration is complete.

## Boundaries and validation

`packages/core` owns text segmentation, token-to-word mapping, cue grouping, and time transforms. `apps/server` owns CLI invocation, JSON parsing, persistence, migrations, and route validation. `apps/web` owns editor draft state, preview controls, conflict display, and unsaved-change handling. A missing timing artifact or conversion failure is retryable without deleting source segments or clip edits. Unsupported model/CLI states are visible rather than silently falling back to inaccurate karaoke timing.

Focused verification should cover Thai text reconstruction, English punctuation, token mapping failures, deterministic grouping and active-word selection, split/merge and manual breaks, trim shrink/expand without resurrection, revision conflicts, failed conversion preserving legacy rows, and the editor's save/unsaved-change behavior. The existing core, database, server, and typecheck gates apply when implementation begins. No product code is changed by this design document.
