# ShotPrompt MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local-first tool that ingests Thai/English live-commerce videos, transcribes them, surfaces hook-moment candidates for the user to pick, and exports trimmed clips with burned subtitles.

**Architecture:** Bun monorepo. `packages/core` holds all pure logic (hook detection ported from `~/workspace/naay/shotprompt-old`, subtitle builders, ffmpeg arg builders/parsers) with heavy tests. `packages/db` is Drizzle + bun:sqlite with DDL bootstrap. `apps/server` (Elysia) runs an in-process persistent job queue and the ffmpeg/whisper pipeline; renders happen only at export time. `apps/web` (Next.js) talks to the server via Eden Treaty and an SSE channel that only triggers refetches.

**Tech Stack:** Bun, Elysia, @elysiajs/eden, @elysiajs/cors, Drizzle ORM (bun:sqlite), Next.js (App Router), Tailwind + shadcn/ui, ffmpeg/ffprobe + whisper-cpp (`whisper-cli`) as system prerequisites.

**Spec:** `docs/superpowers/specs/2026-07-19-shotprompt-mvp-design.md` — the spec wins on any conflict.

## Global Constraints

- Hook constants (verbatim from old repo, never change): `SILENCE_GAP=3.0`, `SCENE_WINDOW=30`, `SCORE_THRESHOLD=40`, `WINDOW_PAD=5`, `BREATH_PAD=1.5`, `MERGE_GAP=15`, `MAX_CLIP_DURATION=90`, `SCENE_BASE_SCORE=35`, `SCENE_MIN_INTERVAL=15`
- Scene detection: ffmpeg `select='gt(scene,0.3)',showinfo`, parse `pts_time:` from stderr
- Keyword tier weights: tier1=25, tier2=15, tier3=8. Seed words come from old repo's `HOOK_TIERS`/`HOOK_TIERS_EN` (copied into `packages/core/src/keywords.ts` in Task 3)
- Server binds `127.0.0.1:3001`; web binds `127.0.0.1:3000`. Never `0.0.0.0`
- SQLite: `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000` on every connection
- Every file artifact is written to `<final>.tmp` then renamed; startup sweeps `data/**/*.tmp`
- All data under `<repo>/data/` (gitignored): `shotprompt.db`, `models/`, `videos/<id>/{source.mp4,audio.wav,thumbs/,exports/}`
- Job statuses: `queued|running|done|failed|canceled`; video statuses: `uploaded|processing|ready|failed`
- Export encode: `libx264 -crf 23 -preset fast`, audio `aac -b:a 128k`; loudnorm two-pass `I=-16:TP=-1.5:LRA=11`; 9:16 = 1080×1920, 16:9 = 1920×1080
- ASS default style: `Noto Sans Thai` bold, Fontsize 64, PrimaryColour white, Outline 3, black outline, Alignment 2 (bottom-center), MarginV 220, PlayResX/Y matches target aspect; libass gets `fontsdir=<repo>/assets/fonts`
- `clips.candidateId` is a soft reference — no FK
- Subtitle trim rules: extend → copy segments only for the new range; shrink → delete nothing; export/srt → filter rows overlapping current clip range, clamp to bounds, shift to relative
- Tests: `bun:test`. Heavy on `packages/core`; API integration on main flows; no UI tests
- Commit after every task (at minimum); commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure (target)

```
package.json                  workspaces + dev/test scripts
tsconfig.base.json
.gitignore                    data/, node_modules/, .next/
assets/fonts/NotoSansThai-Bold.ttf
packages/core/src/types.ts             TranscriptSegment, ScoredClip, KeywordTier, aspect types
packages/core/src/keywords.ts          DEFAULT_HOOK_TIERS_TH / _EN (verbatim from old repo)
packages/core/src/hooks.ts             scoreWindow, detectHooks (4-phase port)
packages/core/src/subtitles.ts         toASSTime, toSRTTime, buildASS, buildSRT (overlap+clamp)
packages/core/src/ffmpeg.ts            arg builders + parsers (probe, normalize, audio, scenes, thumb, export, loudnorm)
packages/core/src/whisper.ts           whisper-cli args + stdout line parser
packages/core/test/*.test.ts
packages/db/src/schema.ts              all tables
packages/db/src/client.ts              createDb(path) — bootstrap DDL + pragmas
packages/db/src/seed.ts                seedKeywords(db)
packages/db/test/db.test.ts
apps/server/src/index.ts               entrypoint: recovery, listen 127.0.0.1
apps/server/src/app.ts                 Elysia app assembly, export type App
apps/server/src/env.ts                 paths (DATA_DIR etc), settings helpers
apps/server/src/events.ts              event bus + SSE route (heartbeat 15s)
apps/server/src/queue.ts               persistent in-process queue + cancel
apps/server/src/recovery.ts            startup: mark running→failed, sweep *.tmp
apps/server/src/pipeline.ts            step orchestration + skip-done logic
apps/server/src/steps/normalize.ts     …one file per step…
apps/server/src/steps/extract-audio.ts
apps/server/src/steps/transcribe.ts    streaming insert + --offset-t resume
apps/server/src/steps/detect-scenes.ts
apps/server/src/steps/detect-hooks.ts
apps/server/src/steps/thumbnails.ts
apps/server/src/routes/system.ts       doctor, disk-usage, settings, model download
apps/server/src/routes/videos.ts       ingest (multipart|path), list/get/delete/retry/stream
apps/server/src/routes/jobs.ts         cancel
apps/server/src/routes/clips.ts        candidates, clip CRUD, subtitles, srt
apps/server/src/routes/exports.ts      batch create, download, delete + render runner
apps/server/test/*.test.ts
apps/web/…                             Next.js app (Tasks 13–17)
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/db/package.json`, `packages/db/tsconfig.json`, `apps/server/package.json`, `apps/server/tsconfig.json`

