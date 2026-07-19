# ShotPrompt MVP — Design Spec

> วันที่: 2026-07-19 · สถานะ: รอ review
> แทนที่รายละเอียดใน `docs/feature-spec.md` ในจุดที่ขัดกัน (spec นี้ใหม่กว่า)

**ShotPrompt** เป็น personal tool ใช้เอง แจกฟรี (ไม่ใช่ SaaS) — ingest วิดีโอ live commerce ไทย/อังกฤษ, transcribe, หา hook moment ด้วย keyword scoring เสนอเป็น **candidates ให้ผู้ใช้เลือก** แล้วตัดเป็น clip สั้นพร้อม subtitle สำหรับ TikTok/Reels/Shorts

Source อ้างอิงตอน port: `~/workspace/naay/shotprompt-old` (algorithm, keyword seed, docs)

## หลักการ (ตัดสินใจแล้ว ไม่ relitigate)

- รันเครื่องเดียวจบ ไม่มี docker ไม่มี cloud dependency
- Default ฟรี 100% — MVP ไม่มีทางเลือกเสียเงินเลย (OpenAI provider เป็นงานหลัง MVP)
- ไม่มี auth ทุกรูปแบบ (ไม่ทำแม้หลัง MVP ตราบใดที่ยังเป็น localhost)
- SQLite ตลอดไป ไม่ใช่แค่ MVP — single user, write volume ต่ำ ไม่มีเหตุให้หนี
- Redis/BullMQ ไม่มี — "รากฐานแข็งแรง" คือ job state persist ลง SQLite + queue interface สะอาด ไม่ใช่ distributed queue

## Stack & Monorepo

Bun workspace:

```
apps/server      Elysia — REST API, SSE, job queue, pipeline (ffmpeg/whisper.cpp)
apps/web         Next.js — UI (Tailwind + shadcn/ui)
packages/core    hook detection, scoring, SRT/ASS generation, ffmpeg args builder, shared types
packages/db      Drizzle schema + bun:sqlite client
```

- Web เรียก server ผ่าน **Eden Treaty** (`@elysiajs/eden`) — type-safe จาก type ของ Elysia app ตรง ๆ
- `bun dev` รันทั้ง server (port 3001) และ web (port 3000)

## Prerequisites & Doctor

- **ffmpeg + whisper.cpp เป็น prerequisite** — ผู้ใช้ติดตั้งเองผ่าน `brew install ffmpeg whisper-cpp` เราไม่ bundle/ไม่ auto-download binary
- `GET /system/doctor` เช็ค: เจอ `ffmpeg`/`ffprobe`/`whisper-cli` ใน PATH ไหม, whisper model ที่เลือกดาวน์โหลดแล้วยัง, **acceleration status** (brew whisper-cpp บน Apple Silicon build มาพร้อม Metal อยู่แล้ว — doctor แสดงว่า GPU ใช้งานได้ไหมจาก output ของ `whisper-cli` เพื่อให้รู้ว่าไม่ได้รันช้าโดยไม่จำเป็น; CUDA อยู่นอก scope)
- UI: doctor ไม่ผ่าน → หน้า setup แสดงคำสั่งติดตั้ง + ปุ่มสั่งดาวน์โหลด model (server ดาวน์โหลดให้, progress ผ่าน SSE)
- Model default: `large-v3` (แม่นสุดสำหรับไทย), เปลี่ยนได้ในหน้า settings — UI ระบุ trade-off ชัด: `medium` เร็วกว่า ~2-3 เท่า แลกความแม่นลงเล็กน้อย เหมาะกับวิดีโอ live ยาวหลายชั่วโมง

## Storage บน filesystem

`data/` ที่ repo root (gitignored):

```
data/
  shotprompt.db          -- SQLite
  models/                -- ggml-large-v3.bin ฯลฯ
  videos/<videoId>/
    source.mp4           -- ไฟล์ normalize แล้ว ใช้ทั้ง preview + export
    audio.wav            -- 16kHz mono สำหรับ whisper (ลบทิ้งเมื่อ pipeline จบ — ดูด้านล่าง)
    thumbs/<candidateId|clipId>.jpg
    exports/<exportId>.mp4
```

### วินัยเรื่องพื้นที่ดิสก์

