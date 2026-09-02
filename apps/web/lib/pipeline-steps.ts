// Mirrors apps/server/src/pipeline.ts PIPELINE_STEPS — keep names in sync with the server.
export const PIPELINE_STEP_META = [
  { name: 'normalize', label: 'แปลงไฟล์วิดีโอ', desc: 'แปลงเป็น H.264 mp4 มาตรฐาน · ปรับ frame rate' },
  { name: 'extract-audio', label: 'แยกเสียง', desc: 'แยกไฟล์เสียง wav 16kHz mono' },
  { name: 'transcribe', label: 'ถอดเสียง', desc: 'whisper.cpp · ดูตัวเลือกความเร็วได้ใน Settings' },
  { name: 'detect-scenes', label: 'ตรวจจับฉาก', desc: 'scene detection · threshold 0.3' },
  { name: 'detect-hooks', label: 'ค้นหา hook', desc: 'หาช่วงเด่นจากคำสำคัญและจังหวะการเปลี่ยนฉาก' },
  { name: 'thumbnails', label: 'สร้างภาพตัวอย่าง', desc: 'สร้างภาพตัวอย่างสำหรับผู้สมัคร (candidates)' },
] as const