**Interfaces:**
- Produces: workspace names `@shotprompt/core`, `@shotprompt/db`, `@shotprompt/server` importable across the repo; `bun test` and `bun run typecheck` runnable at root.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "shotprompt",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev": "bunx concurrently -k -n server,web \"bun run --cwd apps/server dev\" \"bun run --cwd apps/web dev\"",
    "test": "bun test packages apps/server",
    "typecheck": "bunx tsc -b packages/core packages/db apps/server"
  },
  "devDependencies": {
    "concurrently": "^9.0.0",
    "typescript": "^5.6.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "composite": true,
    "declaration": true
  }
}
```

`.gitignore`:
```
node_modules/
data/
.next/
*.tsbuildinfo
```

- [ ] **Step 2: Package manifests**

`packages/core/package.json`:
```json
{
  "name": "@shotprompt/core",
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```
`packages/core/tsconfig.json` (same shape for db/server, adjust `references`):
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```
`packages/db/package.json`:
```json
{
  "name": "@shotprompt/db",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@shotprompt/core": "workspace:*", "drizzle-orm": "^0.36.0" }
}
```
`apps/server/package.json`:
```json
{
  "name": "@shotprompt/server",
  "type": "module",
  "exports": { ".": "./src/app.ts" },
  "scripts": { "dev": "bun run --watch src/index.ts" },
  "dependencies": {
    "@shotprompt/core": "workspace:*",
    "@shotprompt/db": "workspace:*",
    "elysia": "^1.1.0",
    "@elysiajs/cors": "^1.1.0"
  }
}
```
Create empty `packages/core/src/index.ts`, `packages/db/src/index.ts`, `apps/server/src/app.ts` (placeholder `export {}`) so typecheck passes.

- [ ] **Step 3: Verify**

Run: `bun install && bun run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold (bun workspaces)"
```

---

### Task 2: packages/db — schema, client, keyword seed

**Files:**
- Create: `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/seed.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/db.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_HOOK_TIERS_TH`, `DEFAULT_HOOK_TIERS_EN` from `@shotprompt/core` (Task 3 — write seed against the import; the two tasks land together at the first green `bun test`; if executing strictly in order, do Task 3 Step 1 (keywords.ts) first).
- Produces: `createDb(path: string): DB` (Drizzle instance + `.raw` bun:sqlite handle), `seedKeywords(db)`, all table objects (`videos`, `jobs`, `jobSteps`, `segments`, `scenes`, `candidates`, `clips`, `clipSubtitles`, `exportsTable`, `keywords`, `settings`).

- [ ] **Step 1: Write failing test**

`packages/db/test/db.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { createDb, seedKeywords, keywords, videos } from '../src'

describe('db', () => {
  it('bootstraps schema, enables WAL, seeds keywords idempotently', () => {
    const db = createDb(':memory:')
    expect(db.raw.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'memory' }) // ':memory:' reports memory; file dbs report wal — assert pragma ran without error
    seedKeywords(db)
    seedKeywords(db) // idempotent
    const rows = db.select().from(keywords).all()
    expect(rows.filter(r => r.language === 'th' && r.tier === 1).some(r => r.word === 'ด่วน' && r.weight === 25)).toBe(true)
    expect(rows.filter(r => r.language === 'en').length).toBeGreaterThan(0)
    expect(rows.length).toBeGreaterThan(50)
    db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'uploaded', language: 'th', createdAt: 1 }).run()
    expect(db.select().from(videos).all()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `bun test packages/db` → FAIL (module not found).

- [ ] **Step 3: Implement**

`packages/db/src/schema.ts`:
```ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  duration: real('duration'),
  width: integer('width'),
  height: integer('height'),
  status: text('status').notNull(), // uploaded|processing|ready|failed
  language: text('language').notNull(), // th|en
  createdAt: integer('created_at').notNull(),
})
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull(),
  type: text('type').notNull(), // pipeline|export
  status: text('status').notNull(), // queued|running|done|failed|canceled
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
})
export const jobSteps = sqliteTable('job_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
})
export const segments = sqliteTable('segments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull(),
  start: real('start').notNull(),
  end: real('end').notNull(),
  text: text('text').notNull(),
})
export const scenes = sqliteTable('scenes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull(),
  time: real('time').notNull(),
})
export const candidates = sqliteTable('candidates', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull(),
  start: real('start').notNull(),
  end: real('end').notNull(),
  score: real('score').notNull(),
  thumbnailPath: text('thumbnail_path'),
})
export const clips = sqliteTable('clips', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull(),
  candidateId: text('candidate_id'), // soft reference, no FK
  start: real('start').notNull(),
  end: real('end').notNull(),
  score: real('score'),
  cropOffset: real('crop_offset').notNull().default(0),
  thumbnailPath: text('thumbnail_path'),
  createdAt: integer('created_at').notNull(),
})
export const clipSubtitles = sqliteTable('clip_subtitles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clipId: text('clip_id').notNull(),
  start: real('start').notNull(),
  end: real('end').notNull(),
  text: text('text').notNull(),
})
export const exportsTable = sqliteTable('exports', {
  id: text('id').primaryKey(),
  clipId: text('clip_id').notNull(),
  aspect: text('aspect').notNull(), // 9:16|16:9|original
  burnSubtitles: integer('burn_subtitles', { mode: 'boolean' }).notNull(),
  status: text('status').notNull(),
  path: text('path'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
})
export const keywords = sqliteTable('keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  language: text('language').notNull(),
  tier: integer('tier').notNull(),
  word: text('word').notNull(),
  weight: integer('weight').notNull(),
})
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
```

`packages/db/src/client.ts` — bun:sqlite + explicit DDL bootstrap (no drizzle-kit at runtime):
```ts
import { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

const DDL = `
CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, filename TEXT NOT NULL, path TEXT NOT NULL, duration REAL, width INTEGER, height INTEGER, status TEXT NOT NULL, language TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS job_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, error TEXT, started_at INTEGER, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS segments (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scenes (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, time REAL NOT NULL);
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, score REAL NOT NULL, thumbnail_path TEXT);
CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, candidate_id TEXT, start REAL NOT NULL, end REAL NOT NULL, score REAL, crop_offset REAL NOT NULL DEFAULT 0, thumbnail_path TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clip_subtitles (id INTEGER PRIMARY KEY AUTOINCREMENT, clip_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, clip_id TEXT NOT NULL, aspect TEXT NOT NULL, burn_subtitles INTEGER NOT NULL, status TEXT NOT NULL, path TEXT, error TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS keywords (id INTEGER PRIMARY KEY AUTOINCREMENT, language TEXT NOT NULL, tier INTEGER NOT NULL, word TEXT NOT NULL, weight INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export type DB = BunSQLiteDatabase<typeof schema> & { raw: Database }

export function createDb(path: string): DB {
  const raw = new Database(path, { create: true })
  raw.run('PRAGMA journal_mode=WAL')
  raw.run('PRAGMA busy_timeout=5000')
  for (const stmt of DDL.split(';').map(s => s.trim()).filter(Boolean)) raw.run(stmt)
  const db = drizzle(raw, { schema }) as DB
  db.raw = raw
  return db
}
```

`packages/db/src/seed.ts`:
```ts
import { DEFAULT_HOOK_TIERS_TH, DEFAULT_HOOK_TIERS_EN } from '@shotprompt/core'
import { keywords } from './schema'
import type { DB } from './client'

export function seedKeywords(db: DB) {
  const existing = db.select().from(keywords).all()
  if (existing.length > 0) return
  const rows: { language: string; tier: number; word: string; weight: number }[] = []
  for (const [language, tiers] of [['th', DEFAULT_HOOK_TIERS_TH], ['en', DEFAULT_HOOK_TIERS_EN]] as const) {
    for (const t of tiers) for (const word of t.keywords) rows.push({ language, tier: t.tier, word, weight: t.weight })
  }
  db.insert(keywords).values(rows).run()
}
```

`packages/db/src/index.ts`: `export * from './schema'; export * from './client'; export * from './seed'`

- [ ] **Step 4: Do Task 3 Step 1 if not done, then run** `bun test packages/db` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(db): schema, WAL client, keyword seed"`

---

### Task 3: packages/core — hook detection port + parity tests

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/keywords.ts`, `packages/core/src/hooks.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/hooks.test.ts`

**Interfaces:**
- Produces:
  - `interface TranscriptSegment { start: number; end: number; text: string }`
  - `interface ScoredClip { start: number; end: number; score: number }`
  - `interface KeywordTier { tier: 1|2|3; weight: number; keywords: string[] }`
  - `type Language = 'th' | 'en'`; `type Aspect = '9:16' | '16:9' | 'original'`
  - `DEFAULT_HOOK_TIERS_TH: KeywordTier[]`, `DEFAULT_HOOK_TIERS_EN: KeywordTier[]`
  - `scoreWindow(text: string, tiers: KeywordTier[], language?: Language): number`
  - `detectHooks(segments: TranscriptSegment[], sceneTimestamps: number[] | undefined, tiers: KeywordTier[], language?: Language): ScoredClip[]`

- [ ] **Step 1: keywords.ts + types.ts**

`packages/core/src/types.ts`:
```ts
export interface TranscriptSegment { start: number; end: number; text: string }
export interface ScoredClip { start: number; end: number; score: number }
export interface KeywordTier { tier: 1 | 2 | 3; weight: number; keywords: string[] }
export type Language = 'th' | 'en'
export type Aspect = '9:16' | '16:9' | 'original'
```

`packages/core/src/keywords.ts` — copy both arrays **verbatim** from `~/workspace/naay/shotprompt-old/apps/worker/src/pipeline/steps/detect-hooks.step.ts` lines defining `HOOK_TIERS` and `HOOK_TIERS_EN`, renamed:
```ts
import type { KeywordTier } from './types'
export const DEFAULT_HOOK_TIERS_TH: KeywordTier[] = [
  { tier: 1, weight: 25, keywords: ['ด่วน','วันนี้เท่านั้น','จำกัด','หมดแล้ว','ล็อตสุดท้าย','เกือบหมด','เหลือน้อย','หมด','ปิดโปร','โปรสุดท้าย','ชิ้นสุดท้าย','สต็อกจำกัด','เหลือไม่กี่ชิ้น','รีบเลย','นาทีนี้'] },
  { tier: 2, weight: 15, keywords: ['ลด','โปร','ฟรี','ส่งฟรี','ของแถม','ราคา','เหลือ','พิเศษ','ราคาพิเศษ','แถม','ถูก','คุ้ม','ลดราคา','ราคาพัง','แฟลชเซล','เซล','โค้ด','คูปอง','ซื้อ 1 แถม 1','ส่วนลด','ราคาถูก'] },
  { tier: 3, weight: 8, keywords: ['ไวรัล','รีบ','CF','ตัวนี้','ซื้อเลย','โอนเลย','หยิบเลย','สั่งเลย','จองเลย','เอาไหม','ใครเอา','ขายดี','ปัง','กดเลย','คอมเมนต์เลย','ทักมา','ต้องมี','ดังมาก','ฮิต','แนะนำ','ไลฟ์นี้','วันนี้','เพิ่มลงตะกร้า'] },
]
export const DEFAULT_HOOK_TIERS_EN: KeywordTier[] = [
  { tier: 1, weight: 25, keywords: ['limited','last chance','almost gone','selling out','sold out','ending soon','hurry','only left','limited time','running out','going fast','act now',"don't miss",'flash sale','final','clearance'] },
  { tier: 2, weight: 15, keywords: ['discount','promo','free','free shipping','gift','special','deal','offer','save','off','sale','coupon','code','bundle','bogo','price drop','exclusive','bonus','cashback'] },
  { tier: 3, weight: 8, keywords: ['buy now','order now','get it now','grab it','shop now','add to cart','trending','viral','best seller','who wants','comment below','drop a','dm me','must have','limited edition','get yours','claim','sold','how many'] },
]
```

- [ ] **Step 2: Write failing parity tests**

`packages/core/test/hooks.test.ts` — port **all 24 cases** from the old repo's `detect-hooks.step.spec.ts`, adapted to the new signatures (tiers passed explicitly; `detectHooks(...)` is sync). Representative shape (port every old case, same fixtures and assertions):
```ts
import { describe, expect, it } from 'bun:test'
import { scoreWindow, detectHooks, DEFAULT_HOOK_TIERS_TH } from '../src'
import type { TranscriptSegment } from '../src'

const TH = DEFAULT_HOOK_TIERS_TH

describe('DEFAULT_HOOK_TIERS_TH', () => {
  it('tier 1 contains urgency keywords', () => {
    const t1 = TH.find(t => t.tier === 1)!
    expect(t1.keywords).toContain('ด่วน'); expect(t1.keywords).toContain('วันนี้เท่านั้น'); expect(t1.weight).toBe(25)
  })
  // …tier 2 ('ลด','ส่งฟรี',15) and tier 3 ('CF','ซื้อเลย',8) cases likewise
})

describe('scoreWindow', () => {
  it('returns 0 for no keywords', () => expect(scoreWindow('สวัสดีครับทุกคน', TH)).toBe(0))
  it('returns 0 for empty string', () => expect(scoreWindow('', TH)).toBe(0))
  it('single tier-1 = 25', () => expect(scoreWindow('ด่วน', TH)).toBe(25))
  it('single tier-2 = 15', () => expect(scoreWindow('ลด', TH)).toBe(15))
  it('single tier-3 = 8', () => expect(scoreWindow('CF', TH)).toBe(8))
  it('sums across tiers', () => expect(scoreWindow('ด่วน ลด CF', TH)).toBe(48))
  it('counts each keyword once', () => expect(scoreWindow('ลด ลด ลด', TH)).toBe(15))
})

describe('detectHooks', () => {
  it('empty in, empty out', () => expect(detectHooks([], undefined, TH)).toEqual([]))
  it('below threshold → empty', () =>
    expect(detectHooks([{ start: 0, end: 10, text: 'สวัสดีครับทุกคน' }], undefined, TH)).toEqual([]))
  it('one clip for a high-scoring segment', () => {
    const clips = detectHooks([{ start: 10, end: 20, text: 'ด่วน ลด โปร' }], undefined, TH)
    expect(clips).toHaveLength(1); expect(clips[0].score).toBeGreaterThanOrEqual(40)
  })
  it('clamps start to 0', () =>
    expect(detectHooks([{ start: 0, end: 10, text: 'ด่วน ลด โปร' }], undefined, TH)[0].start).toBe(0))
  it('hook across three short consecutive segments', () => {
    const segs: TranscriptSegment[] = [
      { start: 10, end: 12, text: 'ด่วน' }, { start: 12, end: 14, text: 'ลด' }, { start: 14, end: 16, text: 'โปร' }]
    const clips = detectHooks(segs, undefined, TH)
    expect(clips).toHaveLength(1); expect(clips[0].score).toBeGreaterThanOrEqual(40)
  })
  it('two clips when far apart', () =>
    expect(detectHooks([
      { start: 0, end: 10, text: 'ด่วน ลด โปร' }, { start: 200, end: 210, text: 'ด่วน ลด โปร' }], undefined, TH)).toHaveLength(2))
  it('merges nearby windows', () =>
    expect(detectHooks([
      { start: 0, end: 10, text: 'ด่วน ลด โปร' }, { start: 12, end: 22, text: 'ด่วน ลด โปร' }], undefined, TH)).toHaveLength(1))
  it('merged clip keeps max score', () => {
    const clips = detectHooks([
      { start: 0, end: 10, text: 'ลด โปร' }, { start: 12, end: 22, text: 'ด่วน วันนี้เท่านั้น จำกัด' }], undefined, TH)
    expect(clips).toHaveLength(1)
    expect(clips[0].score).toBeGreaterThan(scoreWindow('ลด โปร', TH))
  })
  it('scene timestamps become candidates', () => {
    const clips = detectHooks([], [30, 90], TH)
    expect(clips).toHaveLength(2); clips.forEach(c => expect(c.score).toBe(35))
  })
  it('dedupes scenes closer than SCENE_MIN_INTERVAL', () =>
    expect(detectHooks([], [30, 35, 40, 90], TH)).toHaveLength(2))
  it('merges audio + nearby scene candidates', () => {
    const clips = detectHooks([{ start: 28, end: 38, text: 'ด่วน ลด โปร' }], [30], TH)
    expect(clips).toHaveLength(1); expect(clips[0].score).toBeGreaterThanOrEqual(40)
  })
  it('snaps end to last segment + breath pad', () =>
    expect(detectHooks([{ start: 10, end: 20, text: 'ด่วน ลด โปร' }], undefined, TH)[0].end).toBeCloseTo(21.5, 1))
  it('scene clip with no segments ends at ts+SCENE_WINDOW+BREATH_PAD', () =>
    expect(detectHooks([], [30], TH)[0].end).toBeCloseTo(61.5, 1))
  it('no merge past MAX_CLIP_DURATION', () => {
    const clips = detectHooks([
      { start: 0, end: 60, text: 'ด่วน ลด โปร' }, { start: 80, end: 90, text: 'ด่วน ลด โปร' }], undefined, TH)
    expect(clips).toHaveLength(2)
    clips.forEach(c => expect(c.end - c.start).toBeLessThanOrEqual(100))
  })
})
```

- [ ] **Step 3: Run** `bun test packages/core` → FAIL (hooks not implemented).

- [ ] **Step 4: Implement `hooks.ts`** — verbatim port of the old algorithm, only signature changes (tiers param, sync, no Nest):

```ts
import type { KeywordTier, Language, ScoredClip, TranscriptSegment } from './types'

export const SILENCE_GAP = 3.0
export const SCENE_WINDOW = 30
export const SCORE_THRESHOLD = 40
export const WINDOW_PAD = 5
export const BREATH_PAD = 1.5
export const MERGE_GAP = 15
export const MAX_CLIP_DURATION = 90
export const SCENE_BASE_SCORE = 35
export const SCENE_MIN_INTERVAL = 15

export function scoreWindow(text: string, tiers: KeywordTier[], language: Language = 'th'): number {
  const normalised = language === 'en' ? text.toLowerCase() : text
  let score = 0
  for (const { weight, keywords } of tiers)
    for (const kw of keywords) if (normalised.includes(kw)) score += weight
  return score
}

export function detectHooks(
  segments: TranscriptSegment[],
  sceneTimestamps: number[] | undefined,
  tiers: KeywordTier[],
  language: Language = 'th',
): ScoredClip[] {
  if (segments.length === 0 && !sceneTimestamps?.length) return []

  // Phase 1: activity walk
  const used = new Set<number>()
  const candidates: ScoredClip[] = []
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue
    const anchorScore = scoreWindow(segments[i].text, tiers, language)
    if (anchorScore === 0) continue
    let clipEnd = segments[i].end
    let total = anchorScore
    used.add(i)
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[j].start - clipEnd > SILENCE_GAP) break
      if (segments[j].end - segments[i].start > MAX_CLIP_DURATION) break
      clipEnd = segments[j].end
      total += scoreWindow(segments[j].text, tiers, language)
      used.add(j)
    }
    if (total >= SCORE_THRESHOLD) candidates.push({ start: segments[i].start, end: clipEnd, score: total })
  }

  // Phase 2: scene coverage
  if (sceneTimestamps?.length) {
    let lastKept = -Infinity
    for (const ts of sceneTimestamps.slice().sort((a, b) => a - b)) {
      if (ts - lastKept >= SCENE_MIN_INTERVAL) {
        candidates.push({ start: ts, end: ts + SCENE_WINDOW, score: SCENE_BASE_SCORE })
        lastKept = ts
      }
    }
  }
  if (candidates.length === 0) return []

  // Phase 3: merge
  candidates.sort((a, b) => a.start - b.start)
  const merged: ScoredClip[] = []
  let current = { ...candidates[0] }
  for (let i = 1; i < candidates.length; i++) {
    const next = candidates[i]
    if (next.start - current.end < MERGE_GAP && next.end - current.start <= MAX_CLIP_DURATION) {
      current.end = Math.max(current.end, next.end)
      current.score = Math.max(current.score, next.score)
    } else { merged.push(current); current = { ...next } }
  }
  merged.push(current)

  // Phase 4: pad
  return merged.map(c => ({ start: Math.max(0, c.start - WINDOW_PAD), end: c.end + BREATH_PAD, score: c.score }))
}
```

`packages/core/src/index.ts`: `export * from './types'; export * from './keywords'; export * from './hooks'`

- [ ] **Step 5: Run** `bun test packages/core` → all PASS. Also `bun test packages/db` now passes (Task 2 dependency).

- [ ] **Step 6: Commit** — `git commit -am "feat(core): port 4-phase hook detection with parity tests"`

---

### Task 4: packages/core — subtitle builders (overlap + clamp + shift)

**Files:**
- Create: `packages/core/src/subtitles.ts`; Modify: `packages/core/src/index.ts` (add export)
- Test: `packages/core/test/subtitles.test.ts`

**Interfaces:**
- Produces:
  - `toASSTime(seconds: number): string` / `toSRTTime(seconds: number): string` (formats identical to old repo)
  - `clampToClip(subs: TranscriptSegment[], clipStart: number, clipEnd: number): TranscriptSegment[]` — filter rows overlapping `(clipStart, clipEnd)`, clamp times to bounds, shift to clip-relative
  - `buildSRT(subs: TranscriptSegment[], clipStart: number, clipEnd: number): string`
  - `buildASS(subs: TranscriptSegment[], clipStart: number, clipEnd: number, aspect: '9:16'|'16:9'|'original', playRes?: {x:number;y:number}): string` — style per Global Constraints; PlayRes 1080×1920 for 9:16, 1920×1080 for 16:9, `playRes` required for `original`

- [ ] **Step 1: Failing tests**

`packages/core/test/subtitles.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { toASSTime, toSRTTime, clampToClip, buildSRT, buildASS } from '../src'

