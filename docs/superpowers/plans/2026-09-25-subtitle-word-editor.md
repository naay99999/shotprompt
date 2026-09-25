# Subtitle Word Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable word timing and grouped/karaoke subtitle drafts while preserving existing transcripts and clip subtitles.

**Architecture:** Keep Whisper segment rows for hook detection and derive immutable timed source words from the same transcription. Copy source words into a versioned clip track; a pure cue function drives editor preview and later SRT/video rendering. Legacy segment subtitles remain available until the later rendering work package moves exports to tracks.

**Tech Stack:** Bun, TypeScript, bun:test, SQLite/Drizzle, Elysia/Eden, Next.js 16 App Router, React 19, whisper.cpp CLI.

**Spec:** `docs/superpowers/specs/2026-09-25-subtitle-word-editor-design.md`

## Global Constraints

- Preserve the current `segments` stream for hook detection and progress; word conversion must not erase it or edited clips.
- Thai and English words must reconstruct their source text, including punctuation and spacing; do not split Thai solely on whitespace.
- Store time as absolute source-video seconds; clamp and shift only in preview/output.
- Default grouping limit is 3 words; accept 1–10. Break early on explicit breaks, sentence punctuation, or speech gaps of at least 0.8 seconds.
- Keep the current `clip_subtitles` path until the next rendering work package. Do not silently replace an edited legacy clip.
- No new cloud dependency. Keep runtime JSON/audio under gitignored `data/`; never commit them.
- Follow `apps/web/AGENTS.md` and the installed Next.js client-component docs before web edits. Preserve unrelated work already present in the shared workspace.

## Review Focus

1. Thai text without spaces and mixed punctuation must round-trip exactly through segmentation; Task 1 pins this.
2. Whisper output with missing/reordered token times must mark approximate words or reject the batch without deleting segments; Tasks 1 and 4 pin this.
3. A deleted/merged word must not reappear after shrinking and re-expanding a clip; Task 5 pins this.
4. Two open editors must not silently overwrite each other; Task 6 pins a revision conflict.
5. Closing or changing clips with an unsaved draft must preserve the user's chance to save or discard; Tasks 7 and 8 pin this.

## File map and dependency order

| File | Responsibility |
| --- | --- |
| `packages/core/src/subtitle-words.ts` | Thai/English surface segmentation and token-to-word alignment. |
| `packages/core/src/subtitle-cues.ts` | Deterministic grouping, clipping, active-word selection. |
| `packages/core/src/subtitle-edits.ts` | Pure split/merge/add/delete/time edits for undoable UI drafts. |
| `packages/db/src/schema.ts`, `packages/db/src/client.ts` | Four new word/track tables and startup-safe DDL. |
| `apps/server/src/steps/word-output.ts` | Validate/parse detailed Whisper JSON and save source words atomically. |
| `apps/server/src/steps/transcribe.ts`, `packages/core/src/whisper.ts` | Request DTW/JSON and preserve segment streaming. |
| `apps/server/src/word-alignment-runner.ts`, `apps/server/src/context.ts` | Queue retry on the same CPU-bound queue without changing clip edits. |
| `apps/server/src/subtitle-track-service.ts` | Track creation, import markers, trim behavior, revisioned writes. |
| `apps/server/src/legacy-subtitle-service.ts` | Draft conversion of old rows and alignment comparison. |
| `apps/server/src/routes/subtitle-tracks.ts` | Versioned track, conversion, and retry endpoints. |
| `apps/web/lib/subtitle-draft.ts` | Undo/redo, dirty state, validation, save outcome. |
| `apps/web/lib/subtitle-overlay.ts` | Select visible cue and active word from source player time. |
| `apps/web/components/subtitle-word-editor.tsx` | Editing controls, time rail, conversion/review UI. |
| `apps/web/components/subtitle-preview.tsx` | Provisional text overlay using the shared cue engine. |
| `apps/web/components/clip-editor.tsx`, `apps/web/app/videos/[id]/page.tsx` | Mount the editor and pass current player time/close interception. |

### Task 1: Segment and align source words

