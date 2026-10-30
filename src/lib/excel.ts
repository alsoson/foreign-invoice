/** 匯出 Excel（以旅程為單位）。用到時才載入 write-excel-file，不影響首頁載入速度。 */
import type { Cell, Row as XRow, Sheet } from 'write-excel-file/browser'
import { listItems, listMembers, listReceiptsForTrips } from './api'
import { byCategory, byDay, currenciesOf, tripDays } from './stats'
import { CATEGORY_MAP, PAYMENT_LABEL, PROVIDER_LABEL, type Member, type Receipt, type ReceiptItem, type Trip } from './types'
import { formatDateRange } from './format'

type Mode = 'separate' | 'merged'

const H = (v: string): Cell => ({ value: v, fontWeight: 'bold', backgroundColor: '#E6F4F1' })
const N = (v: number | null | undefined): Cell => (v === null || v === undefined ? null : { value: v, type: Number })
const S = (v: string | null | undefined): Cell => (v ? { value: v, type: String } : null)

/** Excel 工作表名稱最多 31 字，且不能有 \ / ? * [ ] : */
function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = 2
  let out = base
  while (used.has(out)) {
    const suffix = `(${n++})`
    out = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(out)
  return out
}

/** 檔名不能有的字元 */
function safeFile(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || '旅程'
}

interface TripData {
  trip: Trip
  receipts: Receipt[]
  items: ReceiptItem[]
  members: Member[]
}

function overviewRows(list: TripData[]): XRow[] {
  const rows: XRow[] = [[H('旅程'), H('國家'), H('期間'), H('天數'), H('發票張數'), H('幣別'), H('總金額'), H('預算（預設幣別）')]]
  for (const t of list) {
    const curs = currenciesOf(t.receipts)
    const days = tripDays(t.receipts, t.trip.start_date, t.trip.end_date)
    const base = [S(t.trip.name), S(t.trip.country), S(formatDateRange(t.trip.start_date, t.trip.end_date)), N(days || null), N(t.receipts.length)]
    if (!curs.length) rows.push([...base, null, null, N(t.trip.budget)])
    curs.forEach((c, i) => rows.push([...(i === 0 ? base : [null, null, null, null, null]), S(c.currency), N(c.total), i === 0 ? N(t.trip.budget) : null]))
  }
  return rows
}

function receiptRows(list: TripData[], withTrip: boolean): XRow[] {
  const head = ['日期', '店名（原文）', '店名（中文）', '類別', '幣別', '金額', '付款方式', '付款人', '新增者', '辨識方式', '備註']
  const rows: XRow[] = [(withTrip ? ['旅程', ...head] : head).map(H)]
  for (const t of list) {
    const name = (id: string | null) => (id ? (t.members.find((m) => m.user_id === id)?.display_name ?? '') : '')
    for (const r of t.receipts) {
      const row: Cell[] = [
        S(r.receipt_date),
        S(r.store_name_original),
        S(r.store_name_translated),
        S(CATEGORY_MAP[r.category]?.label ?? r.category),
        S(r.currency),
        N(r.amount),
        S(PAYMENT_LABEL[r.payment_method] ?? r.payment_method),
        S(name(r.paid_by)),
        S(name(r.created_by)),
        S(r.ai_provider === 'manual' || !r.ai_provider ? '手動輸入' : (PROVIDER_LABEL[r.ai_provider] ?? r.ai_provider)),
        S(r.note),
      ]
      rows.push(withTrip ? [S(t.trip.name), ...row] : row)
    }
  }
  return rows
}

function itemRows(list: TripData[], withTrip: boolean): XRow[] {
  const head = ['日期', '店名', '品名（原文）', '品名（中文）', '數量', '單價', '小計', '幣別']
  const rows: XRow[] = [(withTrip ? ['旅程', ...head] : head).map(H)]
  for (const t of list) {
    const byId = new Map(t.receipts.map((r) => [r.id, r]))
    for (const r of t.receipts)
      for (const i of t.items.filter((x) => x.receipt_id === r.id)) {
        const rec = byId.get(i.receipt_id!)!
        const row: Cell[] = [
          S(rec.receipt_date),
          S(rec.store_name_translated || rec.store_name_original),
          S(i.name_original),
          S(i.name_translated),
          N(i.quantity),
          N(i.unit_price),
          N(i.subtotal),
          S(rec.currency),
        ]
        rows.push(withTrip ? [S(t.trip.name), ...row] : row)
      }
  }
  return rows
}

