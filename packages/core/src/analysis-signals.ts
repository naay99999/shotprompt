import type { AnalysisInput, Category, Evidence, HighlightWindow } from './analysis-types';
export const PROFILE_SIGNALS: Record<Category, string[]> = {
  sales: ['benefit', 'proof', 'offer', 'cta'], podcast: ['question', 'opinion', 'experience', 'answer'],
  education: ['problem', 'instruction', 'example', 'conclusion'], story: ['setup', 'conflict', 'change', 'resolution'],
};
const signals: Record<string, { th: string[]; en: string[] }> = {
  benefit: { th: ['ช่วยประหยัด', 'ประโยชน์', 'ใช้ง่าย', 'คุ้มค่า'], en: ['benefit', 'saves time', 'easy to use', 'worth it'] },
  proof: { th: ['ทดสอบแล้ว', 'ทดลองให้ดู', 'ผลลัพธ์', 'รับประกัน'], en: ['proven', 'tested', 'demonstration', 'guarantee'] },
  offer: { th: ['ส่งฟรี', 'ลดราคา', 'ราคาพิเศษ', 'ส่วนลด', 'ฟรี', 'ของแถม'], en: ['free shipping', 'discount', 'offer', 'free', 'sale'] },
  cta: { th: ['ซื้อเลย', 'สั่งเลย', 'กดตะกร้า', 'ทักมา', 'จองเลย'], en: ['buy now', 'order now', 'add to cart', 'shop now'] },
  question: { th: ['คุณคิดว่า', 'ทำไม', 'อย่างไร', 'คำถามคือ'], en: ['what do you think', 'why', 'how', 'the question is'] },
  opinion: { th: ['ในมุมผม', 'ในมุมมอง', 'ผมคิดว่า', 'ฉันคิดว่า'], en: ['in my opinion', 'i think', 'my perspective'] },
  experience: { th: ['จากประสบการณ์', 'เคยเจอ', 'เคยทำ', 'ที่ผ่านมา'], en: ['my experience', 'i experienced', 'i learned'] },
  answer: { th: ['คำตอบคือ', 'เพราะว่า', 'เหตุผลคือ'], en: ['the answer is', 'because', 'the reason is'] },
  problem: { th: ['ข้อผิดพลาด', 'ปัญหาคือ', 'ระวัง', 'อย่าทำ'], en: ['common mistake', 'the problem is', 'watch out', 'avoid'] },
  instruction: { th: ['วิธีทำ', 'ขั้นตอน', 'วิธีแก้', 'เริ่มจาก'], en: ['step by step', 'how to', 'first step', 'the solution'] },
  example: { th: ['ยกตัวอย่าง', 'ตัวอย่างเช่น', 'เช่น'], en: ['for example', 'for instance', 'example'] },
  conclusion: { th: ['สรุปคือ', 'สรุปว่า', 'จำไว้ว่า'], en: ['in summary', 'to summarize', 'remember that'] },
  setup: { th: ['ตอนแรก', 'วันหนึ่ง', 'เรื่องมีอยู่ว่า'], en: ['at first', 'one day', 'it all started'] },
  conflict: { th: ['แต่แล้ว', 'ปรากฏว่า', 'ไม่คาดคิด'], en: ['but then', 'unexpectedly', 'suddenly'] },
  change: { th: ['จุดเปลี่ยน', 'จนกระทั่ง', 'ตัดสินใจ'], en: ['turning point', 'until', 'decided'] },
  resolution: { th: ['สุดท้าย', 'บทเรียน', 'ในที่สุด'], en: ['in the end', 'the lesson', 'finally'] },
  urgency: { th: ['ด่วน', 'วันนี้เท่านั้น', 'เหลือน้อย'], en: ['urgent', 'last chance', 'limited time'] },
};
const normal = (text: string) => text.normalize('NFC').toLowerCase();
export function collectSignals(input: AnalysisInput, window: HighlightWindow): Evidence[] {
  if (input.language !== 'th' && input.language !== 'en') return [];
  const language = input.language;
  const phrases = Object.entries(signals).flatMap(([code, words]) => words[language].map(phrase => ({ code, phrase }))).sort((a, b) => b.phrase.length - a.phrase.length);
  const evidence = new Map<string, Evidence>();
  for (const segment of input.segments.filter(s => window.segmentIds.includes(s.id) && s.start >= window.start && s.end <= window.end).sort((a, b) => a.start - b.start)) {
    const text = normal(segment.text);
    const occupied: [number, number][] = [];
    for (const { code, phrase } of phrases) {
      const needle = normal(phrase);
      let at = text.indexOf(needle);
      while (at >= 0) {
        const end = at + needle.length;
        const boundary = language === 'th' || (!/[\p{L}\p{N}_]/u.test(text[at - 1] ?? '') && !/[\p{L}\p{N}_]/u.test(text[end] ?? ''));
        if (boundary && !occupied.some(([a, b]) => at < b && end > a)) {
          // Retain the whole original segment as quotation: normalization never fabricates text or offsets.
          if (!evidence.has(code)) evidence.set(code, { code, segmentId: segment.id, start: segment.start, end: segment.end, text: segment.text });
          occupied.push([at, end]);
        }
        at = text.indexOf(needle, at + 1);
      }
    }
  }
  return [...evidence.values()];
}
export function queryCoverage(query: string, text: string, language: string): number {
  const value = normal(query), source = normal(text);
  if (!value) return 0;
  if (source.includes(value)) return 100;
  const Segmenter = Intl.Segmenter;
  const words = Segmenter ? [...new Segmenter(language, { granularity: 'word' }).segment(value)].filter(w => w.isWordLike).map(w => w.segment) : [value];
  const unique = [...new Set(words)];
  return unique.length ? unique.filter(w => source.includes(w)).length / unique.length * 100 : 0;
}
