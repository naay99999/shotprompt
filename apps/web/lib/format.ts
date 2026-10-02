export const fmtTime = (s: number) => {
  s = Math.max(0, Math.round(s))
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    x = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
}
export const fmtBytes = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' KB'

export type Aspect = '9:16' | '16:9' | 'original'
export const ASPECT_LABEL: Record<Aspect, string> = { '9:16': 'แนวตั้ง (9:16)', '16:9': 'แนวนอน (16:9)', original: 'ตามต้นฉบับ' }