- **ไฟล์ upload ดิบ** ลบทันทีหลัง `normalize` สำเร็จ
- **`audio.wav`** ลบทันทีที่ pipeline จบสมบูรณ์ — step หลัง transcribe ไม่ใช้แล้ว ถ้าอนาคตต้อง re-transcribe ค่อย extract ใหม่ (เร็วมากเทียบกับ transcribe)
- **Atomic write ทุก step:** ไฟล์ output ทุกตัว (source.mp4, exports, thumbnails) เขียนลงชื่อ `.tmp` ก่อนแล้ว rename เมื่อสำเร็จ → ตอน server start กวาดลบ `*.tmp` ใน `data/` ทั้งหมดได้อย่างปลอดภัย ไม่มีไฟล์ครึ่ง ๆ กลาง ๆ ค้างจาก crash
- **ลบ export รายตัวได้** (`DELETE /exports/:id`) และหน้า settings แสดง disk usage ของ `data/` แยกราย video + ปุ่มลบ video (ซึ่งลบไฟล์ทั้ง folder)

## Pipeline

รับ upload (mp4/mov/mkv) + ตัวเลือกเดียว: **language** (`th`/`en`) แล้วเข้าคิว:

1. **`normalize`** — ffprobe อ่าน metadata; codec เป็น h264/aac แล้ว → remux เป็น mp4 (เร็ว ไม่ re-encode), ไม่ใช่ (HEVC/mkv) → transcode ได้ `source.mp4` ที่ browser เล่นได้เสมอ **ไฟล์ upload ดิบลบทิ้งหลัง normalize สำเร็จ**
2. **`extract-audio`** — ffmpeg → `audio.wav` 16kHz mono
3. **`transcribe`** — ผ่าน interface `TranscriptProvider` (MVP มี implementation เดียว: whisper-cpp) → เขียน `segments` ลง DB ทั้งชุด
4. **`detect-scenes`** — scene-change timestamps → เขียน `scenes` ลง DB (persist เพื่อ resume)
5. **`detect-hooks`** — 4-phase algorithm port จาก repo เก่า **ทั้งชุด constants เดิม**: `SILENCE_GAP=3`, `SCORE_THRESHOLD=40`, `MAX_CLIP_DURATION=90`, `MERGE_GAP=15`, `WINDOW_PAD=5`, `BREATH_PAD=1.5`, `SCENE_BASE_SCORE=35`, `SCENE_MIN_INTERVAL=15`, `SCENE_WINDOW=30` → เขียน **candidates ทั้งหมด**ที่ผ่าน threshold (ไม่ cap จำนวน, ไม่ auto สร้าง clip)
6. **`thumbnails`** — frame กลางช่วง candidate ละ 1 รูป

Keyword scoring อ่านจากตาราง `keywords` (seed จาก `HOOK_TIERS` ของ repo เก่า: tier 1 urgency +25, tier 2 promotion +15, tier 3 CTA +8 ทั้งไทย/อังกฤษ) — MVP ยังไม่มี UI จัดการ แก้ตรง DB ได้

## Candidates vs Clips (หัวใจของ flow)

```
pipeline → candidates (read-only, เรียงตาม score)
         → user เลือก candidate หรือลากช่วงเวลาเอง → เกิด clip
         → trim / crop offset / แก้ subtitle → export
```

- **`candidates`** เป็นผลของ algorithm ล้วน ๆ — re-run detection เขียนทับได้อย่างเดียว ไม่มี user data ปน
- **`clips`** เกิดจาก user เท่านั้น (จาก candidate หรือสร้างเองจากช่วงเวลาใดก็ได้) — ไม่มีวันโดน re-run ทับ
- ตอนสร้าง clip: copy `segments` ที่ overlap ช่วงเวลาเข้า `clip_subtitles` + gen thumbnail
- `maxClips` จาก spec เดิม **ตัดทิ้ง** — ไม่มี auto สร้าง clip

## Job Queue & Resume