describe('time formats (parity with old repo)', () => {
  it('ASS: 0 → 0:00:00.00', () => expect(toASSTime(0)).toBe('0:00:00.00'))
  it('ASS: 3661.25 → 1:01:01.25', () => expect(toASSTime(3661.25)).toBe('1:01:01.25'))
  it('SRT: 3661.25 → 01:01:01,250', () => expect(toSRTTime(3661.25)).toBe('01:01:01,250'))
})

describe('clampToClip (spec trim rules)', () => {
  const subs = [
    { start: 5, end: 9, text: 'before' },     // fully outside → dropped
    { start: 9, end: 12, text: 'straddles' }, // overlaps start → clamped to 10
    { start: 12, end: 18, text: 'inside' },
    { start: 19, end: 25, text: 'tail' },     // overlaps end → clamped to 20
  ]
  it('filters overlap, clamps, shifts relative', () => {
    expect(clampToClip(subs, 10, 20)).toEqual([
      { start: 0, end: 2, text: 'straddles' },
      { start: 2, end: 8, text: 'inside' },
      { start: 9, end: 10, text: 'tail' },
    ])
  })
})

describe('buildSRT / buildASS', () => {
  const subs = [{ start: 12, end: 14, text: 'ลดราคา' }]
  it('SRT is relative and numbered', () => {
    expect(buildSRT(subs, 10, 20)).toBe('1\n00:00:02,000 --> 00:00:04,000\nลดราคา')
  })
  it('ASS carries Noto Sans Thai style and 9:16 PlayRes', () => {
    const ass = buildASS(subs, 10, 20, '9:16')
    expect(ass).toContain('Noto Sans Thai')
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toContain('Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,ลดราคา')
  })
})
```

- [ ] **Step 2: Run** `bun test packages/core/test/subtitles.test.ts` → FAIL.

- [ ] **Step 3: Implement `subtitles.ts`**

```ts
import type { Aspect, TranscriptSegment } from './types'

export function toASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60), cs = Math.round((seconds % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
export function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60), ms = Math.round((seconds % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

export function clampToClip(subs: TranscriptSegment[], clipStart: number, clipEnd: number): TranscriptSegment[] {
  return subs
    .filter(s => s.end > clipStart && s.start < clipEnd)
    .map(s => ({
      start: Math.max(s.start, clipStart) - clipStart,
      end: Math.min(s.end, clipEnd) - clipStart,
      text: s.text,
    }))
}

export function buildSRT(subs: TranscriptSegment[], clipStart: number, clipEnd: number): string {
  return clampToClip(subs, clipStart, clipEnd)
    .map((s, i) => `${i + 1}\n${toSRTTime(s.start)} --> ${toSRTTime(s.end)}\n${s.text}`)
    .join('\n\n')
}

const PLAY_RES: Record<string, { x: number; y: number }> = { '9:16': { x: 1080, y: 1920 }, '16:9': { x: 1920, y: 1080 } }

export function buildASS(
  subs: TranscriptSegment[], clipStart: number, clipEnd: number,
  aspect: Aspect, playRes?: { x: number; y: number },
): string {
  const res = PLAY_RES[aspect] ?? playRes
  if (!res) throw new Error('playRes required for original aspect')
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${res.x}
PlayResY: ${res.y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Outline, Shadow, Alignment, MarginV
Style: Default,Noto Sans Thai,64,&H00FFFFFF,&H00000000,-1,3,0,2,220

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const events = clampToClip(subs, clipStart, clipEnd)
    .map(s => `Dialogue: 0,${toASSTime(s.start)},${toASSTime(s.end)},Default,,0,0,0,,${s.text}`)
    .join('\n')
  return header + events
}
```
Add `export * from './subtitles'` to `index.ts`.

- [ ] **Step 4: Run** `bun test packages/core` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): subtitle builders with overlap/clamp trim rules"`

---

### Task 5: packages/core — ffmpeg/whisper builders + parsers

**Files:**
- Create: `packages/core/src/ffmpeg.ts`, `packages/core/src/whisper.ts`; Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/ffmpeg.test.ts`, `packages/core/test/whisper.test.ts`

**Interfaces:**
- Produces (all pure — no spawning here):
  - `parseProbe(json: string): { duration: number; width: number; height: number; vcodec?: string; acodec?: string }`
  - `needsTranscode(p: ReturnType<typeof parseProbe>): boolean` — false when `vcodec==='h264' && acodec==='aac'`
  - `buildNormalizeArgs(input: string, output: string, transcode: boolean): string[]`
  - `buildExtractAudioArgs(input: string, output: string): string[]` — 16kHz mono pcm_s16le wav
  - `buildSceneArgs(input: string): string[]` + `parseSceneTimestamps(stderr: string): number[]` (regex `/pts_time:([\d.]+)/g`)
  - `buildThumbnailArgs(input: string, atSeconds: number, output: string): string[]`
  - `buildLoudnormMeasureArgs(input: string, start: number, end: number): string[]` + `parseLoudnorm(stderr: string): LoudnormStats` (finds last `{...}` JSON block in stderr)
  - `buildExportArgs(opts: { input: string; start: number; end: number; aspect: Aspect; cropOffset: number; assPath?: string; fontsDir?: string; loudnorm: LoudnormStats; output: string }): string[]`
  - `buildWhisperArgs(opts: { model: string; audio: string; language: Language; offsetMs?: number }): string[]`
  - `parseWhisperLine(line: string): TranscriptSegment | null` — matches `[HH:MM:SS.mmm --> HH:MM:SS.mmm]  text`

- [ ] **Step 1: Failing tests** (`packages/core/test/ffmpeg.test.ts` + `whisper.test.ts`)

```ts
import { describe, expect, it } from 'bun:test'
import { parseProbe, needsTranscode, parseSceneTimestamps, parseLoudnorm, buildExportArgs, parseWhisperLine, buildWhisperArgs } from '../src'

it('parseProbe reads duration/resolution/codecs', () => {
  const j = JSON.stringify({ format: { duration: '120.5' }, streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'aac' }] })
  const p = parseProbe(j)
  expect(p).toEqual({ duration: 120.5, width: 1920, height: 1080, vcodec: 'h264', acodec: 'aac' })
  expect(needsTranscode(p)).toBe(false)
  expect(needsTranscode({ ...p, vcodec: 'hevc' })).toBe(true)
})

it('parseSceneTimestamps extracts pts_time', () => {
  const stderr = 'n:0 pts:100 pts_time:4.171 … n:1 pts:200 pts_time:9.343'
  expect(parseSceneTimestamps(stderr)).toEqual([4.171, 9.343])
})

it('parseLoudnorm reads the json block from stderr', () => {
  const stderr = 'noise\n{\n"input_i" : "-23.6",\n"input_tp" : "-6.5",\n"input_lra" : "5.9",\n"input_thresh" : "-34.0",\n"target_offset" : "0.3"\n}\n'
  expect(parseLoudnorm(stderr).input_i).toBe('-23.6')
})

it('buildExportArgs: 9:16 crop honours cropOffset and burns ass', () => {
  const args = buildExportArgs({ input: 'in.mp4', start: 10, end: 20, aspect: '9:16', cropOffset: 0.5,
    assPath: 's.ass', fontsDir: 'assets/fonts',
    loudnorm: { input_i: '-23.6', input_tp: '-6.5', input_lra: '5.9', input_thresh: '-34.0', target_offset: '0.3' },
    output: 'out.mp4' })
  const vf = args[args.indexOf('-vf') + 1]
  expect(vf).toContain("crop=ih*9/16:ih:(iw-ih*9/16)/2*(1+0.5):0")
  expect(vf).toContain('scale=1080:1920')
  expect(vf).toContain("ass=s.ass:fontsdir=assets/fonts")
  const af = args[args.indexOf('-af') + 1]
  expect(af).toContain('measured_I=-23.6')
})

it('whisper args + line parse', () => {
  expect(buildWhisperArgs({ model: 'm.bin', audio: 'a.wav', language: 'th', offsetMs: 5000 }))
    .toEqual(['-m', 'm.bin', '-f', 'a.wav', '-l', 'th', '-ot', '5000'])
  expect(parseWhisperLine('[00:01:02.500 --> 00:01:04.000]  สวัสดีค่ะ'))
    .toEqual({ start: 62.5, end: 64, text: 'สวัสดีค่ะ' })
  expect(parseWhisperLine('whisper_init: loading model')).toBeNull()
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`packages/core/src/ffmpeg.ts`:
```ts
import type { Aspect } from './types'

export interface LoudnormStats { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }

export function parseProbe(json: string) {
  const d = JSON.parse(json)
  const v = d.streams?.find((s: any) => s.codec_type === 'video')
  const a = d.streams?.find((s: any) => s.codec_type === 'audio')
  return { duration: parseFloat(d.format?.duration ?? '0'), width: v?.width ?? 0, height: v?.height ?? 0, vcodec: v?.codec_name, acodec: a?.codec_name }
}
export const needsTranscode = (p: { vcodec?: string; acodec?: string }) => !(p.vcodec === 'h264' && p.acodec === 'aac')

export const buildProbeArgs = (input: string) => ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input]

export function buildNormalizeArgs(input: string, output: string, transcode: boolean): string[] {
  return transcode
    ? ['-i', input, '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output]
    : ['-i', input, '-c', 'copy', '-movflags', '+faststart', '-y', output]
}
export const buildExtractAudioArgs = (input: string, output: string) =>
  ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', output]
export const buildSceneArgs = (input: string) =>
  ['-i', input, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-']
export const parseSceneTimestamps = (stderr: string) =>
  [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => parseFloat(m[1]))
export const buildThumbnailArgs = (input: string, atSeconds: number, output: string) =>
  ['-ss', String(atSeconds), '-i', input, '-vframes', '1', '-vf', 'scale=480:-2', '-y', output]

const LOUDNORM = 'I=-16:TP=-1.5:LRA=11'
export const buildLoudnormMeasureArgs = (input: string, start: number, end: number) =>
  ['-ss', String(start), '-to', String(end), '-i', input, '-af', `loudnorm=${LOUDNORM}:print_format=json`, '-f', 'null', '-']
export function parseLoudnorm(stderr: string): LoudnormStats {
  const m = stderr.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('loudnorm json not found in ffmpeg output')
  return JSON.parse(m[0])
}

function cropFilter(aspect: Aspect, cropOffset: number): string | null {
  if (aspect === '9:16') return `crop=ih*9/16:ih:(iw-ih*9/16)/2*(1+${cropOffset}):0,scale=1080:1920`
  if (aspect === '16:9') return `crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16),scale=1920:1080`
  return null
}

export function buildExportArgs(opts: { input: string; start: number; end: number; aspect: Aspect; cropOffset: number; assPath?: string; fontsDir?: string; loudnorm: LoudnormStats; output: string }): string[] {
  const filters: string[] = []
  const crop = cropFilter(opts.aspect, opts.cropOffset)
  if (crop) filters.push(crop)
  if (opts.assPath) filters.push(`ass=${opts.assPath}${opts.fontsDir ? `:fontsdir=${opts.fontsDir}` : ''}`)
  const ln = opts.loudnorm
  const af = `loudnorm=${LOUDNORM}:measured_I=${ln.input_i}:measured_TP=${ln.input_tp}:measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}:offset=${ln.target_offset}:linear=true`
  const args = ['-ss', String(opts.start), '-to', String(opts.end), '-i', opts.input]
  if (filters.length) args.push('-vf', filters.join(','))
  args.push('-af', af, '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-y', opts.output)
  return args
}
```

`packages/core/src/whisper.ts`:
```ts
import type { Language, TranscriptSegment } from './types'

export function buildWhisperArgs(opts: { model: string; audio: string; language: Language; offsetMs?: number }): string[] {
  const args = ['-m', opts.model, '-f', opts.audio, '-l', opts.language]
  if (opts.offsetMs && opts.offsetMs > 0) args.push('-ot', String(opts.offsetMs))
  return args
}

const LINE = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+(.*)$/
export function parseWhisperLine(line: string): TranscriptSegment | null {
  const m = line.match(LINE)
  if (!m) return null
  const t = (h: string, mi: string, s: string, ms: string) => +h * 3600 + +mi * 60 + +s + +ms / 1000
  const text = m[9].trim()
  if (!text) return null
  return { start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text }
}
```
Add both to `index.ts` exports.

- [ ] **Step 4: Run** `bun test packages/core` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): ffmpeg/whisper arg builders and parsers"`

---

### Task 6: apps/server — app scaffold, env, event bus, SSE, doctor, disk-usage, settings

**Files:**
- Create: `apps/server/src/env.ts`, `apps/server/src/events.ts`, `apps/server/src/routes/system.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`
- Test: `apps/server/test/system.test.ts`

**Interfaces:**
- Produces:
  - `env.ts`: `DATA_DIR`, `MODELS_DIR`, `videoDir(id)`, `FONTS_DIR`, `getSetting(db,key,fallback)`, `setSetting(db,key,value)`; settings keys: `whisperModel` (default `'large-v3'`), model path = `MODELS_DIR/ggml-<model>.bin`
  - `events.ts`: `bus = new EventEmitter()`, `emitEvent(type: string, payload: object)` (emits `{type,...payload}` on channel `'event'`), `sseResponse(): Response` (text/event-stream, subscribes to bus, `: ping\n\n` heartbeat every 15s, cleans up on abort)
  - `app.ts`: `createApp(db: DB): Elysia` mounting all routes + cors for `http://127.0.0.1:3000` & `http://localhost:3000`; `export type App = ReturnType<typeof createApp>`
  - `index.ts`: creates db at `data/shotprompt.db`, `seedKeywords`, runs recovery (Task 7), `app.listen({ hostname: '127.0.0.1', port: 3001 })`
  - Routes: `GET /system/doctor` → `{ ffmpeg: boolean; ffprobe: boolean; whisper: boolean; model: { name: string; downloaded: boolean }; acceleration: string }` (acceleration: `'metal (homebrew default)'` on darwin-arm64 else `'cpu'`); `GET /system/disk-usage` → `{ total: number; videos: { id: string; filename: string; bytes: number }[] }`; `GET /settings` / `PUT /settings` (body `{ whisperModel?: string }`); `GET /events` → SSE

- [ ] **Step 1: Failing test**

`apps/server/test/system.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { createDb, seedKeywords } from '@shotprompt/db'
import { createApp } from '../src/app'

const app = () => { const db = createDb(':memory:'); seedKeywords(db); return createApp(db) }

describe('system routes', () => {
  it('doctor reports binary and model status', async () => {
    const res = await app().handle(new Request('http://x/system/doctor'))
    const body = await res.json()
    expect(typeof body.ffmpeg).toBe('boolean')
    expect(body.model.name).toBe('large-v3')
  })
  it('settings roundtrip', async () => {
    const a = app()
    await a.handle(new Request('http://x/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whisperModel: 'medium' }) }))
    const res = await a.handle(new Request('http://x/settings'))
    expect((await res.json()).whisperModel).toBe('medium')
  })
  it('SSE responds with event-stream and heartbeat header', async () => {
    const res = await app().handle(new Request('http://x/events'))
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
})
```

- [ ] **Step 2: Run** `bun test apps/server` → FAIL.

- [ ] **Step 3: Implement**

`apps/server/src/env.ts`:
```ts
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { settings, type DB } from '@shotprompt/db'

export const ROOT = join(import.meta.dir, '..', '..', '..')
export const DATA_DIR = process.env.SHOTPROMPT_DATA ?? join(ROOT, 'data')
export const MODELS_DIR = join(DATA_DIR, 'models')
export const FONTS_DIR = join(ROOT, 'assets', 'fonts')
export const videoDir = (id: string) => join(DATA_DIR, 'videos', id)
export const modelPath = (name: string) => join(MODELS_DIR, `ggml-${name}.bin`)

export function getSetting(db: DB, key: string, fallback: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? fallback
}
export function setSetting(db: DB, key: string, value: string) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
}
```

`apps/server/src/events.ts`:
```ts
import { EventEmitter } from 'node:events'

export const bus = new EventEmitter()
bus.setMaxListeners(50)
export const emitEvent = (type: string, payload: Record<string, unknown> = {}) =>
  bus.emit('event', { type, ...payload })

export function sseResponse(): Response {
  let listener: (e: unknown) => void
  let timer: ReturnType<typeof setInterval>
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      listener = e => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      bus.on('event', listener)
      timer = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 15_000)
    },
    cancel() { bus.off('event', listener); clearInterval(timer) },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } })
}
```

`apps/server/src/routes/system.ts`:
```ts
import { Elysia, t } from 'elysia'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DB } from '@shotprompt/db'
import { videos } from '@shotprompt/db'
import { DATA_DIR, getSetting, modelPath, setSetting, videoDir } from '../env'
import { sseResponse } from '../events'

const dirSize = (dir: string): number => {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) total += statSync(join(f.parentPath, f.name)).size
  }
  return total
}

export const systemRoutes = (db: DB) => new Elysia()
  .get('/system/doctor', () => {
    const model = getSetting(db, 'whisperModel', 'large-v3')
    return {
      ffmpeg: Bun.which('ffmpeg') !== null,
      ffprobe: Bun.which('ffprobe') !== null,
      whisper: Bun.which('whisper-cli') !== null,
      model: { name: model, downloaded: existsSync(modelPath(model)) },
      acceleration: process.platform === 'darwin' && process.arch === 'arm64' ? 'metal (homebrew default)' : 'cpu',
    }
  })
  .get('/system/disk-usage', () => ({
    total: dirSize(DATA_DIR),
    videos: db.select().from(videos).all().map(v => ({ id: v.id, filename: v.filename, bytes: dirSize(videoDir(v.id)) })),
  }))
  .get('/settings', () => ({ whisperModel: getSetting(db, 'whisperModel', 'large-v3') }))
  .put('/settings', ({ body }) => {
    if (body.whisperModel) setSetting(db, 'whisperModel', body.whisperModel)
    return { ok: true }
  }, { body: t.Object({ whisperModel: t.Optional(t.String()) }) })
  .get('/events', () => sseResponse())
```

`apps/server/src/app.ts`:
```ts
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import type { DB } from '@shotprompt/db'
import { systemRoutes } from './routes/system'

export function createApp(db: DB) {
  return new Elysia()
    .use(cors({ origin: ['http://127.0.0.1:3000', 'http://localhost:3000'] }))
    .use(systemRoutes(db))
}
export type App = ReturnType<typeof createApp>
```

`apps/server/src/index.ts`:
```ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createDb, seedKeywords } from '@shotprompt/db'
import { createApp } from './app'
import { DATA_DIR, MODELS_DIR } from './env'

mkdirSync(MODELS_DIR, { recursive: true })
mkdirSync(join(DATA_DIR, 'videos'), { recursive: true })
const db = createDb(join(DATA_DIR, 'shotprompt.db'))
seedKeywords(db)
createApp(db).listen({ hostname: '127.0.0.1', port: 3001 })
console.log('server on http://127.0.0.1:3001')
```

- [ ] **Step 4: Run** `bun test apps/server` → PASS. Also `bun run --cwd apps/server dev` boots and `curl http://127.0.0.1:3001/system/doctor` returns JSON.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): scaffold with doctor, settings, disk-usage, SSE"`