**Files:** Create `packages/core/src/subtitle-words.ts`, `packages/core/test/subtitle-words.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces:**
- Produces `segmentSurface(text: string, language: Language): string[]` and `alignSegmentWords(segment: TranscriptSegment, tokens: TimedToken[], language: Language): SourceWord[]`.
- `TimedToken = { text: string; start: number | null; end: number | null }`; `SourceWord = { text: string; start: number; end: number; needsReview: boolean }`.
- The parser in Task 4 supplies seconds, not Whisper's raw timestamp units.

- [ ] **Step 1: Write failing behavior tests.**

```ts
expect(segmentSurface('ลดราคา50% วันนี้!', 'th').join('')).toBe('ลดราคา50% วันนี้!')
expect(segmentSurface('Hello, world!', 'en')).toEqual(['Hello, ', 'world!'])
const words = alignSegmentWords({ start: 1, end: 3, text: 'Hello world' }, [
  { text: 'Hello', start: 1, end: 1.6 }, { text: ' world', start: 1.6, end: 3 },
], 'en')
expect(words.map(w => w.text).join('')).toBe('Hello world')
expect(words.map(w => w.needsReview)).toEqual([false, false])
expect(alignSegmentWords({ start: 1, end: 3, text: 'Hi there' }, [
  { text: 'different', start: null, end: null },
], 'en').every(w => w.needsReview)).toBe(true)
```

- [ ] **Step 2: Run** `bun test packages/core/test/subtitle-words.test.ts`; expect failure because the module is absent.
- [ ] **Step 3: Implement the focused pure functions.** Use `Intl.Segmenter(language, { granularity: 'word' })`; attach non-word pieces to the preceding word, or hold leading pieces for the first word. Build character spans for both the reconstructed token string and word surfaces. Map intersecting timed tokens to each word; when text or times do not line up, distribute the parent segment's time by visible character weight and set `needsReview: true`. Reject a segment with non-finite or reversed bounds before mapping.

```ts
export type TimedToken = { text: string; start: number | null; end: number | null }
export type SourceWord = { text: string; start: number; end: number; needsReview: boolean }
export function segmentSurface(text: string, language: Language): string[] {
  const words: string[] = []
  let leading = ''
  for (const part of new Intl.Segmenter(language, { granularity: 'word' }).segment(text)) {
    if (part.isWordLike) { words.push(leading + part.segment); leading = '' }
    else if (words.length) words[words.length - 1] += part.segment
    else leading += part.segment
  }
  if (leading) words.push(leading)
  return words
}
export function alignSegmentWords(segment: TranscriptSegment, tokens: TimedToken[], language: Language): SourceWord[] {
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start >= segment.end)
    throw new Error('invalid segment range')
  const surfaces = segmentSurface(segment.text, language)
  const weights = surfaces.map(surface => Math.max(1, Array.from(surface).length))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let used = 0
  const approximate = surfaces.map((text, index) => {
    const start = segment.start + (used / total) * (segment.end - segment.start)
    used += weights[index]
    const end = segment.start + (used / total) * (segment.end - segment.start)
    return { text, start, end, needsReview: true }
  })
  if (tokens.map(token => token.text).join('') !== segment.text) return approximate
  let previousStart = segment.start
  for (const token of tokens) {
    if (token.start === null || token.end === null || !Number.isFinite(token.start) ||
        !Number.isFinite(token.end) || token.start < previousStart || token.start >= token.end)
      return approximate
    previousStart = token.start
  }
  let cursor = 0
  const spans = tokens.map(token => {
    const start = cursor
    cursor += token.text.length
    return { ...token, charStart: start, charEnd: cursor }
  })
  cursor = 0
  return surfaces.map((text, index) => {
    const charStart = cursor
    cursor += text.length
    const hits = spans.filter(token => token.charEnd > charStart && token.charStart < cursor)
    const start = Math.max(segment.start, hits[0]?.start ?? NaN)
    const end = Math.min(segment.end, hits.at(-1)?.end ?? NaN)
    return Number.isFinite(start) && Number.isFinite(end) && start < end
      ? { text, start, end, needsReview: false } : approximate[index]
  })
}
```

- [ ] **Step 4: Run** `bun test packages/core/test/subtitle-words.test.ts`; expect pass. Add cases for Thai with no spaces, leading punctuation, zero/negative token bounds, and Unicode combining marks before closing the task.
- [ ] **Step 5: Commit** `packages/core/src/subtitle-words.ts packages/core/test/subtitle-words.test.ts packages/core/src/index.ts` as `feat(core): align subtitle words`.

### Task 2: Derive cues and pure edit operations

**Files:** Create `packages/core/src/subtitle-cues.ts`, `packages/core/src/subtitle-edits.ts`, `packages/core/test/subtitle-cues.test.ts`, `packages/core/test/subtitle-edits.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces:**
- Consumes `SourceWord` time/text semantics from Task 1.
- Produces `SubtitleWord = { id: string; text: string; start: number; end: number; breakAfter: boolean; needsReview: boolean; sourceWordId: number | null }`, `Cue = { start: number; end: number; words: SubtitleWord[] }`.
- Produces `SubtitleTrackDraft = { revision: number; mode: 'grouped' | 'karaoke'; maxWords: number; words: SubtitleWord[] }` for the server write and web draft.
- Produces `buildSubtitleCues(words: SubtitleWord[], clipStart: number, clipEnd: number, maxWords: number): Cue[]`, `activeWordAt(cue: Cue, clipTime: number): SubtitleWord | null`, and `editSubtitleWords(words: SubtitleWord[], action: WordEdit): SubtitleWord[]`. Input word times are source-absolute; `Cue.start/end` and its copied word times are clip-relative.

- [ ] **Step 1: Write failing tests for grouping and editing.**

```ts
const words = [
  { id: '1', text: 'One ', start: 1, end: 1.3, breakAfter: false, needsReview: false, sourceWordId: 1 },
  { id: '2', text: 'two. ', start: 1.3, end: 1.6, breakAfter: false, needsReview: false, sourceWordId: 2 },
  { id: '3', text: 'Three', start: 2.5, end: 3, breakAfter: false, needsReview: false, sourceWordId: 3 },
]
expect(buildSubtitleCues(words, 1, 3, 3).map(c => c.words.length)).toEqual([2, 1])
expect(activeWordAt({ start: 1, end: 1.6, words: words.slice(0, 2) }, 1.4)?.id).toBe('2')
expect(editSubtitleWords(words, { type: 'delete', id: '2' }).map(w => w.id)).toEqual(['1', '3'])
```