function categoryRows(list: TripData[], withTrip: boolean): XRow[] {
  const rows: XRow[] = [(withTrip ? ['旅程', '幣別', '類別', '張數', '金額', '比例'] : ['幣別', '類別', '張數', '金額', '比例']).map(H)]
  for (const t of list)
    for (const c of currenciesOf(t.receipts)) {
      const sub = t.receipts.filter((r) => r.currency === c.currency)
      for (const row of byCategory(sub)) {
        const cells: Cell[] = [S(c.currency), S(row.label), N(row.count), N(row.total), { value: c.total ? row.total / c.total : 0, type: Number, format: '0.0%' }]
        rows.push(withTrip ? [S(t.trip.name), ...cells] : cells)
      }
    }
  return rows
}

function dailyRows(list: TripData[], withTrip: boolean): XRow[] {
  const rows: XRow[] = [(withTrip ? ['旅程', '日期', '幣別', '張數', '金額'] : ['日期', '幣別', '張數', '金額']).map(H)]
  for (const t of list)
    for (const c of currenciesOf(t.receipts)) {
      const sub = t.receipts.filter((r) => r.currency === c.currency)
      for (const d of byDay(sub, null, null)) {
        const cells: Cell[] = [S(d.key), S(c.currency), N(d.count), N(d.total)]
        rows.push(withTrip ? [S(t.trip.name), ...cells] : cells)
      }
    }
  return rows
}

const widths = (...w: number[]) => w.map((width) => ({ width }))

/** 組出工作表（可單獨測試，不需要瀏覽器） */
export function buildSheets(data: TripData[], mode: Mode): Sheet<Blob>[] {
  const used = new Set<string>()
  const make = (list: TripData[], prefix: string, withTrip: boolean): Sheet<Blob>[] => {
    const tw = withTrip ? [16] : []
    return [
      { sheet: sheetName(prefix + '總覽', used), data: overviewRows(list), columns: widths(20, 10, 24, 6, 9, 7, 14, 16), stickyRowsCount: 1 },
      { sheet: sheetName(prefix + '發票明細', used), data: receiptRows(list, withTrip), columns: widths(...tw, 11, 22, 22, 7, 7, 12, 9, 10, 10, 12, 24), stickyRowsCount: 1 },
      { sheet: sheetName(prefix + '品項明細', used), data: itemRows(list, withTrip), columns: widths(...tw, 11, 20, 22, 22, 6, 10, 10, 7), stickyRowsCount: 1 },
      { sheet: sheetName(prefix + '類別統計', used), data: categoryRows(list, withTrip), columns: widths(...tw, 7, 8, 6, 12, 8), stickyRowsCount: 1 },
      { sheet: sheetName(prefix + '每日統計', used), data: dailyRows(list, withTrip), columns: widths(...tw, 11, 7, 6, 12), stickyRowsCount: 1 },
    ]
  }
  if (mode === 'merged' || data.length === 1) return make(data, '', mode === 'merged' && data.length > 1)
  return data.flatMap((d) => make([d], d.trip.name.slice(0, 22) + '-', false))
}

export async function loadTripData(trips: Trip[]): Promise<TripData[]> {
  const receipts = await listReceiptsForTrips(trips.map((t) => t.id))
  const [items, members] = await Promise.all([listItems(receipts.map((r) => r.id)), Promise.all(trips.map((t) => listMembers(t.id)))])
  const tripOf = new Map(receipts.map((r) => [r.id, r.trip_id]))
  return trips.map((trip, i) => ({
    trip,
    receipts: receipts.filter((r) => r.trip_id === trip.id),
    items: items.filter((it) => tripOf.get(it.receipt_id!) === trip.id),
    members: members[i],
  }))
}

export function exportFileName(trips: Trip[]): string {
  return trips.length === 1 ? `${safeFile(trips[0].name)}_發票統計.xlsx` : `旅程發票統計_${trips.length}個旅程.xlsx`
}

/** 匯出並下載 */
export async function exportTrips(trips: Trip[], mode: Mode): Promise<void> {
  const [{ default: writeXlsxFile }, data] = await Promise.all([import('write-excel-file/browser'), loadTripData(trips)])
  await writeXlsxFile(buildSheets(data, mode), { fontFamily: 'Microsoft JhengHei' }).toFile(exportFileName(trips))
}