---

### Task 7: apps/server — persistent job queue, cancel, startup recovery

**Files:**
- Create: `apps/server/src/queue.ts`, `apps/server/src/recovery.ts`; Modify: `apps/server/src/index.ts` (run recovery before listen)
- Test: `apps/server/test/queue.test.ts`

**Interfaces:**
- Consumes: `emitEvent` from Task 6, db tables from Task 2.
- Produces:
  - `interface JobCtx { signal: AbortSignal; setChild(p: Subprocess | null): void }`
  - `type JobRunner = (jobId: string, ctx: JobCtx) => Promise<void>`
  - `class JobQueue { constructor(db: DB, type: 'pipeline'|'export', runner: JobRunner); enqueue(jobId: string): void; cancel(jobId: string): boolean }` — concurrency 1; on run: set `status='running'`+`startedAt`; on resolve `done`; on reject `failed`+error; on cancel: abort signal, `child?.kill()`, `status='canceled'`. Emits `job:update {jobId, videoId, type, status}` on every transition.
  - `recover(db: DB): void` — all `running|queued` jobs → `failed` (error `'server restarted'`), same for their `running|queued` job_steps; delete every `*.tmp` under `DATA_DIR` recursively.

- [ ] **Step 1: Failing tests**

`apps/server/test/queue.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { createDb, jobs, jobSteps } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { JobQueue } from '../src/queue'
import { recover } from '../src/recovery'

const mkJob = (db: any, id: string, status = 'queued') =>
  db.insert(jobs).values({ id, videoId: 'v1', type: 'pipeline', status, createdAt: Date.now() }).run()

describe('JobQueue', () => {
  it('runs jobs sequentially and marks done', async () => {
    const db = createDb(':memory:')
    const order: string[] = []
    const q = new JobQueue(db, 'pipeline', async id => { order.push(id) })
    mkJob(db, 'a'); mkJob(db, 'b')
    q.enqueue('a'); q.enqueue('b')
    await q.idle()
    expect(order).toEqual(['a', 'b'])
    expect(db.select().from(jobs).where(eq(jobs.id, 'a')).get()!.status).toBe('done')
  })
  it('marks failed on throw', async () => {
    const db = createDb(':memory:')
    const q = new JobQueue(db, 'pipeline', async () => { throw new Error('boom') })
    mkJob(db, 'a'); q.enqueue('a'); await q.idle()
    const row = db.select().from(jobs).where(eq(jobs.id, 'a')).get()!
    expect(row.status).toBe('failed'); expect(row.error).toBe('boom')
  })
  it('cancel aborts a running job', async () => {
    const db = createDb(':memory:')
    const q = new JobQueue(db, 'pipeline', (id, ctx) => new Promise((_, rej) => {
      ctx.signal.addEventListener('abort', () => rej(new Error('aborted')))
    }))
    mkJob(db, 'a'); q.enqueue('a')
    await Bun.sleep(10)
    expect(q.cancel('a')).toBe(true)
    await q.idle()
    expect(db.select().from(jobs).where(eq(jobs.id, 'a')).get()!.status).toBe('canceled')
  })
})

describe('recover', () => {
  it('fails stale jobs and steps', () => {
    const db = createDb(':memory:')
    mkJob(db, 'a', 'running')
    db.insert(jobSteps).values({ jobId: 'a', name: 'transcribe', status: 'running' }).run()
    recover(db)
    expect(db.select().from(jobs).where(eq(jobs.id, 'a')).get()!.status).toBe('failed')
    expect(db.select().from(jobSteps).all()[0].status).toBe('failed')
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`apps/server/src/queue.ts`:
```ts
import type { Subprocess } from 'bun'
import { eq } from 'drizzle-orm'
import { jobs, type DB } from '@shotprompt/db'
import { emitEvent } from './events'

export interface JobCtx { signal: AbortSignal; setChild(p: Subprocess | null): void }
export type JobRunner = (jobId: string, ctx: JobCtx) => Promise<void>

export class JobQueue {
  private pending: string[] = []
  private running: { jobId: string; controller: AbortController; child: Subprocess | null } | null = null
  private waiters: (() => void)[] = []

  constructor(private db: DB, private type: 'pipeline' | 'export', private runner: JobRunner) {}

  enqueue(jobId: string) { this.pending.push(jobId); this.pump() }

  cancel(jobId: string): boolean {
    const qi = this.pending.indexOf(jobId)
    if (qi >= 0) { this.pending.splice(qi, 1); this.mark(jobId, 'canceled'); return true }
    if (this.running?.jobId === jobId) {
      this.running.controller.abort()
      this.running.child?.kill()
      return true
    }
    return false
  }