- [ ] **Step 2: Run** `bun test packages/core/test/subtitle-cues.test.ts packages/core/test/subtitle-edits.test.ts`; expect missing exports.
- [ ] **Step 3: Implement cue and edit functions.** Keep source seconds; filter words overlapping the clip, clamp only returned cue/word times, group on `breakAfter`, `.?!` or Thai `ฯ`, a gap `>= 0.8`, and `maxWords`. Split must use a chosen Unicode character boundary, preserve concatenated text and full time span, and assign a new UUID to the right half. Merge adjacent IDs only and preserve both original source IDs through the import-marker table rather than on the merged row. `activeWordAt` chooses the covering word with latest start, then original order.

```ts
export type SubtitleWord = {
  id: string; text: string; start: number; end: number;
  breakAfter: boolean; needsReview: boolean; sourceWordId: number | null
}
export type SubtitleTrackDraft = {
  revision: number; mode: 'grouped' | 'karaoke'; maxWords: number; words: SubtitleWord[]
}
export type Cue = { start: number; end: number; words: SubtitleWord[] }
export type WordEdit =
  | { type: 'text'; id: string; text: string }
  | { type: 'time'; id: string; start: number; end: number }
  | { type: 'split'; id: string; offset: number; rightId: string }
  | { type: 'mergeNext'; id: string }
  | { type: 'add'; afterId: string | null; word: SubtitleWord }
  | { type: 'delete'; id: string }
  | { type: 'break'; id: string; value: boolean }
  | { type: 'accept'; id: string }
export function editSubtitleWords(words: SubtitleWord[], action: WordEdit): SubtitleWord[] {
  const index = 'id' in action ? words.findIndex(word => word.id === action.id) : -1
  if (action.type === 'add') {
    const at = action.afterId === null ? -1 : words.findIndex(word => word.id === action.afterId)
    if (action.afterId !== null && at < 0) throw new Error('previous word not found')
    return [...words.slice(0, at + 1), action.word, ...words.slice(at + 1)]
  }
  if (index < 0) throw new Error('word not found')
  if (action.type === 'delete') return words.filter(word => word.id !== action.id)
  if (action.type === 'text') return words.map(word => word.id === action.id ? { ...word, text: action.text, needsReview: false } : word)
  if (action.type === 'time') return words.map(word => word.id === action.id ? { ...word, start: action.start, end: action.end, needsReview: false } : word)
  if (action.type === 'break') return words.map(word => word.id === action.id ? { ...word, breakAfter: action.value } : word)
  if (action.type === 'accept') return words.map(word => word.id === action.id ? { ...word, needsReview: false } : word)
  if (action.type === 'mergeNext') {
    if (index + 1 >= words.length) throw new Error('next word not found')
    const next = words[index + 1]
    const merged = { ...words[index], text: words[index].text + next.text,
      start: Math.min(words[index].start, next.start), end: Math.max(words[index].end, next.end),
      breakAfter: next.breakAfter, needsReview: true }
    return [...words.slice(0, index), merged, ...words.slice(index + 2)]
  }
  const word = words[index]
  const boundaries = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word.text),
    part => part.index))
  if (!boundaries.has(action.offset) || action.offset <= 0 || action.offset >= word.text.length)
    throw new Error('split must use a character boundary inside the word')
  const left = { ...word, text: word.text.slice(0, action.offset), end: (word.start + word.end) / 2, needsReview: true }
  const right = { ...word, id: action.rightId, sourceWordId: null, text: word.text.slice(action.offset), start: left.end, needsReview: true }
  return [...words.slice(0, index), left, right, ...words.slice(index + 1)]
}
export function buildSubtitleCues(words: SubtitleWord[], clipStart: number, clipEnd: number, maxWords: number): Cue[] {
  if (!Number.isInteger(maxWords) || maxWords < 1 || maxWords > 10) throw new Error('invalid word limit')
  const visible = words.filter(word => word.end > clipStart && word.start < clipEnd)
    .map(word => ({ ...word, start: Math.max(word.start, clipStart) - clipStart,
      end: Math.min(word.end, clipEnd) - clipStart }))
  const cues: Cue[] = []
  let group: SubtitleWord[] = []
  const flush = () => {
    if (group.length) cues.push({ start: group[0].start, end: group.at(-1)!.end, words: group })
    group = []
  }
  for (const word of visible) {
    const previous = group.at(-1)
    if (previous && (group.length >= maxWords || previous.breakAfter ||
        /[.!?ฯ]\s*$/.test(previous.text) || word.start - previous.end >= 0.8)) flush()
    group.push(word)
  }
  flush()
  return cues
}
export function activeWordAt(cue: Cue, clipTime: number): SubtitleWord | null {
  return cue.words.filter(word => word.start <= clipTime && clipTime < word.end)
    .reduce<SubtitleWord | null>((active, word) => !active || word.start >= active.start ? word : active, null)
}
```

- [ ] **Step 4: Run** focused core tests; expect pass. Include manual break, 1/10-word limits, straddling clip edges, equal-time overlap choice, split/merge text preservation, and insertion/deletion order.
- [ ] **Step 5: Commit** the five core paths as `feat(core): derive and edit subtitle cues`.

### Task 3: Add persistent word and track tables

**Files:** Modify `packages/db/src/schema.ts`, `packages/db/src/client.ts`; create `packages/db/test/subtitle-schema.test.ts`.

**Interfaces:** Produces Drizzle exports `transcriptWords` (`videoId`, `generation`, `generatedAt`, `segmentId`, `position`, text/time/review), `subtitleTracks` (nullable `sourceGeneration`), `subtitleWords`, `subtitleWordImports`; track `revision` starts at `0`, and import rows have a unique `(trackId, sourceWordId)` pair. A track pins one immutable source generation so repair/retranscription cannot resurrect edited words.

