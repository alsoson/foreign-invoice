/** 金額與日期格式 */

const digitsCache = new Map<string, number>()

/** 幣別的小數位數（JPY、KRW 為 0，USD 為 2…） */
export function currencyDigits(currency: string): number {
  if (!digitsCache.has(currency)) {
    let d = 2
    try {
      d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
    } catch {
      /* 不認得的幣別用 2 位 */
    }
    digitsCache.set(currency, d)
  }
  return digitsCache.get(currency)!
}

/** 1280 → "1,280"；依幣別決定小數位數 */
export function formatNumber(n: number, currency?: string): string {
  const d = currency ? currencyDigits(currency) : 2
  return new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: d }).format(n)
}

/** 1280, "JPY" → "JPY 1,280" */
export function formatMoney(n: number, currency: string): string {
  return `${currency} ${formatNumber(n, currency)}`
}

/** 2026-11-20 → 11/20（週五） */
export function formatDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const w = '日一二三四五六'[d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}（${w}）`
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return '未設定日期'
  if (start && end && start === end) return start
  return `${start ?? ''} – ${end ?? ''}`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 兩個日期之間的天數（含頭尾） */
export function daysBetween(start: string, end: string): number {
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

/** 今天的日期（使用者當地時間），格式 YYYY-MM-DD */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 把字串轉成數字；空字串或無效回傳 null */
export function toNum(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const t = s.replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** 浮點數加總時的誤差修正 */
export function round(n: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
