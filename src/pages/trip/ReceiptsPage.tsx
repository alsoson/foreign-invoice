import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useTrip } from './TripLayout'
import { errorMessage } from '../../lib/api'
import { useLoad } from '../../hooks/useLoad'
import { formatDay, formatMoney, round } from '../../lib/format'
import { CATEGORIES, CATEGORY_MAP, PAYMENT_LABEL, canEdit, type Category, type Receipt } from '../../lib/types'
import { exportTrips } from '../../lib/excel'
import { btn, Card, Empty, ErrorBox, inputClass, Loading } from '../../components/ui'

/** 旅程首頁：發票列表、總額、預算 */
export function ReceiptsPage() {
  const { trip, role, members, version, loadReceipts } = useTrip()
  const { data: receipts, error, loading } = useLoad(() => loadReceipts(), [trip.id, version])
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [q, setQ] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const editable = canEdit(role)
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? ''

  const totals = useMemo(() => sumByCurrency(receipts ?? []), [receipts])
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (receipts ?? []).filter(
      (r) =>
        (cat === 'all' || r.category === cat) &&
        (!kw || [r.store_name_original, r.store_name_translated, r.note].some((s) => s?.toLowerCase().includes(kw))),
    )
  }, [receipts, cat, q])
  const byDate = useMemo(() => {
    const m = new Map<string, Receipt[]>()
    for (const r of filtered) m.set(r.receipt_date, [...(m.get(r.receipt_date) ?? []), r])
    return [...m.entries()]
  }, [filtered])

  const spent = totals.find((t) => t.currency === trip.default_currency)?.total ?? 0
  const budgetPct = trip.budget ? Math.min(100, (spent / trip.budget) * 100) : 0

  async function doExport() {
    setExporting(true)
    setExportError(null)
    try {
      await exportTrips([trip], 'separate')
    } catch (e) {
      setExportError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="grid gap-3 md:grid-cols-3 md:gap-4">
        <Card className="md:col-span-2">
          <p className="text-sm text-slate-500">總花費（{receipts?.length ?? 0} 張發票）</p>
          {totals.length === 0 ? (
            <p className="mt-1 text-2xl font-bold text-slate-300">—</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              {totals.map((t) => (
                <p key={t.currency} className="text-2xl font-bold text-slate-900">
                  {formatMoney(t.total, t.currency)}
                </p>
              ))}
            </div>
          )}
          {trip.budget != null && trip.budget > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-500">
                <span>預算 {formatMoney(trip.budget, trip.default_currency)}</span>
                <span className={spent > trip.budget ? 'font-semibold text-red-600' : ''}>
                  {spent > trip.budget ? `超支 ${formatMoney(round(spent - trip.budget), trip.default_currency)}` : `剩餘 ${formatMoney(round(trip.budget - spent), trip.default_currency)}`}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(budgetPct)} aria-valuemin={0} aria-valuemax={100} aria-label="預算使用比例">
                <div className={`h-full rounded-full ${spent > trip.budget ? 'bg-red-500' : budgetPct > 80 ? 'bg-amber-500' : 'bg-teal-600'}`} style={{ width: `${budgetPct}%` }} />
              </div>
            </div>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1 md:content-start">
          {editable && (
            <>
              <Link to="scan" className={btn.primary + ' py-3'}>
                📷 拍照辨識
              </Link>
              <Link to="receipts/new" className={btn.secondary + ' py-3'}>
                ✍️ 手動新增
              </Link>
            </>
          )}
          <button type="button" onClick={doExport} disabled={exporting || !receipts?.length} className={btn.secondary + (editable ? ' col-span-2 md:col-span-1' : ' col-span-2')}>
            {exporting ? '匯出中…' : '⬇️ 匯出 Excel'}
          </button>
        </div>
      </div>
      <ErrorBox>{exportError}</ErrorBox>

      {(receipts?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 md:flex-1">
            {[{ id: 'all' as const, label: '全部', icon: '' }, ...CATEGORIES].map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={cat === c.id}
                onClick={() => setCat(c.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm ring-1 ${cat === c.id ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-slate-600 ring-slate-300'}`}
              >
                {c.icon && <span className="mr-1">{c.icon}</span>}
                {c.label}
              </button>
            ))}
          </div>
          <input type="search" className={inputClass + ' mt-0 md:w-64'} placeholder="搜尋店名、備註" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋發票" />
        </div>
      )}

      <ErrorBox>{error && `讀取發票失敗：${error}`}</ErrorBox>
      {loading && !receipts && <Loading />}

      {receipts?.length === 0 && (
        <Empty icon="🧾" title="還沒有發票">
          {editable ? '按「拍照辨識」拍下收據，或手動輸入' : '其他成員新增的發票會出現在這裡'}
        </Empty>
      )}
      {receipts && receipts.length > 0 && filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-500">沒有符合條件的發票</p>}

      <div className="space-y-5">
        {byDate.map(([date, list]) => (
          <section key={date}>
            <h3 className="mb-2 flex justify-between text-sm font-semibold text-slate-600">
              <span>{formatDay(date)}</span>
              <span className="font-normal text-slate-500">
                {sumByCurrency(list)
                  .map((t) => formatMoney(t.total, t.currency))
                  .join('・')}
              </span>
            </h3>
            <ul className="grid gap-2 lg:grid-cols-2">
              {list.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`receipts/${r.id}`}
                    className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 hover:ring-teal-300 md:p-4"
                  >
                    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xl">
                      {CATEGORY_MAP[r.category]?.icon ?? '📦'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{r.store_name_translated || r.store_name_original || CATEGORY_MAP[r.category]?.label}</p>
                      <p className="truncate text-xs text-slate-500">
                        {r.store_name_translated && r.store_name_original && r.store_name_original !== r.store_name_translated && `${r.store_name_original} · `}
                        {PAYMENT_LABEL[r.payment_method]}
                        {members.length > 1 && nameOf(r.created_by) && ` · ${nameOf(r.created_by)}`}
                      </p>
                    </div>
                    <p className="shrink-0 text-right font-semibold text-slate-900">{formatMoney(r.amount, r.currency)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function sumByCurrency(list: Receipt[]): { currency: string; total: number }[] {
  const m = new Map<string, number>()
  for (const r of list) m.set(r.currency, round((m.get(r.currency) ?? 0) + r.amount))
  return [...m.entries()].map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
}