- [ ] **Step 1: Write a failing in-memory DB test.**

```ts
const db = createDb(':memory:')
db.insert(subtitleTracks).values({ id: 't1', clipId: 'c1', language: 'th', kind: 'original', mode: 'grouped', maxWords: 3, revision: 0 }).run()
db.insert(subtitleWordImports).values({ trackId: 't1', sourceWordId: 7 }).run()
expect(() => db.insert(subtitleWordImports).values({ trackId: 't1', sourceWordId: 7 }).run()).toThrow()
expect(db.select().from(subtitleTracks).get()?.maxWords).toBe(3)
```

- [ ] **Step 2: Run** `bun test packages/db/test/subtitle-schema.test.ts`; expect missing schema exports.
- [ ] **Step 3: Add four tables to both Drizzle schema and startup DDL.** Keep `CREATE TABLE IF NOT EXISTS` so existing databases open without destructive migration; use indexes for `(video_id, generation, segment_id, position)`, unique `(clip_id, kind, language)`, `(track_id, position)`, and a unique import pair. Keep `clip_subtitles` unchanged.

```ts
export const transcriptWords = sqliteTable('transcript_words', {
  id: integer('id').primaryKey({ autoIncrement: true }), videoId: text('video_id').notNull(),
  generation: text('generation').notNull(), generatedAt: integer('generated_at').notNull(),
  segmentId: integer('segment_id').notNull(),
  position: integer('position').notNull(),
  text: text('text').notNull(), start: real('start').notNull(), end: real('end').notNull(),
  needsReview: integer('needs_review', { mode: 'boolean' }).notNull(),
})
export const subtitleTracks = sqliteTable('subtitle_tracks', {
  id: text('id').primaryKey(), clipId: text('clip_id').notNull(), language: text('language').notNull(),
  kind: text('kind').notNull(), sourceGeneration: text('source_generation'),
  mode: text('mode').notNull(), maxWords: integer('max_words').notNull(),
  revision: integer('revision').notNull().default(0),
})
```

- [ ] **Step 4: Run** the focused DB test; expect pass. Reopen a temporary on-disk DB twice and confirm existing `clip_subtitles` rows remain intact.
- [ ] **Step 5: Commit** the schema, DDL, and test as `feat(db): store subtitle words and tracks`.

### Task 4: Materialize word timing from Whisper output

**Files:** Modify `packages/core/src/whisper.ts`, `apps/server/src/steps/transcribe.ts`, `apps/server/src/routes/system.ts`; create `apps/server/src/steps/word-output.ts`, `apps/server/test/word-output.test.ts`; extend `packages/core/test/whisper.test.ts`.

**Interfaces:** Consumes `alignSegmentWords` from Task 1 and `transcriptWords` from Task 3. Produces `parseWhisperWordOutput(json: unknown, segments: SegmentRow[], language: Language): SourceWordRow[]` and `saveSourceWords(db: DB, videoId: string, generation: string, rows: SourceWordRow[]): void`. `SegmentRow = Pick<typeof segments.$inferSelect, 'id' | 'start' | 'end' | 'text'>`; `SourceWordRow` includes `segmentId`, `position`, `text`, `start`, `end`, `needsReview`.

- [ ] **Step 1: Write failing parser and argument tests.** Include a JSON fixture with token text/time, malformed JSON, absent token times, and out-of-order segment times. Assert that missing token times produce flagged words while out-of-order segment times reject the batch. Assert CLI args include `-dtw large.v3 -ojf -of /tmp/words` for `large-v3` and retain `-pp` for streaming progress.

```ts
expect(buildWhisperArgs({ model: '/models/large-v3.bin', audio: '/tmp/a.wav', language: 'th',
  dtwPreset: 'large.v3', outputBase: '/tmp/words' })).toEqual(expect.arrayContaining(['-dtw', 'large.v3', '-ojf', '-of', '/tmp/words', '-pp']))
const json = { transcription: [{ text: 'Hello world', offsets: { from: 1000, to: 3000 }, tokens: [
  { text: 'Hello', offsets: { from: 1000, to: 1600 } },
  { text: ' world', offsets: { from: 1600, to: 3000 } },
] }] }
expect(parseWhisperWordOutput(json, [{ id: 1, start: 1, end: 3, text: 'Hello world' }], 'en')
  .map(word => word.start)).toEqual([1, 1.6])
expect(() => parseWhisperWordOutput({ transcription: [{ text: 'broken', tokens: [] }] },
  [{ id: 1, start: 2, end: 1, text: 'broken' }], 'en')).toThrow()
```
- [ ] **Step 2: Run** `bun test apps/server/test/word-output.test.ts packages/core/test/whisper.test.ts`; expect failures for missing parser/args.
- [ ] **Step 3: Implement parsing and pipeline integration.** Extend `buildWhisperArgs` with `{ dtwPreset, outputBase }`; map supported configured models to whisper.cpp DTW preset names and check CLI help for `--dtw`/`--output-json-full` before requesting them. The [upstream JSON writer](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp) emits `transcription[].tokens[].text` and `offsets.from/to` in milliseconds; convert those offsets to seconds. Continue parsing stdout segments as today. On CLI success, parse the JSON file, match JSON segments to streamed DB segments by ordered time/text, then call `saveSourceWords` in one transaction and remove the JSON artifact. Assign the whole batch one new generation and `generatedAt` value. Retain prior generations pinned by tracks, prune unpinned older generations, and make new clips use the newest complete generation by `generatedAt` and generation ID. A word-conversion failure retains JSON and is reported as retryable while the segment pipeline continues to hook detection; a transcription failure retains the existing pipeline failure behavior. Expose timing capability/status through `/system/doctor`. Task 6 owns audio recreation for older videos.