- In-process queue 2 ตัว: `pipeline` (concurrency 1 — whisper กิน CPU เต็มเครื่อง) และ `export` (concurrency 1) — แยกกันเพื่อให้ export ไม่ต้องรอ pipeline job ยาว ๆ
- Job state persist ลง SQLite: `jobs` (1 run/แถว) + `job_steps` (สถานะราย step) — ตารางเดียวกับที่ UI ใช้แสดง ordered step list
- ทุก step เขียน output ลง DB/ไฟล์ทันทีที่จบ
- Server start: job ค้าง `running` → mark `failed` + กวาดลบไฟล์ `*.tmp` ทั้งหมด (ดู "วินัยเรื่องพื้นที่ดิสก์")
- **Retry = job ใหม่ที่ข้าม step ที่ done แล้ว** (เช็คจาก `job_steps` ของ job ก่อนหน้า + artifact มีจริง) — crash หลัง transcribe ไม่ต้อง transcribe ซ้ำ
- Queue interface สะอาด (enqueue/on-progress) — อนาคตเปลี่ยน backend ได้โดยไม่แตะ caller

## SSE

Endpoint เดียว `GET /events` stream ทุก event: job step change, export status, model download progress — UI refresh แล้ว state คืนจาก REST ได้เสมอ (SSE เป็นแค่ตัวกระตุ้น refetch/อัปเดตสด ไม่ใช่ source of truth)

Pipeline รันเป็นชั่วโมง connection หลุดได้แน่นอน — กติกาฝั่ง web:

- ใช้ `EventSource` (auto-reconnect ในตัว) + server ส่ง heartbeat comment ทุก ~15s กัน proxy/idle timeout
- **ทุกครั้งที่ reconnect สำเร็จ ให้ refetch state จาก REST ทันที** — event ที่หลุดหายระหว่างขาดจึงไม่มีผล เพราะ event ไม่ใช่ source of truth

## Data Model

```
videos          id, filename, path, duration, width, height, status, language, createdAt
                -- status: uploaded | processing | ready | failed
jobs            id, videoId, type(pipeline|export), status, error, createdAt, startedAt, completedAt
job_steps       id, jobId, name, status, error, startedAt, completedAt
segments        id, videoId, start, end, text       -- transcript ดิบ (วินาที ทศนิยม)
scenes          id, videoId, time
candidates      id, videoId, start, end, score, thumbnailPath
clips           id, videoId, candidateId?, start, end, score?, cropOffset, thumbnailPath, createdAt
                -- cropOffset: -1..1 (0 = center) ใช้ตอน crop 9:16/16:9
clip_subtitles  id, clipId, start, end, text        -- เวลา absolute อิงวิดีโอต้นฉบับ; shift เป็น relative ตอน export
exports         id, clipId, aspect, burnSubtitles, status, path, error, createdAt
keywords        id, language, tier, word, weight    -- seed จาก HOOK_TIERS เก่า
settings        key, value                          -- whisper model size ฯลฯ
```

## API

| Method + Path | หน้าที่ |
|---|---|
| `POST /videos` | multipart upload + language → เข้าคิว pipeline |
| `GET /videos` · `GET /videos/:id` | library / รายละเอียด (รวม job + steps ปัจจุบัน) |
| `DELETE /videos/:id` | ลบวิดีโอ+ไฟล์ทั้งหมด (ปฏิเสธถ้ากำลัง process) |
| `POST /videos/:id/retry` | job ใหม่ ข้าม step ที่ done |
| `GET /videos/:id/stream` | serve `source.mp4` แบบ HTTP Range (ให้ `<video>` seek ได้) |
| `GET /videos/:id/candidates` | candidates เรียงตาม score |
| `GET /videos/:id/clips` · `POST /videos/:id/clips` | รายการ clip / สร้างจาก `{candidateId}` หรือ `{start, end}` |
| `PATCH /clips/:id` · `DELETE /clips/:id` | ปรับ start/end/cropOffset / ลบ |
| `GET /clips/:id/subtitles` · `PUT /clips/:id/subtitles` | subtitle editor (replace ทั้งชุด) |
| `GET /clips/:id/srt` | ดาวน์โหลด .srt (เวลา relative กับ clip) |
| `POST /exports` | `{clipIds[], aspect, burnSubtitles}` — batch ในตัว (1 export row/clip เข้าคิว export) |
| `GET /exports/:id/download` | ไฟล์ mp4 |
| `DELETE /exports/:id` | ลบไฟล์ export ที่ไม่ใช้แล้ว (คืนพื้นที่ดิสก์) |
| `GET /system/disk-usage` | ขนาด `data/` รวม + แยกราย video (แสดงในหน้า settings) |
| `GET /system/doctor` | เช็ค binaries + model |
| `POST /system/model/download` | สั่งดาวน์โหลด whisper model |
| `GET /settings` · `PUT /settings` | ค่า config (model size ฯลฯ) |
| `GET /events` | SSE |