  idle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve()
    return new Promise(res => this.waiters.push(res))
  }

  private mark(jobId: string, status: string, error?: string) {
    const now = Date.now()
    this.db.update(jobs).set({ status, error: error ?? null, ...(status === 'running' ? { startedAt: now } : { completedAt: now }) })
      .where(eq(jobs.id, jobId)).run()
    const row = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get()
    emitEvent('job:update', { jobId, videoId: row?.videoId, jobType: this.type, status })
  }

  private async pump() {
    if (this.running || this.pending.length === 0) {
      if (!this.running && this.pending.length === 0) { this.waiters.forEach(w => w()); this.waiters = [] }
      return
    }
    const jobId = this.pending.shift()!
    const controller = new AbortController()
    this.running = { jobId, controller, child: null }
    this.mark(jobId, 'running')
    try {
      await this.runner(jobId, { signal: controller.signal, setChild: p => { if (this.running) this.running.child = p } })
      this.mark(jobId, controller.signal.aborted ? 'canceled' : 'done')
    } catch (e) {
      this.mark(jobId, controller.signal.aborted ? 'canceled' : 'failed', e instanceof Error ? e.message : String(e))
    } finally {
      this.running = null
      this.pump()
    }
  }
}
```

`apps/server/src/recovery.ts`:
```ts
import { readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import { jobs, jobSteps, type DB } from '@shotprompt/db'
import { DATA_DIR } from './env'

export function recover(db: DB) {
  const stale = ['running', 'queued']
  db.update(jobs).set({ status: 'failed', error: 'server restarted' }).where(inArray(jobs.status, stale)).run()
  db.update(jobSteps).set({ status: 'failed', error: 'server restarted' }).where(inArray(jobSteps.status, stale)).run()
  if (existsSync(DATA_DIR))
    for (const f of readdirSync(DATA_DIR, { recursive: true, withFileTypes: true }))
      if (f.isFile() && f.name.endsWith('.tmp')) rmSync(join(f.parentPath, f.name), { force: true })
}
```

In `index.ts`, call `recover(db)` after `createDb` and before `listen`.

- [ ] **Step 4: Run** `bun test apps/server` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): persistent job queue with cancel and startup recovery"`

---

### Task 8: apps/server — pipeline steps + orchestration

**Files:**
- Create: `apps/server/src/steps/spawn.ts`, `apps/server/src/steps/normalize.ts`, `apps/server/src/steps/extract-audio.ts`, `apps/server/src/steps/transcribe.ts`, `apps/server/src/steps/detect-scenes.ts`, `apps/server/src/steps/detect-hooks.ts`, `apps/server/src/steps/thumbnails.ts`, `apps/server/src/pipeline.ts`
- Test: `apps/server/test/pipeline.test.ts`

**Interfaces:**
- Consumes: core builders/parsers (Task 5), `JobCtx` (Task 7), `emitEvent`.
- Produces:
  - `spawn.ts`: `runCmd(cmd: string, args: string[], ctx: JobCtx, opts?: { onStdoutLine?: (l: string) => void }): Promise<{ stderr: string }>` — Bun.spawn, registers child via `ctx.setChild`, rejects on abort or non-zero exit (except scene step which resolves regardless — pass `opts.ignoreExitCode`)
  - Each step file: `export async function run(db: DB, videoId: string, ctx: JobCtx): Promise<void>` and `export function satisfied(db: DB, videoId: string): boolean`
  - `pipeline.ts`: `PIPELINE_STEPS = ['normalize','extract-audio','transcribe','detect-scenes','detect-hooks','thumbnails'] as const`; `makePipelineRunner(db: DB): JobRunner` — for each step: insert job_steps row; if `satisfied()` mark `done` immediately (skip); else run, emitting `step:update {videoId, jobId, name, status, progress?}`; on all done → video `status='ready'`, delete `audio.wav`; on error → video `status='failed'`, rethrow
  - Step behaviors (all artifacts written as `<file>.tmp` then renamed):
    - normalize: probe upload → write `videos.duration/width/height`; remux or transcode to `source.mp4`; delete original upload file. `satisfied`: `source.mp4` exists && `duration` set
    - extract-audio: → `audio.wav`. `satisfied`: `audio.wav` exists **or** transcribe already satisfied
    - transcribe: resume offset = `max(segments.end)*1000` if segments exist; spawn `whisper-cli` with `buildWhisperArgs` + model from settings; each stdout line through `parseWhisperLine` → insert into `segments` (times shifted by `+offsetMs/1000` **only if** parsed start of first line resets to 0 — implementer must verify actual whisper.cpp behavior with `--offset-t` once and keep a comment); emit `step:update` with `progress = lastEnd / duration` at most once per 2s. `satisfied`: never (a completed transcribe is recorded by its prior job_steps row being `done` — checked by orchestrator, see below)
    - detect-scenes: `runCmd(ffmpeg, buildSceneArgs, {ignoreExitCode:true})` → replace video's `scenes` rows. `satisfied`: prior done step + rows exist
    - detect-hooks: load segments+scenes+keywords(for video language) → `detectHooks` → **delete old candidates for video** → insert new (uuid ids). `satisfied`: prior done step + candidates exist
    - thumbnails: for each candidate without thumbnail: `buildThumbnailArgs(source, (start+end)/2, thumbs/<id>.jpg)`; update row. `satisfied`: all candidates have thumbnailPath
  - Skip rule (orchestrator): a step is skipped when `satisfied(db, videoId)` **or** the most recent prior pipeline job for this video has this step `done` and its artifact-check passes — implement as: `const prevDone = new Set(names of done steps from latest prior pipeline job)`; skip when `prevDone.has(name) && satisfied !== false`… keep it simple: skip when `prevDone.has(name) && satisfied(db, videoId)`, where transcribe's `satisfied` = `segments count > 0`. (transcribe resume path: when **not** skipped but segments exist, resume with offset.)

- [ ] **Step 1: Failing test** (orchestrator logic only — steps mocked)

`apps/server/test/pipeline.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { createDb, jobs, jobSteps, videos } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { makePipelineRunner, PIPELINE_STEPS } from '../src/pipeline'

// makePipelineRunner accepts an optional steps map for tests
it('runs steps in order, skips satisfied ones, marks video ready', async () => {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'processing', language: 'th', createdAt: 1 }).run()
  db.insert(jobs).values({ id: 'j1', videoId: 'v1', type: 'pipeline', status: 'queued', createdAt: 1 }).run()
  const ran: string[] = []
  const fake = Object.fromEntries(PIPELINE_STEPS.map(name => [name, {
    run: async () => { ran.push(name) },
    satisfied: () => name === 'normalize', // pretend normalize already done
  }]))
  const runner = makePipelineRunner(db, fake as any)
  await runner('j1', { signal: new AbortController().signal, setChild: () => {} })
  expect(ran).toEqual(PIPELINE_STEPS.filter(s => s !== 'normalize'))
  expect(db.select().from(videos).where(eq(videos.id, 'v1')).get()!.status).toBe('ready')
  expect(db.select().from(jobSteps).all().every(s => s.status === 'done')).toBe(true)
})

it('marks video failed and rethrows on step error', async () => {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'processing', language: 'th', createdAt: 1 }).run()
  db.insert(jobs).values({ id: 'j1', videoId: 'v1', type: 'pipeline', status: 'queued', createdAt: 1 }).run()
  const fake = Object.fromEntries(PIPELINE_STEPS.map(name => [name, {
    run: async () => { if (name === 'transcribe') throw new Error('whisper died') },
    satisfied: () => false,
  }]))
  const runner = makePipelineRunner(db, fake as any)
  await expect(runner('j1', { signal: new AbortController().signal, setChild: () => {} })).rejects.toThrow('whisper died')
  expect(db.select().from(videos).where(eq(videos.id, 'v1')).get()!.status).toBe('failed')
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `pipeline.ts`**

```ts
import { and, desc, eq } from 'drizzle-orm'
import { jobs, jobSteps, videos, type DB } from '@shotprompt/db'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { JobCtx, JobRunner } from './queue'
import { emitEvent } from './events'
import { videoDir } from './env'
import * as normalize from './steps/normalize'
import * as extractAudio from './steps/extract-audio'
import * as transcribe from './steps/transcribe'
import * as detectScenes from './steps/detect-scenes'
import * as detectHooks from './steps/detect-hooks'
import * as thumbnails from './steps/thumbnails'

export const PIPELINE_STEPS = ['normalize', 'extract-audio', 'transcribe', 'detect-scenes', 'detect-hooks', 'thumbnails'] as const
type StepImpl = { run(db: DB, videoId: string, ctx: JobCtx): Promise<void>; satisfied(db: DB, videoId: string): boolean }
const DEFAULT_STEPS: Record<string, StepImpl> = {
  normalize, 'extract-audio': extractAudio, transcribe, 'detect-scenes': detectScenes, 'detect-hooks': detectHooks, thumbnails,
}

export function makePipelineRunner(db: DB, steps: Record<string, StepImpl> = DEFAULT_STEPS): JobRunner {
  return async (jobId, ctx) => {
    const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()!
    const videoId = job.videoId
    db.update(videos).set({ status: 'processing' }).where(eq(videos.id, videoId)).run()
    try {
      for (const name of PIPELINE_STEPS) {
        const stepRow = db.insert(jobSteps).values({ jobId, name, status: 'running', startedAt: Date.now() }).returning().get()
        const finish = (status: string, error?: string) => {
          db.update(jobSteps).set({ status, error: error ?? null, completedAt: Date.now() }).where(eq(jobSteps.id, stepRow.id)).run()
          emitEvent('step:update', { videoId, jobId, name, status })
        }
        emitEvent('step:update', { videoId, jobId, name, status: 'running' })
        if (steps[name].satisfied(db, videoId)) { finish('done'); continue }
        try { await steps[name].run(db, videoId, ctx); finish('done') }
        catch (e) { finish('failed', e instanceof Error ? e.message : String(e)); throw e }
      }
      const audio = join(videoDir(videoId), 'audio.wav')
      if (existsSync(audio)) rmSync(audio)
      db.update(videos).set({ status: 'ready' }).where(eq(videos.id, videoId)).run()
      emitEvent('video:update', { videoId, status: 'ready' })
    } catch (e) {
      db.update(videos).set({ status: 'failed' }).where(eq(videos.id, videoId)).run()
      emitEvent('video:update', { videoId, status: 'failed' })
      throw e
    }
  }
}
```

- [ ] **Step 4: Implement step files** (real implementations; orchestrator tests stay green via injected fakes)

`apps/server/src/steps/spawn.ts`:
```ts
import type { JobCtx } from '../queue'

export async function runCmd(
  cmd: string, args: string[], ctx: JobCtx,
  opts: { onStdoutLine?: (line: string) => void; ignoreExitCode?: boolean } = {},
): Promise<{ stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: 'pipe', stderr: 'pipe' })
  ctx.setChild(proc)
  const onAbort = () => proc.kill()
  ctx.signal.addEventListener('abort', onAbort, { once: true })
  let stdoutDone: Promise<void> = Promise.resolve()
  if (opts.onStdoutLine) {
    stdoutDone = (async () => {
      let buf = ''
      for await (const chunk of proc.stdout) {
        buf += new TextDecoder().decode(chunk)
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const l of lines) opts.onStdoutLine!(l)
      }
      if (buf) opts.onStdoutLine!(buf)
    })()
  }
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  await stdoutDone
  ctx.setChild(null)
  ctx.signal.removeEventListener('abort', onAbort)
  if (ctx.signal.aborted) throw new Error('canceled')
  if (code !== 0 && !opts.ignoreExitCode) throw new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`)
  return { stderr }
}

export async function renameTmp(tmp: string, final: string) {
  const { renameSync } = await import('node:fs')
  renameSync(tmp, final)
}
```

`apps/server/src/steps/normalize.ts`:
```ts
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { videos, type DB } from '@shotprompt/db'
import { buildNormalizeArgs, buildProbeArgs, needsTranscode, parseProbe } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd, renameTmp } from './spawn'

export function satisfied(db: DB, videoId: string): boolean {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()
  return !!v?.duration && existsSync(join(videoDir(videoId), 'source.mp4'))
}

export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()!
  const dir = videoDir(videoId)
  mkdirSync(join(dir, 'thumbs'), { recursive: true }); mkdirSync(join(dir, 'exports'), { recursive: true })
  const probeProc = Bun.spawn(['ffprobe', ...buildProbeArgs(v.path)], { stdout: 'pipe' })
  const probe = parseProbe(await new Response(probeProc.stdout).text())
  const out = join(dir, 'source.mp4'), tmp = out + '.tmp'
  await runCmd('ffmpeg', buildNormalizeArgs(v.path, tmp, needsTranscode(probe)), ctx)
  await renameTmp(tmp, out)
  if (v.path !== out) rmSync(v.path, { force: true }) // delete raw upload
  db.update(videos).set({ path: out, duration: probe.duration, width: probe.width, height: probe.height })
    .where(eq(videos.id, videoId)).run()
}
```

`apps/server/src/steps/extract-audio.ts`:
```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { count, eq } from 'drizzle-orm'
import { segments, type DB } from '@shotprompt/db'
import { buildExtractAudioArgs } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd, renameTmp } from './spawn'

const hasSegments = (db: DB, videoId: string) =>
  (db.select({ n: count() }).from(segments).where(eq(segments.videoId, videoId)).get()?.n ?? 0) > 0

export function satisfied(db: DB, videoId: string): boolean {
  return existsSync(join(videoDir(videoId), 'audio.wav')) || hasSegments(db, videoId)
}
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const dir = videoDir(videoId)
  const out = join(dir, 'audio.wav'), tmp = out + '.tmp.wav' // keep .wav suffix for ffmpeg format detection; sweep matches *.tmp* — use '.tmp.wav' and sweep pattern includes it
  await runCmd('ffmpeg', buildExtractAudioArgs(join(dir, 'source.mp4'), tmp), ctx)
  await renameTmp(tmp, out)
}
```
(Recovery sweep in Task 7 matches `.endsWith('.tmp')` — extend it to `f.name.includes('.tmp')` in this task and adjust its test.)

`apps/server/src/steps/transcribe.ts`:
```ts
import { join } from 'node:path'
import { eq, max } from 'drizzle-orm'
import { segments, videos, type DB } from '@shotprompt/db'
import { buildWhisperArgs, parseWhisperLine, type Language } from '@shotprompt/core'
import { getSetting, modelPath, videoDir } from '../env'
import { emitEvent } from '../events'
import type { JobCtx } from '../queue'
import { runCmd } from './spawn'

export function satisfied(db: DB, videoId: string): boolean { return false } // resume handled inside run; full completion tracked via prior segments + offset reaching duration is not knowable — always run, resume makes it cheap

export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()!
  const last = db.select({ m: max(segments.end) }).from(segments).where(eq(segments.videoId, videoId)).get()?.m ?? 0
  if (v.duration && last >= v.duration - 5) return // effectively complete from a previous run
  const offsetMs = last > 0 ? Math.floor(last * 1000) : 0
  const model = modelPath(getSetting(db, 'whisperModel', 'large-v3'))
  let lastEmit = 0
  await runCmd('whisper-cli', buildWhisperArgs({ model, audio: join(videoDir(videoId), 'audio.wav'), language: v.language as Language, offsetMs }), ctx, {
    onStdoutLine: line => {
      const seg = parseWhisperLine(line)
      if (!seg) return
      // NOTE: verify once during implementation whether whisper.cpp prints absolute
      // timestamps when --offset-t is set; if relative, add offsetMs/1000 here.
      db.insert(segments).values({ videoId, start: seg.start, end: seg.end, text: seg.text }).run()
      if (Date.now() - lastEmit > 2000) {
        lastEmit = Date.now()
        emitEvent('step:update', { videoId, name: 'transcribe', status: 'running', progress: v.duration ? seg.end / v.duration : 0 })
      }
    },
  })
}
```