```ts
export function saveSourceWords(db: DB, videoId: string, generation: string, rows: SourceWordRow[]): void {
  db.transaction(tx => {
    const generatedAt = Date.now()
    if (rows.length) tx.insert(transcriptWords).values(rows.map(row => ({ ...row, videoId, generation, generatedAt }))).run()
  })
}
```

- [ ] **Step 4: Run** focused parser/Whisper tests; expect pass. Test interrupted conversion and retry from retained JSON with a fake `JobCtx`, asserting the original segment text and edited `clip_subtitles` remain.
- [ ] **Step 5: Commit** the listed files as `feat(server): capture whisper word timing`.

### Task 5: Copy words to clips and preserve edits across trim

**Files:** Create `apps/server/src/subtitle-track-service.ts`, `apps/server/test/subtitle-track-service.test.ts`; modify `apps/server/src/clip-service.ts`, `apps/server/src/routes/clips.ts`, `apps/server/src/routes/videos.ts`.

**Interfaces:** Produces `ensureOriginalTrack(db: DB, clipId: string): typeof subtitleTracks.$inferSelect | null` and `importVisibleSourceWords(db: DB, trackId: string, from: number, to: number): void` for Task 6.

- [ ] **Step 1: Write failing clip-service tests.** Seed three `transcriptWords` and create a clip across two. Delete one editable word, expand, shrink, and re-expand; expect only the newly revealed third source word to be added and the deleted one to stay absent. Test a word straddling the old boundary and a clip created before word alignment.

```ts
const clip = createClip(db, 'v1', { start: 1, end: 3 })
const track = ensureOriginalTrack(db, clip.id)!
const removed = db.select().from(subtitleWords).where(eq(subtitleWords.trackId, track.id)).get()!
db.delete(subtitleWords).where(eq(subtitleWords.id, removed.id)).run()
updateClip(db, clip.id, { end: 5 })
updateClip(db, clip.id, { end: 2 })
updateClip(db, clip.id, { end: 5 })
expect(db.select().from(subtitleWords).where(eq(subtitleWords.id, removed.id)).get()).toBeUndefined()
expect(db.select().from(subtitleWords).where(eq(subtitleWords.trackId, track.id)).all()
  .some(word => word.sourceWordId === removed.sourceWordId)).toBe(false)
expect(db.select().from(subtitleWordImports).where(eq(subtitleWordImports.trackId, track.id)).all()).toHaveLength(3)
```
- [ ] **Step 2: Run** `bun test apps/server/test/subtitle-track-service.test.ts`; expect missing track-service exports.
- [ ] **Step 3: Implement transactional import and cleanup.** On clip creation, create an original track when source words exist. For extension, query only source words overlapping the newly exposed interval and skip any source ID already in `subtitle_word_imports`. Record every import separately from editable rows. Renumber positions after import without changing existing IDs, text, times, or manual breaks. On clip/video deletion, delete imports and words before tracks and source words before segments. Preserve the legacy segment-copy path.

```ts
export function importVisibleSourceWords(db: DB, trackId: string, from: number, to: number): void {
  db.transaction(tx => {
    const track = tx.select().from(subtitleTracks).where(eq(subtitleTracks.id, trackId)).get()!
    if (!track.sourceGeneration) return
    const clip = tx.select().from(clips).where(eq(clips.id, track.clipId)).get()!
    const seen = new Set(tx.select({ sourceWordId: subtitleWordImports.sourceWordId })
      .from(subtitleWordImports).where(eq(subtitleWordImports.trackId, trackId)).all()
      .map(row => row.sourceWordId))
    const unseen = tx.select().from(transcriptWords)
      .where(and(eq(transcriptWords.videoId, clip.videoId), eq(transcriptWords.generation, track.sourceGeneration!),
        gt(transcriptWords.end, from), lt(transcriptWords.start, to)))
      .orderBy(transcriptWords.start, transcriptWords.position).all()
      .filter(word => !seen.has(word.id))
    const nextPosition = tx.select().from(subtitleWords)
      .where(eq(subtitleWords.trackId, trackId)).all().length
    if (unseen.length) {
      tx.insert(subtitleWords).values(unseen.map((word, i) => ({
        id: crypto.randomUUID(), trackId, position: nextPosition + i,
        text: word.text, start: word.start, end: word.end, breakAfter: false,
        needsReview: word.needsReview, sourceWordId: word.id,
      }))).run()
      tx.insert(subtitleWordImports).values(unseen.map(word => ({ trackId, sourceWordId: word.id }))).run()
    }
    const ordered = tx.select().from(subtitleWords).where(eq(subtitleWords.trackId, trackId)).all()
      .sort((a, b) => a.start - b.start || a.position - b.position)
    ordered.forEach((word, position) => tx.update(subtitleWords).set({ position })
      .where(eq(subtitleWords.id, word.id)).run())
  })
}
```

- [ ] **Step 4: Run** focused service and existing `apps/server/test/clips.test.ts`; expect pass. Check that patching crop alone imports no words.
- [ ] **Step 5: Commit** service, route cleanup, and tests as `feat(server): preserve subtitle word edits across trim`.

