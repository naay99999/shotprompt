# ShotPrompt — Feature Spec

**ShotPrompt** เป็น personal tool ใช้เอง แจกฟรี (ไม่ใช่ SaaS) — ingest วิดีโอ live commerce ไทย/อังกฤษ, transcribe, หา hook moment ด้วย keyword scoring แล้วตัดเป็น clip สั้นพร้อม subtitle

Stack: **Bun monorepo** — `apps/server` (Elysia) + `apps/web` (Next.js) + shared packages
Repo: `git@github.com:naay99999/shotprompt.git`

> Rebuild จาก repo เดิม (`shotprompt-old` — NestJS/Postgres/Redis/R2) โดยตัดทุกอย่างที่มีไว้เพื่อ multi-tenant SaaS ออก

## หลักการ

- รันเครื่องเดียวจบ: `bun install` แล้วใช้ได้เลย ไม่มี docker, ไม่มี cloud dependency
- ค่า default ต้องฟรี 100% — ทางเลือกที่เสียเงิน (OpenAI API) เป็น opt-in ผ่าน config
- ไม่มี auth, ไม่มี multi-tenant, ไม่มี billing

## ตัดออกจากระบบเดิม

| ของเดิม | แทนด้วย |
|---------|---------|
| Auth ทั้งชุด (JWT, register/login/refresh, guards) | ไม่มี — localhost คนเดียว |
| R2 + presigned upload URL (3-step flow) | Upload ตรงเข้า Elysia → เก็บ filesystem (step เดียว) |
| Postgres + docker-compose | SQLite (ไฟล์เดียว, ใช้ `bun:sqlite` + Drizzle) |
| Redis + BullMQ | In-process job queue (concurrency 1–2) |
| Socket.IO | SSE (Server-Sent Events) — Elysia stream ในตัว |
| `AnalyzeFramesStep` (GPT-4o-mini vision re-score) | ตัดทิ้ง — ใช้ keyword + scene score อย่างเดียว |
| Whisper 25 MB chunking | ไม่จำเป็นเมื่อใช้ local whisper |

## เก็บไว้ (port จาก repo เก่า)

- **Hook detection 4-phase algorithm** ทั้งชุด — activity walk, scene coverage, merge, pad พร้อมค่า constants เดิม (`SILENCE_GAP=3`, `SCORE_THRESHOLD=40`, `MAX_CLIP_DURATION=90`, `MERGE_GAP=15`, `WINDOW_PAD=5`, `BREATH_PAD=1.5`, `SCENE_BASE_SCORE=35`, `SCENE_MIN_INTERVAL=15`, `SCENE_WINDOW=30`)
- Keyword tiers ไทย/อังกฤษ (tier 1 urgency +25, tier 2 promotion +15, tier 3 CTA +8) — เป็น **seed data** ไม่ใช่ hardcode (ดู Keyword Settings)
- Pipeline steps: ffprobe metadata → extract audio → transcribe → scene detection → hook detection
- ตัวเลือก process: language (`th`/`en`), max clips (default 5), burn subtitles
- แนวทาง UI จาก frontend PRD เดิม: video library, step-by-step processing progress, clip review — ตัดหน้า auth ทิ้ง

## สถาปัตยกรรมสำคัญ: Render ย้ายไป Export Time

Feature trim + แก้ subtitle บังคับให้ pipeline ไม่ render clip ทันที:

```
เดิม:  pipeline → render ทุก clip เสร็จเลย → user ได้ไฟล์ที่แก้อะไรไม่ได้แล้ว
ใหม่:  pipeline → ได้ "draft clips" (time range + transcript + score + thumbnail)
       → user review/ปรับใน UI → กด Export → ค่อย render เฉพาะที่ต้องการ
```

ข้อดี:
- **Preview ไม่ต้อง render** — เล่นไฟล์ต้นฉบับใน `<video>` โดยบังคับช่วง start/end ด้วย JS ได้เลย
- ประหยัดเวลา ffmpeg มหาศาล (render เฉพาะ clip ที่เลือก export จริง)
- แก้ trim/subtitle แล้ว export ซ้ำได้ไม่จำกัด เพราะเก็บไฟล์ต้นฉบับไว้เสมอ

### Pipeline

1. `metadata` — ffprobe duration/resolution
2. `extract-audio` — ffmpeg
3. `transcribe` — pluggable provider (ดูด้านล่าง)
4. `detect-scenes` — scene-change timestamps
5. `detect-hooks` — 4-phase scoring → draft clips
6. `thumbnails` — ดึง frame กลาง clip ละ 1 รูป (เร็ว ไม่ใช่ render)

### Export (on-demand ต่อ clip)

ffmpeg cut ตามช่วงที่ user ปรับแล้ว + burn subtitle จาก transcript ที่แก้แล้ว (ถ้าเปิด) + แปลง aspect ratio ตามที่เลือก:

| Aspect | พฤติกรรม |
|--------|----------|
| `9:16` (default) | center-crop เป็นแนวตั้ง สำหรับ TikTok/Reels/Shorts |
| `16:9` | center-crop/pad เป็นแนวนอน |
| `original` | ตาม aspect ต้นฉบับ ไม่แปลง |

Aspect เลือกได้ต่อการ export แต่ละครั้ง (ไม่ใช่ global setting) — clip เดียว export ได้หลาย aspect

## Transcription — Pluggable Provider

Interface เดียว สอง implementation เลือกผ่าน settings:

| Provider | Cost | หมายเหตุ |
|----------|------|----------|
| `whisper-cpp` (default) | ฟรี | **whisper.cpp** — binary เดียว ไม่ลาก Python; เลือกขนาด model ได้ (แนะนำ `large-v3` หรือ `medium` สำหรับไทย); ไม่มีลิมิตขนาดไฟล์; ครั้งแรกมี flow ช่วยดาวน์โหลด model |
| `openai` | ~$0.006/นาที | ใส่ `OPENAI_API_KEY` เอง; ต้อง chunk ถ้าเกิน 25 MB |

Output ร่วม: `TranscriptSegment[]` (`{ start, end, text }`) — เก็บลง SQLite ทั้งชุดต่อ video

## Feature หลักฝั่ง UI

### 1. Upload + Processing
- อัปโหลดทีละไฟล์ (mp4/mov/mkv) ตรงเข้า Elysia พร้อม progress
- ตั้งค่า: language, max clips, subtitles
- หน้า processing แสดง step ปัจจุบัน + รายการ step แบบ ordered ผ่าน SSE (refresh แล้ว state คืนจาก REST)

### 2. Video Library
- รายการวิดีโอ พร้อม status, duration, clip count
- ลบวิดีโอได้ (ยกเว้นกำลัง process), retry job ที่ fail ได้

### 3. Clip Review + Trim
- Grid แสดง draft clips: thumbnail, score, ช่วงเวลา
- หน้า clip: preview เล่นจากไฟล์ต้นฉบับตามช่วงเวลา, timeline เลื่อน start/end ได้ (แสดง transcript segments ประกอบ)

### 4. Subtitle Editor
- แสดง transcript segments ของ clip เป็นรายการ แก้ข้อความ/เวลาได้
- เก็บแยกจาก transcript ดิบ (re-run ไม่ทับของที่แก้)
- Export burn-in ใช้เวอร์ชันที่แก้แล้ว; ดาวน์โหลด `.srt` แยกได้

### 5. Export
- เลือก aspect (`9:16` default / `16:9` / `original`) + burn subtitles แล้วสั่ง render
- ดาวน์โหลดไฟล์ mp4 ที่ export แล้ว; export ซ้ำด้วยค่าใหม่ได้เสมอ

### 6. Keyword Settings
- จัดการ keyword ต่อภาษา: เพิ่ม/ลบ/แก้คำ, ย้าย tier, ปรับ weight ต่อ tier
- เก็บใน SQLite — seed จากชุด default ของ repo เก่า, มีปุ่ม reset to defaults
- (เผื่ออนาคต) หลาย preset สลับตามหมวดสินค้า — ยังไม่ทำในเฟสแรก

## ไม่ทำ (ตัดสินใจแล้ว)

- Batch upload หลายไฟล์
- Vision/AI re-scoring
- Auth ทุกรูปแบบ
- Deploy บน server/VPS (ออกแบบเผื่อได้ แต่ไม่ใช่เป้าหมาย)

## Data Model (ร่างแรก)

```
videos    id, filename, path, duration, resolution, status, language, createdAt
jobs      id, videoId, status, step, error, startedAt, completedAt
segments  id, videoId, start, end, text            -- transcript ดิบทั้ง video
clips     id, videoId, start, end, score, thumbnailPath,
          userStart, userEnd                        -- ค่าที่ user ปรับ (null = ใช้ค่า detect)
exports   id, clipId, aspect, burnSubtitles, path, createdAt
clip_subtitles  id, clipId, start, end, text        -- copy จาก segments ตอน detect, แก้ได้
keywords  id, language, tier, word, weight          -- seed จาก HOOK_TIERS เดิม
settings  key, value                                -- transcription provider, model size, ฯลฯ
```

## Monorepo Layout (ร่างแรก)

```
apps/server      Elysia — REST API, SSE, job queue, pipeline (ffmpeg/whisper.cpp)
apps/web         Next.js — UI (Tailwind + shadcn/ui ตามแนว PRD เดิม)
packages/core    hook detection, pipeline types, shared contracts
packages/db      Drizzle schema + SQLite client
```
