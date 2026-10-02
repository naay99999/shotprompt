export type UiError = { message: string; details: string };

export function describeError(error: unknown, fallback = 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง'): UiError {
  const source = error && typeof error === 'object' ? error as { status?: number; value?: unknown; message?: string } : {};
  const value = source.value && typeof source.value === 'object' ? source.value as { message?: string; error?: string } : null;
  const details = value?.message ?? value?.error ?? source.message ?? (typeof error === 'string' ? error : typeof source.value === 'string' ? source.value : '');
  let message = fallback;
  if (/invalid analysis options/.test(details)) message = 'ตรวจความยาว 5–180 วินาที จำนวนคลิป 1–30 และคำสั่งไม่เกิน 500 ตัวอักษร';
  else if (/provider-not-configured/.test(details)) message = 'ตั้งค่า endpoint และชื่อโมเดล AI ในหน้าตั้งค่าก่อนวิเคราะห์';
  else if (/invalid provider configuration/.test(details)) message = 'ตรวจ API URL ชื่อโมเดล และเวลารอ หากใช้บริการภายนอกให้เปิดใช้การส่งข้อมูลก่อน';
  else if (/provider-credentials/.test(details)) message = 'endpoint ปฏิเสธ API key กรุณาตรวจการตั้งค่าฝั่งเซิร์ฟเวอร์';
  else if (/credential-vault-unavailable/.test(details)) message = 'ไม่พบกุญแจเข้ารหัส API key โปรดกู้คืนไฟล์ vault จากสำรองก่อนใช้โปรไฟล์นี้';
  else if (/provider-credits/.test(details)) message = 'เครดิตหรือยอดเงินของผู้ให้บริการไม่เพียงพอ ตรวจสอบบัญชีและวงเงิน API';
  else if (/profile-in-use/.test(details)) message = 'มีงานวิเคราะห์กำลังใช้โปรไฟล์นี้ รอให้งานเสร็จก่อนเปลี่ยน key หรือปลายทาง';
  else if (/profile-revision-conflict|profile-stale-check/.test(details)) message = 'โปรไฟล์ถูกแก้ไขระหว่างดำเนินการ โหลดข้อมูลล่าสุดแล้วตรวจอีกครั้ง';
  else if (/profile-not-ready/.test(details)) message = 'โปรไฟล์นี้ยังไม่ผ่านการทดสอบการเชื่อมต่อ กรุณาบันทึกและทดสอบก่อนเปิดใช้';
  else if (/invalid-provider-profile/.test(details)) message = 'ตรวจชื่อโปรไฟล์ URL ชื่อโมเดล API key และการอนุญาตส่งข้อมูลไปยังบริการภายนอก';
  else if (/provider-catalog/.test(details)) message = 'โหลดรายการโมเดลไม่ได้ คุณยังพิมพ์ชื่อโมเดลเองแล้วบันทึกได้';
  else if (/provider-timeout|run-timeout/.test(details)) message = 'AI ใช้เวลาเกินที่กำหนด ลองเพิ่มเวลารอหรือเลือกโมเดลที่เร็วขึ้น';
  else if (/provider-rate-limit/.test(details)) message = 'ผู้ให้บริการจำกัดจำนวนคำขอ กรุณารอสักครู่แล้วลองใหม่';
  else if (/context-too-large|input-too-large|proposal-budget-exceeded|request-budget-exceeded/.test(details)) message = 'ข้อมูลเกินขีดจำกัดการวิเคราะห์ ลองใช้วิดีโอที่สั้นลงหรือโมเดลที่รองรับบริบทมากขึ้น';
  else if (/unsupported-output-mode/.test(details)) message = 'endpoint ไม่รองรับรูปแบบผลลัพธ์นี้ ลองเลือก JSON ในหน้าตั้งค่าแล้วทดสอบ';
  else if (/invalid-output/.test(details)) message = 'ผล AI ไม่ผ่านการตรวจรูปแบบหรือหลักฐาน ลองใหม่หรือเปลี่ยนโมเดล';
  else if (/provider-unavailable|model-unavailable/.test(details)) message = 'เชื่อมต่อโมเดลไม่ได้ ตรวจว่า endpoint ทำงานและชื่อโมเดลถูกต้อง';
  else if (/unsupported-language|insufficient-transcript/.test(details)) message = 'โมเดลไม่สามารถประเมินบทถอดเสียงนี้ได้ ตรวจข้อความหรือเปลี่ยนโมเดล';
  else if (/source changed/.test(details)) message = 'บทถอดเสียงเปลี่ยนระหว่างประเมิน กรุณาประเมินใหม่';
  else if (/Subtitle identities changed/i.test(details)) message = 'คำบรรยายถูกเปลี่ยนระหว่างบันทึก กรุณาคัดลอกข้อความที่แก้ไว้ แล้วปิดและเปิดคลิปใหม่';
  else if (/system not ready/i.test(details)) message = 'เครื่องยังไม่พร้อม กรุณาทำตามขั้นตอนในหน้าเตรียมเครื่องก่อนเริ่มงาน';
  else if (/model not downloaded/i.test(details)) message = 'กรุณาดาวน์โหลดไฟล์ถอดเสียงในหน้าตั้งค่าก่อนเริ่มงาน';
  else if (/file not found/i.test(details)) message = 'ไม่พบไฟล์นี้ ตรวจสอบตำแหน่งไฟล์แล้วลองอีกครั้ง';
  else if (/unsupported (model|language)/i.test(details)) message = 'ตัวเลือกนี้ยังไม่รองรับ กรุณาเลือกจากรายการที่พร้อมใช้งาน';
  else if (/canceled|cancelled/i.test(details)) message = 'ยกเลิกงานแล้ว คุณสามารถเริ่มงานใหม่ได้';
  else if (source.status === 409) message = 'มีงานกำลังดำเนินการอยู่ กรุณารอให้เสร็จแล้วลองอีกครั้ง';
  else if (source.status === 404) message = 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว กรุณาโหลดรายการอีกครั้ง';
  else if (/fetch|network|connection|เชื่อมต่อ/i.test(details) || source.status === 0) message = 'เชื่อมต่อระบบในเครื่องไม่ได้ ตรวจสอบว่า ShotPrompt กำลังทำงาน แล้วลองอีกครั้ง';
  return { message, details };
}

export function checkResponse<T extends { error: unknown }>(response: T): T {
  if (response.error) throw response.error;
  return response;
}