### Task 6: Versioned track API and safe legacy conversion

**Files:** Create `apps/server/src/legacy-subtitle-service.ts`, `apps/server/src/routes/subtitle-tracks.ts`, `apps/server/src/word-alignment-runner.ts`, `apps/server/test/subtitle-tracks.test.ts`; modify `apps/server/src/app.ts`, `apps/server/src/context.ts`, `apps/server/src/queue.ts`, and `apps/server/src/subtitle-track-service.ts`.

**Interfaces:**
- `GET /clips/:id/subtitle-track` returns `{ track, words, revision, legacyRows, alignmentStatus }`; 404 if clip absent.
- `PUT /clips/:id/subtitle-track` accepts `SubtitleTrackDraft`, atomically validates and saves, returns the new view; stale revision returns 409.
- `POST /clips/:id/subtitle-track/legacy-draft` returns a non-persistent word draft from edited legacy rows; `POST /clips/:id/subtitle-track/aligned-draft` returns a non-persistent source-aligned draft plus text comparison. Only PUT persists either draft.
- `POST /videos/:id/subtitle-words/retry` creates a `subtitle-words` job and returns `{ jobId }` with status 202. The existing CPU-bound pipeline queue dispatches this job to `word-alignment-runner`, avoiding concurrent Whisper runs. The runner retries conversion from retained JSON, or regenerates audio and timing for older videos, without clearing edited clips or `segments`.

- [ ] **Step 1: Write route tests through `app.handle(new Request('http://x/...'))`.** Assert 404 for missing clip, 400 for reversed/NaN/out-of-video word times or `maxWords=11`, 409 on stale revision, successful revision increment, and unchanged DB rows after each rejected write. For a legacy clip, assert draft text joins back to the edited row, all approximate words have `needsReview`, and requesting a draft does not mutate DB.

```ts
const request = (revision: number) => new Request('http://x/clips/cl1/subtitle-track', {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ revision, mode: 'grouped', maxWords: 3, words: [
    { id: 'w1', text: 'Hi', start: 1, end: 2, breakAfter: false, needsReview: false, sourceWordId: null },
  ] }),
})
expect((await app.handle(request(0))).status).toBe(200)
expect((await app.handle(request(0))).status).toBe(409)
```
- [ ] **Step 2: Run** `bun test apps/server/test/subtitle-tracks.test.ts`; expect 404/missing route failures.
- [ ] **Step 3: Implement the Elysia schemas, service transactions, legacy drafts, and retry job.** Parse finite numbers server-side even if Elysia accepts JSON numbers. Preserve UUIDs for existing words, assign new UUIDs on add/split, and reject duplicate IDs. Validate every non-null `sourceWordId` belongs to the track's video and pinned generation. Use `UPDATE subtitle_tracks SET revision = revision + 1 WHERE id = ? AND revision = ?` inside the transaction, then replace ordered editable rows; rollback on any validation failure. Legacy draft timing uses each old row's bounds and visible-character weighting. When a draft is accepted, mark source words overlapping the original clip range imported before saving. Return a text comparison for aligned draft; never auto-accept it. Make `context.ts` dispatch `subtitle-words` jobs through the same `pipelineQueue`, and make `queue.ts` emit the row's actual job type. The alignment runner calls `extractAudio.run` only when `audio.wav` is absent, runs Whisper with DTW/JSON without inserting segment rows, saves a new source-word generation, and deletes temporary audio on success. Leave `videos.status` unchanged on retry failure.

```ts
type TrackView = { track: typeof subtitleTracks.$inferSelect; words: SubtitleWord[]; revision: number }
export function replaceTrack(db: DB, clipId: string, draft: SubtitleTrackDraft): TrackView {
  return db.transaction(tx => {
    const track = tx.select().from(subtitleTracks)
      .where(and(eq(subtitleTracks.clipId, clipId), eq(subtitleTracks.kind, 'original'))).get()
    if (!track) throw new Error('track not found')
    const clip = tx.select().from(clips).where(eq(clips.id, clipId)).get()!
    const video = tx.select().from(videos).where(eq(videos.id, clip.videoId)).get()!
    if (!Number.isInteger(draft.maxWords) || draft.maxWords < 1 || draft.maxWords > 10) throw new Error('invalid word limit')
    if (new Set(draft.words.map(word => word.id)).size !== draft.words.length) throw new Error('duplicate word ID')
    for (const word of draft.words) {
      if (!word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) ||
          word.start < 0 || word.end > video.duration! || word.start >= word.end) throw new Error(`invalid word ${word.id}`)
    }
    const updated = tx.update(subtitleTracks).set({ mode: draft.mode, maxWords: draft.maxWords, revision: draft.revision + 1 })
      .where(and(eq(subtitleTracks.id, track.id), eq(subtitleTracks.revision, draft.revision))).returning().get()
    if (!updated) throw new Error('revision conflict')
    tx.delete(subtitleWords).where(eq(subtitleWords.trackId, track.id)).run()
    if (draft.words.length) tx.insert(subtitleWords).values(draft.words.map((word, position) => ({ ...word, trackId: track.id, position }))).run()
    return { track: updated, words: draft.words, revision: updated.revision }
  })
}
const pipelineRunner = makePipelineRunner(db)
const wordRunner = makeWordAlignmentRunner(db)
const pipelineQueue = new JobQueue(db, 'pipeline', (jobId, jobCtx) => {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()!
  return job.type === 'subtitle-words' ? wordRunner(jobId, jobCtx) : pipelineRunner(jobId, jobCtx)
})
```

