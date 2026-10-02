// Names match server pipeline events; labels describe the user's task.
export const PIPELINE_STEP_META = [
  { name: 'normalize', label: 'เตรียมวิดีโอ', desc: 'เตรียมไฟล์ให้พร้อมสำหรับการดูตัวอย่างและตัดคลิป' },
  { name: 'extract-audio', label: 'เตรียมเสียง', desc: 'เตรียมเสียงพูดสำหรับสร้างข้อความ' },
  { name: 'transcribe', label: 'ถอดเสียงเป็นข้อความ', desc: 'ขั้นตอนนี้อาจใช้เวลาตามความยาววิดีโอและรูปแบบที่เลือก' },
  { name: 'detect-scenes', label: 'หาจุดเปลี่ยนฉาก', desc: 'ค้นหาจังหวะเปลี่ยนภาพที่เหมาะกับการเริ่มคลิป' },
  { name: 'detect-hooks', label: 'เตรียมการวิเคราะห์', desc: 'AI จะคัดช่วงในงานแยกหลังวิดีโอพร้อม' },
  { name: 'thumbnails', label: 'พร้อมสำหรับเลือกคลิป', desc: 'งาน AI จะสร้างภาพตัวอย่างพร้อมผลวิเคราะห์' },
] as const