`apps/server/src/steps/detect-scenes.ts`:
```ts
import { join } from 'node:path'
import { count, eq } from 'drizzle-orm'
import { scenes, type DB } from '@shotprompt/db'
import { buildSceneArgs, parseSceneTimestamps } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd } from './spawn'

export function satisfied(db: DB, videoId: string): boolean {
  return (db.select({ n: count() }).from(scenes).where(eq(scenes.videoId, videoId)).get()?.n ?? 0) > 0
}
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const { stderr } = await runCmd('ffmpeg', buildSceneArgs(join(videoDir(videoId), 'source.mp4')), ctx, { ignoreExitCode: true })
  const ts = parseSceneTimestamps(stderr)
  db.delete(scenes).where(eq(scenes.videoId, videoId)).run()
  if (ts.length) db.insert(scenes).values(ts.map(time => ({ videoId, time }))).run()
}
```

`apps/server/src/steps/detect-hooks.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { candidates, keywords, scenes, segments, videos, type DB } from '@shotprompt/db'
import { detectHooks, type KeywordTier, type Language } from '@shotprompt/core'
import type { JobCtx } from '../queue'

export function satisfied(db: DB, videoId: string): boolean { return false } // cheap & pure — always recompute on retry

export async function run(db: DB, videoId: string, _ctx: JobCtx) {
  const v = db.select().from(videos).where(eq(videos.id, videoId)).get()!
  const segs = db.select().from(segments).where(eq(segments.videoId, videoId)).all()
    .sort((a, b) => a.start - b.start)
  const scn = db.select().from(scenes).where(eq(scenes.videoId, videoId)).all().map(s => s.time)
  const kws = db.select().from(keywords).where(eq(keywords.language, v.language)).all()
  const tiers: KeywordTier[] = [1, 2, 3].map(tier => ({
    tier: tier as 1 | 2 | 3,
    weight: kws.find(k => k.tier === tier)?.weight ?? 0,
    keywords: kws.filter(k => k.tier === tier).map(k => k.word),
  }))
  const clips = detectHooks(segs, scn, tiers, v.language as Language)
  db.delete(candidates).where(eq(candidates.videoId, videoId)).run()
  if (clips.length)
    db.insert(candidates).values(clips.map(c => ({ id: crypto.randomUUID(), videoId, start: c.start, end: c.end, score: c.score }))).run()
}
```

`apps/server/src/steps/thumbnails.ts`:
```ts
import { join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { candidates, type DB } from '@shotprompt/db'
import { buildThumbnailArgs } from '@shotprompt/core'
import { videoDir } from '../env'
import type { JobCtx } from '../queue'
import { runCmd, renameTmp } from './spawn'

export function satisfied(db: DB, videoId: string): boolean {
  return db.select().from(candidates).where(and(eq(candidates.videoId, videoId), isNull(candidates.thumbnailPath))).all().length === 0
}
export async function run(db: DB, videoId: string, ctx: JobCtx) {
  const dir = videoDir(videoId)
  const src = join(dir, 'source.mp4')
  for (const c of db.select().from(candidates).where(and(eq(candidates.videoId, videoId), isNull(candidates.thumbnailPath))).all()) {
    const out = join(dir, 'thumbs', `${c.id}.jpg`), tmp = out + '.tmp'
    await runCmd('ffmpeg', buildThumbnailArgs(src, (c.start + c.end) / 2, tmp), ctx)
    await renameTmp(tmp, out)
    db.update(candidates).set({ thumbnailPath: out }).where(eq(candidates.id, c.id)).run()
  }
}
```
Update `recovery.ts` sweep condition to `f.name.includes('.tmp')` and its test accordingly.

- [ ] **Step 5: Run** `bun test apps/server` → PASS; `bun run typecheck` → 0 errors.
- [ ] **Step 6: Commit** — `git commit -am "feat(server): pipeline steps with skip/resume orchestration"`

---

### Task 9: apps/server — video routes (ingest, library, retry, cancel, Range stream)

**Files:**
- Create: `apps/server/src/routes/videos.ts`, `apps/server/src/routes/jobs.ts`, `apps/server/src/context.ts`; Modify: `apps/server/src/app.ts`, `apps/server/src/index.ts`
- Test: `apps/server/test/videos.test.ts`

**Interfaces:**
- Produces:
  - `context.ts`: `interface Ctx { db: DB; pipelineQueue: JobQueue; exportQueue: JobQueue }` + `createCtx(db): Ctx` wiring `makePipelineRunner` (Task 8) and export runner (Task 11; until Task 11 lands use a runner that throws `'not implemented'`)
  - `createApp(ctx: Ctx)` (signature change from Task 6 — update system routes + tests to take ctx)
  - `POST /videos` — either multipart (`file`, `language`) or JSON `{ path, language }`. Behavior: id = uuid; mkdir `videoDir/`; multipart → `Bun.write(videoDir/upload.<ext>, file)`; path-mode → validate `existsSync(path)` (400 if not), copy with `Bun.write(dest, Bun.file(path))`; insert video (`status='uploaded'`, path = the copied upload file); insert pipeline job (`status='queued'`); `pipelineQueue.enqueue(jobId)`; return video row + jobId
  - `GET /videos` — list, newest first, each with clipCount (count of clips)
  - `GET /videos/:id` — video + latest job (with ordered job_steps) + candidates count
  - `DELETE /videos/:id` — 409 if latest job running/queued; else delete rows (video, jobs+steps, segments, scenes, candidates, clips, clip_subtitles, exports) + `rmSync(videoDir, {recursive:true, force:true})`
  - `POST /videos/:id/retry` — 409 if a pipeline job is running/queued for it; insert new queued pipeline job, enqueue
  - `GET /videos/:id/stream` — serves `source.mp4` honoring the `Range` header: `206` with `Content-Range`/`Accept-Ranges`, `Bun.file(path).slice(start, end+1)`; full `200` without Range
  - `jobs.ts`: `POST /jobs/:id/cancel` — try both queues' `.cancel(id)`; 404 if job unknown, 409 if not cancelable (already terminal)

- [ ] **Step 1: Failing tests**

`apps/server/test/videos.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb, jobs, videos } from '@shotprompt/db'
import { createApp } from '../src/app'
import { createCtx } from '../src/context'

function makeApp() {
  const db = createDb(':memory:')
  const ctx = createCtx(db, { autoRun: false }) // autoRun:false → enqueue records but does not execute (test hook)
  return { app: createApp(ctx), db }
}

describe('videos', () => {
  it('ingests via local path and queues a pipeline job', async () => {
    const { app, db } = makeApp()
    const dir = mkdtempSync(join(tmpdir(), 'sp-'))
    const src = join(dir, 'in.mp4'); writeFileSync(src, 'fake')
    const res = await app.handle(new Request('http://x/videos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: src, language: 'th' }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.video.status).toBe('uploaded')
    expect(db.select().from(jobs).all()).toHaveLength(1)
  })
  it('400 on missing local path', async () => {
    const { app } = makeApp()
    const res = await app.handle(new Request('http://x/videos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/nope/nothing.mp4', language: 'th' }),
    }))
    expect(res.status).toBe(400)
  })
  it('DELETE refuses while job is active', async () => {
    const { app, db } = makeApp()
    db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'processing', language: 'th', createdAt: 1 }).run()
    db.insert(jobs).values({ id: 'j1', videoId: 'v1', type: 'pipeline', status: 'running', createdAt: 1 }).run()
    const res = await app.handle(new Request('http://x/videos/v1', { method: 'DELETE' }))
    expect(res.status).toBe(409)
  })
  it('stream honors Range', async () => {
    const { app, db } = makeApp()
    const dir = mkdtempSync(join(tmpdir(), 'sp-'))
    const src = join(dir, 'source.mp4'); writeFileSync(src, '0123456789')
    db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: src, status: 'ready', language: 'th', createdAt: 1 }).run()
    const res = await app.handle(new Request('http://x/videos/v1/stream', { headers: { range: 'bytes=2-5' } }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await res.text()).toBe('2345')
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `context.ts` (with `autoRun` test hook), `videos.ts`, `jobs.ts` per the interface block; key route code:

```ts
// context.ts
import { join } from 'node:path'
import type { DB } from '@shotprompt/db'
import { JobQueue } from './queue'
import { makePipelineRunner } from './pipeline'
import { makeExportRunner } from './routes/exports' // Task 11; stub until then

export interface Ctx { db: DB; pipelineQueue: JobQueue; exportQueue: JobQueue }
export function createCtx(db: DB, opts: { autoRun?: boolean } = {}): Ctx {
  const autoRun = opts.autoRun !== false
  const wrap = (q: JobQueue) => autoRun ? q : Object.assign(q, { enqueue: () => {} })
  const pipelineQueue = wrap(new JobQueue(db, 'pipeline', makePipelineRunner(db)))
  const exportQueue = wrap(new JobQueue(db, 'export', makeExportRunner(db)))
  return { db, pipelineQueue, exportQueue }
}
```

```ts
// routes/videos.ts — core of each handler
// POST /videos
const id = crypto.randomUUID()
mkdirSync(videoDir(id), { recursive: true })
let uploadPath: string, filename: string
if (isJsonBody) {
  if (!existsSync(body.path)) return error(400, { message: 'file not found: ' + body.path })
  filename = basename(body.path)
  uploadPath = join(videoDir(id), 'upload' + extname(body.path))
  await Bun.write(uploadPath, Bun.file(body.path))
} else {
  const f = body.file as File
  filename = f.name
  uploadPath = join(videoDir(id), 'upload' + extname(f.name))
  await Bun.write(uploadPath, f)
}
db.insert(videos).values({ id, filename, path: uploadPath, status: 'uploaded', language: body.language, createdAt: Date.now() }).run()
const jobId = crypto.randomUUID()
db.insert(jobs).values({ id: jobId, videoId: id, type: 'pipeline', status: 'queued', createdAt: Date.now() }).run()
ctx.pipelineQueue.enqueue(jobId)
return { video: db.select().from(videos).where(eq(videos.id, id)).get(), jobId }

// GET /videos/:id/stream
const v = db.select().from(videos).where(eq(videos.id, params.id)).get()
if (!v) return error(404)
const file = Bun.file(v.path)
const size = file.size
const range = request.headers.get('range')
if (range) {
  const m = range.match(/bytes=(\d+)-(\d*)/)
  const start = Number(m![1])
  const end = m![2] ? Number(m![2]) : size - 1
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-type': 'video/mp4' },
  })
}
return new Response(file, { headers: { 'accept-ranges': 'bytes', 'content-type': 'video/mp4' } })
```
Update `app.ts` to `createApp(ctx: Ctx)` mounting `systemRoutes(ctx.db)`, `videoRoutes(ctx)`, `jobRoutes(ctx)`; update `index.ts` and Task 6 tests to build ctx.

- [ ] **Step 4: Run** `bun test apps/server` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): video ingest, library, retry, cancel, range streaming"`

---

### Task 10: apps/server — candidates, clips, subtitles routes

**Files:**
- Create: `apps/server/src/routes/clips.ts`, `apps/server/src/clip-service.ts`; Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/clips.test.ts`

**Interfaces:**
- Consumes: `clampToClip`, `buildSRT` from core; `buildThumbnailArgs`+`runCmd` for clip thumbnails (skip thumbnail when `source.mp4` absent — tests run without ffmpeg artifacts).
- Produces:
  - `clip-service.ts`:
    - `createClip(db, videoId, opts: { candidateId?: string; start?: number; end?: number }): ClipRow` — from candidate: copy start/end/score, keep `candidateId`; manual: require start<end; then `copySubtitles(db, clipId, start, end)` (insert from `segments` overlapping range, absolute times); thumbnail best-effort
    - `updateClip(db, clipId, patch: { start?: number; end?: number; cropOffset?: number }): ClipRow` — spec trim rules: for each newly covered interval (`newStart < oldStart` → `[newStart, oldStart]`; `newEnd > oldEnd` → `[oldEnd, newEnd]`) copy overlapping `segments` rows in **only** that interval; never delete/modify existing `clip_subtitles`
  - Routes: `GET /videos/:id/candidates` (score desc); `GET /videos/:id/clips`; `POST /videos/:id/clips`; `PATCH /clips/:id`; `DELETE /clips/:id` (also deletes its clip_subtitles + exports rows/files); `GET /clips/:id/subtitles` (start asc); `PUT /clips/:id/subtitles` (body `{ subtitles: {start,end,text}[] }` — replace all rows for clip); `GET /clips/:id/srt` — `buildSRT(rows, clip.start, clip.end)`, `content-disposition: attachment`

- [ ] **Step 1: Failing tests**

`apps/server/test/clips.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { createDb, candidates, clipSubtitles, segments, videos } from '@shotprompt/db'
import { eq } from 'drizzle-orm'
import { createClip, updateClip } from '../src/clip-service'

function seeded() {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'ready', language: 'th', createdAt: 1 }).run()
  db.insert(segments).values([
    { videoId: 'v1', start: 0, end: 5, text: 'a' },
    { videoId: 'v1', start: 10, end: 15, text: 'b' },
    { videoId: 'v1', start: 20, end: 25, text: 'c' },
    { videoId: 'v1', start: 30, end: 35, text: 'd' },
  ]).run()
  db.insert(candidates).values({ id: 'c1', videoId: 'v1', start: 8, end: 26, score: 55 }).run()
  return db
}