- [ ] **Step 4: Run** focused route tests and existing `apps/server/test/clips.test.ts`; expect pass. Add a retry test that leaves legacy rows and segments unchanged on conversion failure.
- [ ] **Step 5: Commit** route/service/test changes as `feat(server): edit versioned subtitle tracks`.

### Task 7: Build undoable editor draft state

**Files:** Create `apps/web/lib/subtitle-draft.ts`, `apps/web/test/subtitle-draft.test.ts`.

**Interfaces:** Consumes `SubtitleWord`, `WordEdit`, `SubtitleTrackDraft`, and `editSubtitleWords` from Task 2. Produces `SubtitleDraft = { past: SubtitleTrackDraft[]; present: SubtitleTrackDraft; future: SubtitleTrackDraft[]; saved: SubtitleTrackDraft; dirty: boolean }` and `reduceSubtitleDraft(state, action)` with `edit`, `config`, `undo`, `redo`, `saved`, and `load` actions.

- [ ] **Step 1: Write failing reducer tests.** Apply split, time edit, undo twice, redo once, and save; assert restored text/time, dirty state, and revision. Simulate save failure by leaving state unchanged, then assert a clip switch reports dirty. Test new server data does not overwrite a dirty draft.

```ts
const value: SubtitleTrackDraft = { revision: 0, mode: 'grouped', maxWords: 3, words: [
  { id: 'w1', text: 'Hello', start: 1, end: 2, breakAfter: false, needsReview: false, sourceWordId: null },
] }
const initial: SubtitleDraft = { past: [], present: value, future: [], saved: value, dirty: false }
const serverCopy = { ...value, revision: 1 }
const edited = reduceSubtitleDraft(initial, { type: 'edit', edit: { type: 'split', id: 'w1', offset: 2, rightId: 'w2' } })
expect(edited.present.words.map(word => word.text).join('')).toBe(initial.present.words[0].text)
expect(edited.dirty).toBe(true)
const undone = reduceSubtitleDraft(edited, { type: 'undo' })
expect(undone.present.words).toEqual(initial.present.words)
expect(undone.dirty).toBe(false)
expect(reduceSubtitleDraft(edited, { type: 'load', value: serverCopy })).toBe(edited)
```
- [ ] **Step 2: Run** `bun test apps/web/test/subtitle-draft.test.ts`; expect missing reducer.
- [ ] **Step 3: Implement immutable history and validation helpers.** Store at most 100 prior snapshots. A new edit clears redo history; successful save updates the saved baseline revision and clears dirty without discarding the latest draft. A failed save changes only the error message in the consuming component. Expose `draftIssues(present, clipRange, duration)` with word IDs and issue codes (`invalid-range`, `overlap`, `gap`, `outside-clip`, `needs-review`).

```ts
export type DraftAction =
  | { type: 'edit'; edit: WordEdit }
  | { type: 'config'; mode: 'grouped' | 'karaoke'; maxWords: number }
  | { type: 'undo' } | { type: 'redo' }
  | { type: 'saved'; revision: number } | { type: 'load'; value: SubtitleTrackDraft }
export function reduceSubtitleDraft(state: SubtitleDraft, action: DraftAction): SubtitleDraft {
  if (action.type === 'load') return state.dirty ? state : {
    past: [], present: action.value, future: [], saved: action.value, dirty: false,
  }
  if (action.type === 'saved') {
    const present = { ...state.present, revision: action.revision }
    return { ...state, present, saved: present, dirty: false }
  }
  if (action.type === 'undo' && state.past.length === 0) return state
  if (action.type === 'redo' && state.future.length === 0) return state
  const past = action.type === 'undo' ? state.past.slice(0, -1) :
    [...state.past, state.present].slice(-100)
  const present = action.type === 'undo' ? state.past.at(-1) ?? state.present :
    action.type === 'redo' ? state.future[0] ?? state.present :
    action.type === 'config' ? { ...state.present, mode: action.mode, maxWords: action.maxWords } :
    { ...state.present, words: editSubtitleWords(state.present.words, action.edit) }
  const future = action.type === 'undo' ? [state.present, ...state.future] :
    action.type === 'redo' ? state.future.slice(1) : []
  return { ...state, past, present, future, dirty: JSON.stringify(present) !== JSON.stringify(state.saved) }
}
```

- [ ] **Step 4: Run** focused web tests; expect pass. Assert Unicode split boundaries and a dirty draft survive a stale load response.
- [ ] **Step 5: Commit** reducer and tests as `feat(web): keep undoable subtitle drafts`.

### Task 8: Add word editor controls and video overlay

**Files:** Create `apps/web/components/subtitle-word-editor.tsx`, `apps/web/components/subtitle-preview.tsx`, `apps/web/lib/subtitle-overlay.ts`, `apps/web/test/subtitle-overlay.test.ts`; modify `apps/web/components/clip-editor.tsx`, `apps/web/app/videos/[id]/page.tsx`.

**Interfaces:** Consumes Task 6's Eden endpoints, Task 7's reducer, Task 2's cue engine. `SubtitleWordEditor` receives `{ clipId, clipStart, clipEnd, duration, currentTime, videoContainerRef, onDirtyChange }`; `SubtitlePreview` receives `{ words, mode, maxWords, clipStart, clipEnd, currentTime, containerRef }`.

