import type { WhisperModel } from './whisper-options';

export const TRANSCRIPTION_MODES: Record<WhisperModel, { label: string; description: string; size: string }> = {
  'large-v3': { label: 'แบบละเอียด', description: 'เน้นความแม่นยำ ใช้เวลามากกว่า', size: '3.1 GB' },
  medium: { label: 'แบบรวดเร็ว', description: 'ใช้เวลาน้อยลง แต่อาจถอดเสียงคลาดเคลื่อนมากขึ้น', size: '1.5 GB' },
};
export function transcriptionLabel(model?: string | null): string {
  return model && model in TRANSCRIPTION_MODES ? TRANSCRIPTION_MODES[model as WhisperModel].label : 'ตามการตั้งค่า';
}
export const PRIVACY_COPY = 'วิดีโอและคำบรรยายประมวลผลในเครื่องของคุณ การดาวน์โหลดไฟล์ถอดเสียงครั้งแรกต้องใช้อินเทอร์เน็ต';
export const SCORE_HELP = 'คะแนน AI 0–100 จัดอันดับภายในรอบนี้จากการเปิดประเด็น ความเข้าใจเมื่อดูแยก สาระ ความครบ และความตรงตามคำสั่ง ดูหลักฐานประกอบก่อนเลือก คะแนนระบบเดิมใช้คนละเกณฑ์';