describe('createClip', () => {
  it('from candidate copies range/score and overlapping subtitles', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { candidateId: 'c1' })
    expect(clip.start).toBe(8); expect(clip.score).toBe(55); expect(clip.candidateId).toBe('c1')
    const subs = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
    expect(subs.map(s => s.text)).toEqual(['b', 'c']) // 10-15 & 20-25 overlap [8,26]
  })
  it('manual clip from raw range', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { start: 28, end: 40 })
    expect(clip.candidateId).toBeNull()
    const subs = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
    expect(subs.map(s => s.text)).toEqual(['d'])
  })
})

describe('updateClip trim rules', () => {
  it('extend copies only the new range, never touches edited rows', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { start: 8, end: 26 })
    db.update(clipSubtitles).set({ text: 'EDITED' }).where(eq(clipSubtitles.clipId, clip.id)).run()
    updateClip(db, clip.id, { start: 8, end: 36 }) // extend end: new range (26,36] → copies 'd'
    const subs = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
      .sort((a, b) => a.start - b.start)
    expect(subs.map(s => s.text)).toEqual(['EDITED', 'EDITED', 'd'])
  })
  it('shrink deletes nothing', () => {
    const db = seeded()
    const clip = createClip(db, 'v1', { start: 8, end: 26 })
    updateClip(db, clip.id, { start: 12, end: 22 })
    expect(db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `clip-service.ts`**

```ts
import { and, eq, gt, lt } from 'drizzle-orm'
import { clipSubtitles, clips, candidates, segments, type DB } from '@shotprompt/db'

function copySubtitles(db: DB, clipId: string, videoId: string, from: number, to: number) {
  const rows = db.select().from(segments)
    .where(and(eq(segments.videoId, videoId), gt(segments.end, from), lt(segments.start, to))).all()
  if (rows.length)
    db.insert(clipSubtitles).values(rows.map(r => ({ clipId, start: r.start, end: r.end, text: r.text }))).run()
}

export function createClip(db: DB, videoId: string, opts: { candidateId?: string; start?: number; end?: number }) {
  let start: number, end: number, score: number | null = null, candidateId: string | null = null
  if (opts.candidateId) {
    const c = db.select().from(candidates).where(eq(candidates.id, opts.candidateId)).get()
    if (!c) throw new Error('candidate not found')
    start = c.start; end = c.end; score = c.score; candidateId = c.id
  } else {
    if (opts.start == null || opts.end == null || opts.start >= opts.end) throw new Error('invalid range')
    start = opts.start; end = opts.end
  }
  const id = crypto.randomUUID()
  db.insert(clips).values({ id, videoId, candidateId, start, end, score, cropOffset: 0, createdAt: Date.now() }).run()
  copySubtitles(db, id, videoId, start, end)
  return db.select().from(clips).where(eq(clips.id, id)).get()!
}

export function updateClip(db: DB, clipId: string, patch: { start?: number; end?: number; cropOffset?: number }) {
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get()
  if (!clip) throw new Error('clip not found')
  const newStart = patch.start ?? clip.start, newEnd = patch.end ?? clip.end
  if (newStart >= newEnd) throw new Error('invalid range')
  if (newStart < clip.start) copySubtitles(db, clipId, clip.videoId, newStart, clip.start)
  if (newEnd > clip.end) copySubtitles(db, clipId, clip.videoId, clip.end, newEnd)
  db.update(clips).set({ start: newStart, end: newEnd, cropOffset: patch.cropOffset ?? clip.cropOffset })
    .where(eq(clips.id, clipId)).run()
  return db.select().from(clips).where(eq(clips.id, clipId)).get()!
}
```
`apps/server/src/routes/clips.ts`:
```ts
import { Elysia, t } from 'elysia'
import { asc, desc, eq } from 'drizzle-orm'
import { rmSync } from 'node:fs'
import { candidates, clipSubtitles, clips, exportsTable, type DB } from '@shotprompt/db'
import { buildSRT } from '@shotprompt/core'
import type { Ctx } from '../context'
import { createClip, updateClip } from '../clip-service'

export const clipRoutes = ({ db }: Ctx) => new Elysia()
  .get('/videos/:id/candidates', ({ params }) =>
    db.select().from(candidates).where(eq(candidates.videoId, params.id)).orderBy(desc(candidates.score)).all())
  .get('/videos/:id/clips', ({ params }) =>
    db.select().from(clips).where(eq(clips.videoId, params.id)).orderBy(asc(clips.createdAt)).all())
  .post('/videos/:id/clips', ({ params, body, error }) => {
    try { return createClip(db, params.id, body) }
    catch (e) { return error(400, { message: String(e) }) }
  }, { body: t.Object({ candidateId: t.Optional(t.String()), start: t.Optional(t.Number()), end: t.Optional(t.Number()) }) })
  .patch('/clips/:id', ({ params, body, error }) => {
    try { return updateClip(db, params.id, body) }
    catch (e) { return error(400, { message: String(e) }) }
  }, { body: t.Object({ start: t.Optional(t.Number()), end: t.Optional(t.Number()), cropOffset: t.Optional(t.Number()) }) })
  .delete('/clips/:id', ({ params }) => {
    for (const ex of db.select().from(exportsTable).where(eq(exportsTable.clipId, params.id)).all())
      if (ex.path) rmSync(ex.path, { force: true })
    db.delete(exportsTable).where(eq(exportsTable.clipId, params.id)).run()
    db.delete(clipSubtitles).where(eq(clipSubtitles.clipId, params.id)).run()
    db.delete(clips).where(eq(clips.id, params.id)).run()
    return { ok: true }
  })
  .get('/clips/:id/subtitles', ({ params }) =>
    db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, params.id)).orderBy(asc(clipSubtitles.start)).all())
  .put('/clips/:id/subtitles', ({ params, body }) => {
    db.delete(clipSubtitles).where(eq(clipSubtitles.clipId, params.id)).run()
    if (body.subtitles.length)
      db.insert(clipSubtitles).values(body.subtitles.map(s => ({ clipId: params.id, ...s }))).run()
    return { ok: true }
  }, { body: t.Object({ subtitles: t.Array(t.Object({ start: t.Number(), end: t.Number(), text: t.String() })) }) })
  .get('/clips/:id/srt', ({ params, error }) => {
    const clip = db.select().from(clips).where(eq(clips.id, params.id)).get()
    if (!clip) return error(404)
    const rows = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, params.id)).all()
    return new Response(buildSRT(rows, clip.start, clip.end), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="clip-${clip.id}.srt"` },
    })
  })
```
Mount in `app.ts`.

- [ ] **Step 4: Run** `bun test apps/server` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): candidates, clips, subtitle trim rules, srt"`

---

### Task 11: apps/server — exports (batch, two-pass loudnorm render, font bundle)

**Files:**
- Create: `apps/server/src/routes/exports.ts`, `assets/fonts/NotoSansThai-Bold.ttf`; Modify: `apps/server/src/context.ts` (real runner), `apps/server/src/app.ts`
- Test: `apps/server/test/exports.test.ts`

**Interfaces:**
- Consumes: `buildLoudnormMeasureArgs`/`parseLoudnorm`/`buildExportArgs`/`buildASS`/`clampToClip` from core; `JobQueue` export queue; clip rows.
- Produces:
  - `POST /exports` — body `{ clipIds: string[], aspect: Aspect, burnSubtitles: boolean }`; for each clip: insert `exports` row (`status='queued'`) + a `jobs` row (`type='export'`, id = export id, videoId = clip's video) + enqueue; returns rows. 404 if any clip missing
  - `makeExportRunner(db): JobRunner` — per export id: load export+clip+video; write ASS to `videoDir/exports/<id>.ass` when burnSubtitles (from clip_subtitles via `buildASS(rows, clip.start, clip.end, aspect, {x: video.width, y: video.height})`); pass 1 measure loudnorm; pass 2 `buildExportArgs` → `<id>.mp4.tmp` → rename; update export row `status='done', path=…`; emit `export:update {exportId, clipId, videoId, status}`; on error `status='failed'`+error; delete `.ass` after render
  - `GET /exports/:id/download` — `Bun.file(path)`, `content-disposition: attachment; filename="<video-filename>-<clipStart>s.mp4"`; 409 if not done
  - `DELETE /exports/:id` — delete file + row
- Font: commit `NotoSansThai-Bold.ttf` (SIL OFL). Fetch during this task:
  `curl -L -o assets/fonts/NotoSansThai-Bold.ttf "https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSansThai/hinted/ttf/NotoSansThai-Bold.ttf"` — verify with `file assets/fonts/NotoSansThai-Bold.ttf` → "TrueType Font data". If the URL 404s, download the Noto Sans Thai family zip from https://fonts.google.com/noto/specimen/Noto+Sans+Thai and copy the static Bold ttf.

- [ ] **Step 1: Failing test** (route-level; render runner covered by arg-builder tests in core + manual E2E in Task 17)

`apps/server/test/exports.test.ts`:
```ts
import { describe, expect, it } from 'bun:test'
import { createDb, clips, exportsTable, jobs, videos } from '@shotprompt/db'
import { createApp } from '../src/app'
import { createCtx } from '../src/context'

function makeApp() {
  const db = createDb(':memory:')
  db.insert(videos).values({ id: 'v1', filename: 'a.mp4', path: '/x', status: 'ready', language: 'th', createdAt: 1, width: 1920, height: 1080 }).run()
  db.insert(clips).values({ id: 'cl1', videoId: 'v1', start: 5, end: 20, cropOffset: 0, createdAt: 1 }).run()
  return { app: createApp(createCtx(db, { autoRun: false })), db }
}

it('POST /exports creates one export row per clip and queues jobs', async () => {
  const { app, db } = makeApp()
  const res = await app.handle(new Request('http://x/exports', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clipIds: ['cl1'], aspect: '9:16', burnSubtitles: true }),
  }))
  expect(res.status).toBe(200)
  expect(db.select().from(exportsTable).all()).toHaveLength(1)
  expect(db.select().from(jobs).all().filter(j => j.type === 'export')).toHaveLength(1)
})

it('download 409s while not done', async () => {
  const { app, db } = makeApp()
  db.insert(exportsTable).values({ id: 'e1', clipId: 'cl1', aspect: '9:16', burnSubtitles: false, status: 'queued', createdAt: 1 }).run()
  const res = await app.handle(new Request('http://x/exports/e1/download'))
  expect(res.status).toBe(409)
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Download font** (command above), implement routes + `makeExportRunner` per Interfaces:

```ts
// makeExportRunner core (routes/exports.ts)
export function makeExportRunner(db: DB): JobRunner {
  return async (exportId, ctx) => {
    const exp = db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).get()!
    const clip = db.select().from(clips).where(eq(clips.id, exp.clipId)).get()!
    const video = db.select().from(videos).where(eq(videos.id, clip.videoId)).get()!
    db.update(exportsTable).set({ status: 'rendering' }).where(eq(exportsTable.id, exportId)).run()
    emitEvent('export:update', { exportId, clipId: clip.id, videoId: video.id, status: 'rendering' })
    const dir = videoDir(video.id)
    const out = join(dir, 'exports', `${exportId}.mp4`), tmp = out + '.tmp.mp4'
    let assPath: string | undefined
    try {
      if (exp.burnSubtitles) {
        const rows = db.select().from(clipSubtitles).where(eq(clipSubtitles.clipId, clip.id)).all()
        assPath = join(dir, 'exports', `${exportId}.ass`)
        await Bun.write(assPath, buildASS(rows, clip.start, clip.end, exp.aspect as Aspect, { x: video.width!, y: video.height! }))
      }
      const { stderr } = await runCmd('ffmpeg', buildLoudnormMeasureArgs(video.path, clip.start, clip.end), ctx, { ignoreExitCode: true })
      const loudnorm = parseLoudnorm(stderr)
      await runCmd('ffmpeg', buildExportArgs({
        input: video.path, start: clip.start, end: clip.end, aspect: exp.aspect as Aspect,
        cropOffset: clip.cropOffset, assPath, fontsDir: FONTS_DIR, loudnorm, output: tmp,
      }), ctx)
      renameSync(tmp, out)
      db.update(exportsTable).set({ status: 'done', path: out }).where(eq(exportsTable.id, exportId)).run()
      emitEvent('export:update', { exportId, clipId: clip.id, videoId: video.id, status: 'done' })
    } catch (e) {
      db.update(exportsTable).set({ status: 'failed', error: String(e) }).where(eq(exportsTable.id, exportId)).run()
      emitEvent('export:update', { exportId, clipId: clip.id, videoId: video.id, status: 'failed' })
      throw e
    } finally { if (assPath) rmSync(assPath, { force: true }) }
  }
}
```
Replace the stub import in `context.ts` with this real runner.

- [ ] **Step 4: Run** `bun test apps/server` → PASS; `git add assets/fonts` works (ttf committed).
- [ ] **Step 5: Commit** — `git commit -am "feat(server): export pipeline with two-pass loudnorm and bundled Thai font"`

---

### Task 12: apps/server — whisper model download (tmp + Range resume)

**Files:**
- Modify: `apps/server/src/routes/system.ts`
- Test: `apps/server/test/model-download.test.ts`

**Interfaces:**
- Produces: `POST /system/model/download` — starts async download of `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<whisperModel>.bin` to `modelPath+'.tmp.bin'`; if `.tmp.bin` exists, resume with `Range: bytes=<size>-` and append; rename on completion; progress events `model:download {model, received, total, done}` (throttled 1/s); returns `{ started: true }` immediately; 409 if already downloading or already downloaded. Extract the fetch/stream logic as `downloadModel(url, dest, onProgress)` for testability against a local `Bun.serve` fixture.

- [ ] **Step 1: Failing test**

`apps/server/test/model-download.test.ts`:
```ts
import { expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadModel } from '../src/routes/system'