- [ ] **Step 1: Write a failing preview selector test.** This owns the source-time to clipped-cue boundary used by the player; reducer tests already own edit rules. Keep save/error/close behavior in the manual acceptance step rather than adding a new browser-test dependency.

```ts
const overlay = subtitleOverlayAt(words, 'karaoke', 3, 10, 20, 12.25)
expect(overlay?.cue.start).toBe(2) // clip-relative cue time
expect(overlay?.activeWordId).toBe('w2') // source-time active word
expect(subtitleOverlayAt(words, 'grouped', 3, 10, 20, 2)).toBeNull()
```

- [ ] **Step 2: Run** `bun test apps/web/test/subtitle-overlay.test.ts`; expect missing selector export.
- [ ] **Step 3: Implement a separate editor component rather than growing `clip-editor.tsx`.** Use labeled word text and numeric time fields, split/merge/add/delete buttons, cue-break toggle, grouped/karaoke toggle, 1–10 word limit, review badges with an explicit Accept action, undo/redo, save, and legacy conversion choices. Add a time rail with keyboard-accessible handles; numeric fields remain a precise fallback. Derive overlay text from `buildSubtitleCues` and the current player time; portal it into the existing player container above video and below controls. Keep crop overlay and subtitle overlay at separate z-index levels. Pass `currentTime` from the page through `ClipEditor`. Intercept both the editor close button and clip selection in the page when `onDirtyChange` reports unsaved work; offer Save/Discard/Stay. Do not unmount the editor while save is pending.

```tsx
export function subtitleOverlayAt(
  words: SubtitleWord[], mode: 'grouped' | 'karaoke', maxWords: number,
  clipStart: number, clipEnd: number, sourceTime: number,
) {
  if (sourceTime < clipStart || sourceTime >= clipEnd) return null
  const clipTime = sourceTime - clipStart
  const cue = buildSubtitleCues(words, clipStart, clipEnd, maxWords)
    .find(row => row.start <= clipTime && clipTime < row.end)
  if (!cue) return null
  return { cue, activeWordId: mode === 'karaoke' ? activeWordAt(cue, clipTime)?.id ?? null : null }
}
<SubtitleWordEditor
  clipId={clip.id} clipStart={start} clipEnd={end} duration={duration}
  currentTime={currentTime} videoContainerRef={videoContainerRef}
  onDirtyChange={setSubtitleDirty}
/>
```

- [ ] **Step 4: Run** `bun test apps/web/test/subtitle-overlay.test.ts`, `bun run typecheck`, and `bun run --cwd apps/web build`; expect pass. Manually inspect a Thai and English clip in the running UI: edit one word, split/merge, change mode and limit, scrub the preview, save, reopen, trigger a failed save and a 409 conflict, then attempt to close or select another clip with unsaved work. Confirm legacy `.srt` and export controls still work as before during this work package.
- [ ] **Step 5: Commit** only the files changed for this task as `feat(web): edit and preview subtitle words`.

### Task 9: Integrate capability, retry, and full regression gates

**Files:** Modify `apps/web/components/subtitle-word-editor.tsx`, `apps/web/app/videos/[id]/page.tsx`, `apps/server/src/routes/system.ts`, `README.md`, `apps/server/test/subtitle-tracks.test.ts`, and `apps/server/test/system.test.ts` for visible timing status and retry guidance.

**Interfaces:** Consumes Task 4 capability/status and Task 6 retry endpoint. Produces a visible unsupported/failed/needs-review state with a retry action, while preserving legacy editing.

- [ ] **Step 1: Write focused failure-state assertions.** When `--dtw` is unavailable, track GET reports unsupported and the UI offers segment editing; a failed JSON conversion reports retryable failure and leaves `segments`, `clip_subtitles`, and `subtitle_words` unchanged. A retry from valid retained JSON changes only source words, not clip edits.

```ts
const before = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, 'cl1')).all()
const res = await app.handle(new Request('http://x/videos/v1/subtitle-words/retry', { method: 'POST' }))
expect(res.status).toBe(202)
expect(db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, 'cl1')).all()).toEqual(before)
```
- [ ] **Step 2: Run** the focused server tests; expect failures until status and retry wiring are complete.
- [ ] **Step 3: Connect retry/status in UI and document local prerequisites.** Show a short Thai message and retry button for failed timing, a model/CLI support message for unsupported timing, and `needsReview` badges for approximate words. README describes how word timing depends on Whisper DTW support and that previous edited subtitles remain available. No new cloud service or product dependency is required.

```ts
type AlignmentStatus = 'ready' | 'failed' | 'unsupported' | 'missing'
const canRetry = alignmentStatus === 'failed' || alignmentStatus === 'missing'
```

- [ ] **Step 4: Run** `bun test` and `bun run typecheck`, then `bun run --cwd apps/web build`; expect all pass. Inspect `git status --short` and remove only generated test artifacts from this task. Do not stage unrelated pre-existing changes.
- [ ] **Step 5: Commit** the focused integration/docs changes as `feat: finish subtitle word editing flow`.

## Handoff to work package 2

The next design/plan must make SRT and ASS/video export consume `buildSubtitleCues` and saved tracks, add preset/style controls, and make the editor preview visually match export. This plan intentionally leaves the existing segment-based export in place until that migration is complete. Work package 3 adds translated tracks and bilingual composition on the same track contract.
