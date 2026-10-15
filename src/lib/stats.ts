/** 旅程統計（不做匯率換算：每個幣別各自加總） */
import { CATEGORIES, PAYMENTS, type Receipt } from './types'
import { daysBetween, round } from './format'

export interface Row {
  key: string
  label: string
  total: number
  count: number
}

function group(list: Receipt[], keyOf: (r: Receipt) => string, labelOf: (k: string) => string): Row[] {
  const m = new Map<string, Row>()
  for (const r of list) {
    const k = keyOf(r)
    const row = m.get(k) ?? { key: k, label: labelOf(k), total: 0, count: 0 }
    row.total = round(row.total + r.amount)
    row.count += 1
    m.set(k, row)
  }
  return [...m.values()]
}

export function currenciesOf(list: Receipt[]): { currency: string; total: number; count: number }[] {
  return group(list, (r) => r.currency, (k) => k)
    .map((r) => ({ currency: r.key, total: r.total, count: r.count }))
    .sort((a, b) => b.count - a.count)
}

export function byCategory(list: Receipt[]): Row[] {
  const rows = group(list, (r) => r.category, (k) => CATEGORIES.find((c) => c.id === k)?.label ?? k)
  return CATEGORIES.map((c) => rows.find((r) => r.key === c.id)).filter((r): r is Row => !!r)
}

export function byPayment(list: Receipt[]): Row[] {
  const rows = group(list, (r) => r.payment_method, (k) => PAYMENTS.find((p) => p.id === k)?.label ?? k)
  return PAYMENTS.map((p) => rows.find((r) => r.key === p.id)).filter((r): r is Row => !!r)
}

export function byStore(list: Receipt[], limit = 10): Row[] {
  return group(
    list,
    (r) => (r.store_name_translated || r.store_name_original || '（未填店名）').trim(),
    (k) => k,
  )
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

/** 每日花費；有旅程期間時，沒有消費的日子也列出（金額 0） */
export function byDay(list: Receipt[], start: string | null, end: string | null): Row[] {
  const rows = group(list, (r) => r.receipt_date, (k) => k)
  const dates = new Set(rows.map((r) => r.key))
  if (start && end && daysBetween(start, end) <= 60) {
    const d = new Date(start + 'T00:00:00')
    const last = new Date(end + 'T00:00:00')
    while (d <= last) {
      dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
      d.setDate(d.getDate() + 1)
    }
  }
  return [...dates].sort().map((k) => rows.find((r) => r.key === k) ?? { key: k, label: k, total: 0, count: 0 })
}

/** 依成員：新增的張數與金額、付款的金額 */
export function byMember(list: Receipt[], nameOf: (id: string | null) => string) {
  const created = group(list, (r) => r.created_by ?? '', (k) => nameOf(k || null))
  const paid = group(
    list.filter((r) => r.paid_by),
    (r) => r.paid_by!,
    (k) => nameOf(k),
  )
  return { created: created.sort((a, b) => b.count - a.count), paid: paid.sort((a, b) => b.total - a.total) }
}

/** 旅遊天數：優先用旅程期間，否則用第一張到最後一張發票的日期 */
export function tripDays(list: Receipt[], start: string | null, end: string | null): number {
  if (start && end) return daysBetween(start, end)
  if (!list.length) return 0
  const dates = list.map((r) => r.receipt_date).sort()
  return daysBetween(start ?? dates[0], end ?? dates[dates.length - 1])
}