## Export Render

ต่อ 1 export: ffmpeg รวดเดียว —

1. Cut ตามช่วงของ clip (`-ss`/`-to` แบบ re-encode ให้ frame ตรง)
2. Crop ตาม aspect ที่เลือกต่อครั้ง: `9:16` (default, center-crop + `cropOffset` เลื่อนซ้าย-ขวา) / `16:9` / `original` (ไม่แปลง)
3. Burn subtitle (ถ้าเปิด) จาก `clip_subtitles` เวอร์ชันที่แก้แล้ว — **ASS style default พร้อมลง TikTok**: ฟอนต์หนา (Noto Sans Thai — render ไทยถูกต้อง), ขอบดำ, ขนาดใหญ่, วางล่าง-กลางเว้นระยะจาก UI TikTok
4. **`loudnorm` เสมอ** — เสียง live ดัง-เบาไม่สม่ำเสมอ normalize ให้ได้มาตรฐานแพลตฟอร์ม

Export ซ้ำด้วยค่าใหม่ได้ไม่จำกัด (source.mp4 อยู่เสมอ) — clip เดียว export ได้หลาย aspect

## UI (Next.js, 3 หน้า)

1. **`/` Library** — upload ทีละไฟล์พร้อม progress + รายการวิดีโอ (status, duration, clip count) + retry/delete
2. **`/videos/:id` Workspace** — หน้าเดียวจบ:
   - กำลัง process → ordered step list อัปเดตสดผ่าน SSE
   - เสร็จแล้ว → ซ้าย: player + timeline แสดงแถบ candidate (สีตาม score) + สร้าง clip จากช่วงที่ลากเอง / ขวา: candidates เรียง score กดเพื่อรับเป็น clip / ล่าง: clips ที่เลือกแล้ว
   - เลือก clip → panel: trim (ลาก start/end, เห็น transcript segments ประกอบ), crop offset slider พร้อมกรอบ 9:16 ทาบบน preview, subtitle editor (แก้ text/เวลา รายการต่อ segment), export
   - Export bar: เลือกหลาย clip + aspect + burn sub → สั่งรวดเดียว, สถานะผ่าน SSE, ปุ่มดาวน์โหลดเมื่อเสร็จ
   - Preview เล่นจาก `/videos/:id/stream` โดย JS บังคับช่วง start/end — ไม่ render ก่อน preview
3. **`/settings`** — doctor status (รวม acceleration), ดาวน์โหลด/เลือกขนาด model (บอก trade-off เร็ว-แม่น), disk usage ราย video + ลบ export/video เพื่อคืนพื้นที่

## Testing

- **`packages/core` เข้ม** — hook detection ต้องมี **parity test**: fixture ชุดเดียวกับ test ของ repo เก่า ผลต้องตรงกันทุกค่า; keyword scoring; SRT/ASS generation; ffmpeg args builder
- **API integration** — เส้นหลัก: upload → (mock pipeline) → candidates → clip → export; retry ข้าม step; SSE event
- UI ไม่เขียน test

## หลัง MVP (เรียงตามลำดับความน่าทำ)

1. OpenAI transcription provider (เพิ่มเป็น implementation ที่สองของ `TranscriptProvider` + chunk >25 MB)
2. Keyword Settings UI (CRUD + reset to defaults — ตาราง `keywords` รองรับอยู่แล้ว)
3. Auto remove dead air ในคลิป (jump-cut ช่วงเงียบ — มี segment timing ครบแล้ว)
4. Karaoke subtitle รายคำ (word-level timestamps จาก whisper + ASS)
5. Text overlay หัวคลิป / UI ปรับ subtitle style
6. Keyword preset หลายชุดตามหมวดสินค้า

## ตัดทิ้งถาวร

Watermark/logo, speed ramp, transition/effect, เพลงประกอบ — แอปตัดต่อมือถือทำดีกว่า ไม่ใช่จุดขายของ tool นี้
Batch upload หลายไฟล์, vision/AI re-scoring, auth, deploy บน VPS — ตามเดิม