it('downloads to .tmp.bin then renames; resumes with Range', async () => {
  const DATA = '0123456789'
  let lastRange: string | null = null
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(req) {
      lastRange = req.headers.get('range')
      const start = lastRange ? Number(lastRange.match(/bytes=(\d+)-/)![1]) : 0
      return new Response(DATA.slice(start), {
        status: lastRange ? 206 : 200,
        headers: { 'content-length': String(DATA.length - start) },
      })
    },
  })
  const url = `http://127.0.0.1:${server.port}/model.bin`
  const dest = join(mkdtempSync(join(tmpdir(), 'sp-')), 'ggml-tiny.bin')
  // simulate a previously interrupted download: 4 bytes already in the tmp file
  writeFileSync(dest + '.tmp.bin', DATA.slice(0, 4))
  await downloadModel(url, dest, () => {})
  expect(lastRange).toBe('bytes=4-')
  expect(existsSync(dest + '.tmp.bin')).toBe(false)
  expect(readFileSync(dest, 'utf8')).toBe(DATA)
  server.stop()
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `routes/system.ts`:

```ts
import { createWriteStream, existsSync, renameSync, statSync } from 'node:fs'

export async function downloadModel(
  url: string, dest: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const tmp = dest + '.tmp.bin'
  let received = existsSync(tmp) ? statSync(tmp).size : 0
  const res = await fetch(url, { headers: received > 0 ? { range: `bytes=${received}-` } : {} })
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  if (received > 0 && res.status !== 206) received = 0 // server ignored Range → restart
  const total = received + Number(res.headers.get('content-length') ?? 0)
  const out = createWriteStream(tmp, { flags: received > 0 ? 'a' : 'w' })
  let lastEmit = 0
  for await (const chunk of res.body) {
    out.write(chunk)
    received += chunk.length
    if (Date.now() - lastEmit > 1000) { lastEmit = Date.now(); onProgress(received, total) }
  }
  await new Promise<void>((resolve, reject) => out.end((e: unknown) => e ? reject(e) : resolve()))
  renameSync(tmp, dest)
  onProgress(received, total)
}
```

Route wiring in `systemRoutes`: `POST /system/model/download` — 409 when `existsSync(modelPath(model))` or a download for this model is already in flight (module-level `Set<string>`); otherwise fire-and-forget `downloadModel(hfUrl(model), modelPath(model), (received, total) => emitEvent('model:download', { model, received, total, done: false }))` with `.then(() => emitEvent('model:download', { model, done: true }))` and `.catch(e => emitEvent('model:download', { model, error: String(e), done: true }))`, returning `{ started: true }` immediately. `hfUrl(m)` = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${m}.bin`.
- [ ] **Step 4: Run** `bun test apps/server` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): resumable whisper model download"`

---

### Task 13: apps/web — scaffold, Eden client, SSE hook

**Files:**
- Create: `apps/web/` (Next.js app: `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/globals.css`, `lib/api.ts`, `lib/use-events.ts`, `components.json` via shadcn init)

**Interfaces:**
- Produces: `api` — Eden treaty client `treaty<App>('http://127.0.0.1:3001')`; `useEvents(handler: (e: {type: string; [k: string]: unknown}) => void)` — EventSource on `/events`, calls `handler({type:'$reconnect'})` on every `onopen` after the first so pages refetch on reconnect; auto-retry is native to EventSource.

- [ ] **Step 1: Scaffold**

```bash
cd apps && bunx create-next-app@latest web --ts --app --tailwind --no-eslint --src-dir=false --import-alias "@/*" --use-bun
cd web && bunx shadcn@latest init -d && bunx shadcn@latest add button card input slider table badge dialog progress select textarea
```
Set `apps/web/package.json` name to `web`, add deps `"@elysiajs/eden": "^1.1.0"`, `"@shotprompt/server": "workspace:*"`, script `"dev": "next dev -H 127.0.0.1 -p 3000"`.

- [ ] **Step 2: `lib/api.ts` + `lib/use-events.ts`**

```ts
// lib/api.ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@shotprompt/server'
export const api = treaty<App>('http://127.0.0.1:3001')
export const API_BASE = 'http://127.0.0.1:3001'
```
```ts
// lib/use-events.ts
'use client'
import { useEffect, useRef } from 'react'
import { API_BASE } from './api'

export function useEvents(handler: (e: { type: string; [k: string]: unknown }) => void) {
  const ref = useRef(handler); ref.current = handler
  useEffect(() => {
    let first = true
    const es = new EventSource(`${API_BASE}/events`)
    es.onopen = () => { if (!first) ref.current({ type: '$reconnect' }); first = false }
    es.onmessage = ev => ref.current(JSON.parse(ev.data))
    return () => es.close()
  }, [])
}
```

- [ ] **Step 3: Verify** — `bun run dev` at root; visit `http://127.0.0.1:3000` (default Next page renders), server console reachable.
- [ ] **Step 4: Commit** — `git commit -am "feat(web): next.js scaffold with eden client and sse hook"`

---

### Task 14: apps/web — Library page (`/`)

**Files:**
- Create: `apps/web/app/page.tsx`, `apps/web/components/upload-form.tsx`, `apps/web/components/video-list.tsx`

**Interfaces:**
- Consumes: `api.videos.get()`, `api.videos.post(...)`, `api.videos({ id }).delete()`, `api.videos({ id }).retry.post()`, `useEvents`.

- [ ] **Step 1: Implement.** Client page that:
  - `upload-form.tsx`: file input (accept `.mp4,.mov,.mkv`) + language select (`th`/`en`) + "หรือวาง path ไฟล์ในเครื่อง" text input. File mode: `XMLHttpRequest` POST multipart to `${API_BASE}/videos` to get `upload.onprogress` → shadcn `<Progress>`; path mode: `api.videos.post({ path, language })`.
  - `video-list.tsx`: table of videos (filename, status badge, duration mm:ss, clip count, created date) with per-row: link to `/videos/[id]`, Retry button when `status==='failed'` (`retry.post()`), Delete button with confirm dialog (disabled while `processing`).
  - `page.tsx` composes both; refetches list on any `useEvents` message of type `video:update`, `job:update`, `$reconnect`.
- [ ] **Step 2: Verify manually** — with server running: upload a small mp4 (any short screen recording), watch it appear with status; delete works; path-mode ingest works with an absolute path.
- [ ] **Step 3: Commit** — `git commit -am "feat(web): library page with dual-mode upload"`

---

### Task 15: apps/web — Workspace: processing view, candidates, clip creation

**Files:**
- Create: `apps/web/app/videos/[id]/page.tsx`, `apps/web/components/processing-steps.tsx`, `apps/web/components/candidate-list.tsx`, `apps/web/components/clip-strip.tsx`, `apps/web/lib/format.ts`

**Interfaces:**
- Consumes: `api.videos({ id }).get()` (returns `{ video, job: { …, steps: [...] }, candidatesCount }`), `api.videos({ id }).candidates.get()`, `api.videos({ id }).clips.get()`, `api.videos({ id }).clips.post({ candidateId } | { start, end })`, `POST /jobs/:id/cancel`.
- Produces (used by Task 16): page holds `selectedClipId` state; renders `<ClipEditor clipId={...} video={...} />` when set (component from Task 16 — until then render a placeholder `<div>`).

- [ ] **Step 1: Implement.**
  - `processing-steps.tsx`: ordered list of the 6 step names with status icons (pending ○ / running spinner + progress % when the SSE `step:update` carries `progress` / done ✓ / failed ✕ + error text), Cancel button → `api.jobs({ id: jobId }).cancel.post()`.
  - `candidate-list.tsx`: cards sorted by score — thumbnail `<img src={`${API_BASE}/videos/${id}/thumbs/…`}>` (serve thumbs via the stream route's sibling: add tiny `GET /videos/:id/thumb/:file` static handler in this task server-side — Modify `apps/server/src/routes/videos.ts`, return `Bun.file(join(videoDir(id),'thumbs',file))` with path traversal guard `basename(file)===file`), score badge, time range, "ใช้คลิปนี้" button → `clips.post({ candidateId })`.
  - `clip-strip.tsx`: horizontal strip of created clips (thumbnail, range, selected highlight, delete ×).
  - `page.tsx`: if video.status `processing|uploaded` → processing view; if `failed` → error + retry; if `ready` → grid: left `<video>` player (`src=${API_BASE}/videos/${id}/stream`) + "สร้าง clip จากช่วงนี้" (two number inputs start/end prefilled from player `currentTime` + a "set from player" button each) ; right candidates; bottom clip strip. Refetch on relevant SSE events + `$reconnect`.
- [ ] **Step 2: Verify manually** — process a real short video end-to-end (needs ffmpeg+whisper installed and a model downloaded; use `tiny` model via settings for speed): steps animate live, candidates appear with thumbnails, clicking creates clips.
- [ ] **Step 3: Commit** — `git commit -am "feat(web): workspace with live processing and candidate selection"`

---

### Task 16: apps/web — clip editor (preview clamp, trim, crop offset, subtitle editor) + export bar

**Files:**
- Create: `apps/web/components/clip-editor.tsx`, `apps/web/components/subtitle-editor.tsx`, `apps/web/components/export-bar.tsx`; Modify: `apps/web/app/videos/[id]/page.tsx` (mount real components)

**Interfaces:**
- Consumes: `api.clips({ id }).patch(...)`, `api.clips({ id }).subtitles.get()/put()`, `${API_BASE}/clips/:id/srt`, `api.exports.post({ clipIds, aspect, burnSubtitles })`, `${API_BASE}/exports/:id/download`, export rows via new `GET /videos/:id/exports` (Modify `apps/server/src/routes/exports.ts`: list exports joined through the video's clips — add in this task).

- [ ] **Step 1: `clip-editor.tsx`.**
  - Preview clamp: `<video>` with `onLoadedMetadata`/effect setting `currentTime = clip.start`; `onTimeUpdate` → if `currentTime >= clip.end` then `pause()` + `currentTime = clip.start`. Play button starts from `clip.start`.
  - Trim: two `<Slider>` rows (start, end) bounded `[max(0, clip.start-30), min(duration, clip.end+30)]`, step 0.1, with the covered transcript text shown under the sliders (from subtitles fetched for clip); "บันทึก trim" → `patch({ start, end })` then refetch subtitles (extend may add rows).
  - Crop offset: `<Slider min={-1} max={1} step={0.05}>`; live preview via a 9:16 overlay box on the video: absolutely-positioned border whose horizontal position = `(1+offset)/2 * (containerWidth - overlayWidth)` where `overlayWidth = containerHeight * 9/16`; save via `patch({ cropOffset })`.
- [ ] **Step 2: `subtitle-editor.tsx`** — table of rows (start, end, text inputs; times as seconds with 0.1 step), edit locally, "บันทึก subtitle" → `subtitles.put({ subtitles: rows })`, "ดาวน์โหลด .srt" → anchor to srt URL.
- [ ] **Step 3: `export-bar.tsx`** — clip multi-select checkboxes (from clip strip selection state lifted to page), aspect `<Select>` (`9:16` default/`16:9`/`original`), burn-subtitles toggle, "Export" → `api.exports.post(...)`; list of this video's exports with status (live via `export:update` SSE) and Download/Delete buttons.
- [ ] **Step 4: Verify manually** — trim a clip (watch preview clamp follow), edit a subtitle line, export 9:16 with subtitles; play the downloaded mp4: crop offset applied, Thai subtitles render correctly (no floating vowels), audio level consistent.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): clip editor with trim, crop offset, subtitles, export"`

---

### Task 17: apps/web — settings page, docs, final E2E pass

**Files:**
- Create: `apps/web/app/settings/page.tsx`, `README.md`; Modify: root `package.json` (add `"postinstall"` note — none needed; verify scripts)

**Interfaces:**
- Consumes: `api.system.doctor.get()`, `api.settings.get()/put()`, `api.system['disk-usage'].get()`, `api.system.model.download.post()`, `model:download` SSE events.

- [ ] **Step 1: Settings page** — doctor card (✓/✕ per binary with `brew install ffmpeg whisper-cpp` hint when missing, acceleration line); model select (`tiny`/`base`/`small`/`medium`/`large-v3` with speed/accuracy hint text per spec) + download button with progress bar; disk usage table (per video, bytes → human size) with delete buttons.
- [ ] **Step 2: README.md** — prerequisites (`brew install ffmpeg whisper-cpp`), `bun install`, `bun dev`, first-run flow (settings → download model), where data lives (`data/`), everything binds localhost only.
- [ ] **Step 3: Full E2E checklist (manual, real binaries):**
  1. Fresh clone sim: `rm -rf data && bun install && bun dev` → doctor red on model → download `tiny` → green
  2. Ingest a ~2-min Thai clip via path mode → all 6 steps run → candidates with thumbnails
  3. Kill server mid-transcribe → restart → video failed → Retry → transcribe resumes (log shows `-ot` offset), pipeline completes
  4. Create clip from candidate + one manual clip → trim both directions → subtitle edit survives extend
  5. Export batch (both clips, 9:16, subtitles on) → files play, subs correct, loudness normalized
  6. Cancel: start re-process, cancel mid-transcribe → job canceled, no `.tmp` files under `data/` (`find data -name '*.tmp*'` → empty)
  7. Delete one export, delete one video → disk usage updates
- [ ] **Step 4: Run all tests** — `bun test packages apps/server && bun run typecheck` → all green.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): settings page, README, MVP complete"`
