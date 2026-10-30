import { useMemo, useState } from 'react'
import { useTrip } from './TripLayout'
import { useLoad } from '../../hooks/useLoad'
import { byCategory, byDay, byMember, byPayment, byStore, currenciesOf, tripDays, type Row } from '../../lib/stats'
import { formatDay, formatMoney, formatNumber, round } from '../../lib/format'
import { CATEGORY_MAP, type Category } from '../../lib/types'
import { Card, Empty, ErrorBox, Loading } from '../../components/ui'

/** 旅程統計。不同幣別分開統計，不做匯率換算。 */
export function StatsPage() {
  const { trip, members, version, loadReceipts } = useTrip()
  const { data: receipts, error, loading } = useLoad(() => loadReceipts(), [trip.id, version])
  const currencies = useMemo(() => currenciesOf(receipts ?? []), [receipts])
  const [picked, setPicked] = useState<string | null>(null)
  const currency = picked && currencies.some((c) => c.currency === picked) ? picked : (currencies.find((c) => c.currency === trip.default_currency)?.currency ?? currencies[0]?.currency)

  const list = useMemo(() => (receipts ?? []).filter((r) => r.currency === currency), [receipts, currency])
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.user_id === id)?.display_name ?? '已離開的成員') : '未知')

  if (loading && !receipts) return <Loading />
  if (error) return <ErrorBox>讀取失敗：{error}</ErrorBox>
  if (!receipts?.length || !currency) return <Empty icon="📈" title="還沒有可以統計的發票">新增發票後，這裡會顯示花費分析</Empty>

  const total = round(list.reduce((s, r) => s + r.amount, 0))
  const days = tripDays(receipts, trip.start_date, trip.end_date)
  const daily = byDay(list, trip.start_date, trip.end_date)
  const mem = byMember(list, nameOf)
  const showBudget = trip.budget != null && trip.budget > 0 && currency === trip.default_currency

  return (
    <div className="space-y-4 md:space-y-6">
      {currencies.length > 1 && (
        <div>
          <p className="mb-2 text-sm text-slate-600">這趟旅程有 {currencies.length} 種幣別，各自分開統計（不換算匯率）：</p>
          <div role="tablist" aria-label="幣別" className="flex flex-wrap gap-2">
            {currencies.map((c) => (
              <button
                key={c.currency}
                role="tab"
                aria-selected={c.currency === currency}
                type="button"
                onClick={() => setPicked(c.currency)}
                className={`rounded-full px-3 py-1.5 text-sm ring-1 ${c.currency === currency ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-slate-700 ring-slate-300'}`}
              >
                {c.currency}（{c.count} 張）
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Stat label={`總金額（${currency}）`} value={formatNumber(total, currency)} />
        <Stat label="發票張數" value={`${list.length}`} />
        <Stat label="旅遊天數" value={days ? `${days} 天` : '—'} />
        <Stat label="平均每日" value={days ? formatNumber(round(total / days), currency) : '—'} />
      </div>

      {showBudget && (
        <Card>
          <h3 className="font-semibold text-slate-900">預算</h3>
          <BudgetBar spent={total} budget={trip.budget!} currency={currency} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold text-slate-900">依類別</h3>
          <BarList rows={byCategory(list)} total={total} currency={currency} icon={(k) => CATEGORY_MAP[k as Category]?.icon} />
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold text-slate-900">依付款方式</h3>
          <BarList rows={byPayment(list)} total={total} currency={currency} />
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold text-slate-900">每日花費</h3>
        <DailyChart rows={daily} currency={currency} />
      </Card>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold text-slate-900">消費最多的店家</h3>
          <BarList rows={byStore(list)} total={total} currency={currency} ranked />
        </Card>
        {members.length > 1 && (
          <Card>
            <h3 className="mb-3 font-semibold text-slate-900">依成員</h3>
            <p className="mb-2 text-sm text-slate-500">誰記了幾張發票</p>
            <BarList rows={mem.created} total={total} currency={currency} showCount />
            {mem.paid.length > 0 && (
              <>
                <p className="mb-2 mt-5 text-sm text-slate-500">誰付了多少（有填「付款人」的發票）</p>
                <BarList rows={mem.paid} total={total} currency={currency} />
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs text-slate-500 md:text-sm">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 md:text-2xl">{value}</p>
    </Card>
  )
}

function BudgetBar({ spent, budget, currency }: { spent: number; budget: number; currency: string }) {
  const pct = Math.min(100, (spent / budget) * 100)
  const over = spent > budget
  return (
    <div className="mt-2">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="text-slate-600">
          已花 <b className="text-slate-900">{formatMoney(spent, currency)}</b>／預算 {formatMoney(budget, currency)}
        </span>
        <span className={over ? 'font-semibold text-red-600' : 'text-slate-600'}>
          {over ? `⚠️ 超支 ${formatMoney(round(spent - budget), currency)}` : `剩餘 ${formatMoney(round(budget - spent), currency)}`}
        </span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-teal-600'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">已使用 {Math.round((spent / budget) * 100)}%</p>
    </div>
  )
}

/** 橫條圖：每列都直接標示金額與比例，不需要靠顏色辨識 */
function BarList({ rows, total, currency, icon, ranked, showCount }: { rows: Row[]; total: number; currency: string; icon?: (k: string) => string | undefined; ranked?: boolean; showCount?: boolean }) {
  if (!rows.length) return <p className="text-sm text-slate-500">沒有資料</p>
  const max = Math.max(...rows.map((r) => (showCount ? r.count : r.total)), 1)
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => {
        const v = showCount ? r.count : r.total
        const pct = total ? Math.round((r.total / total) * 1000) / 10 : 0
        return (
          <li key={r.key} title={`${r.label}：${formatMoney(r.total, currency)}（${r.count} 張，${pct}%）`}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-slate-700">
                {ranked && <span className="mr-1.5 inline-block w-5 text-right text-slate-400">{i + 1}</span>}
                {icon?.(r.key) && <span className="mr-1">{icon(r.key)}</span>}
                {r.label}
              </span>
              <span className="shrink-0 text-slate-900">
                {showCount ? (
                  <>
                    <b>{r.count}</b> 張 <span className="text-xs text-slate-500">{formatMoney(r.total, currency)}</span>
                  </>
                ) : (
                  <>
                    <b>{formatNumber(r.total, currency)}</b> <span className="text-xs text-slate-500">{pct}%</span>
                  </>
                )}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(1, (v / max) * 100)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** 每日長條圖：滑過（或點一下）每根長條會顯示當天金額；最高的一天直接標示 */
function DailyChart({ rows, currency }: { rows: Row[]; currency: string }) {
  const [active, setActive] = useState<string | null>(null)
  const max = Math.max(...rows.map((r) => r.total), 1)
  const top = rows.reduce((a, b) => (b.total > a.total ? b : a), rows[0])
  const shown = rows.find((r) => r.key === active) ?? top
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600" aria-live="polite">
        {shown.key === top.key && !active ? '花最多的一天：' : ''}
        <b className="text-slate-900">{formatDay(shown.key)}</b> {formatMoney(shown.total, currency)}（{shown.count} 張）
      </p>
      <div className="overflow-x-auto">
        <div className="flex h-44 items-end gap-0.5" style={{ minWidth: `${rows.length * 22}px` }} onMouseLeave={() => setActive(null)}>
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              className="group flex h-full min-w-[20px] flex-1 flex-col justify-end"
              onMouseEnter={() => setActive(r.key)}
              onFocus={() => setActive(r.key)}
              onClick={() => setActive(r.key)}
              aria-label={`${formatDay(r.key)} ${formatMoney(r.total, currency)}`}
            >
              <div
                className={`mx-auto w-full max-w-12 rounded-t ${r.key === shown.key ? 'bg-teal-700' : 'bg-teal-500 group-hover:bg-teal-600'}`}
                style={{ height: r.total ? `${Math.max(2, (r.total / max) * 100)}%` : '2px', opacity: r.total ? 1 : 0.25 }}
              />
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-0.5 border-t border-slate-200 pt-1" style={{ minWidth: `${rows.length * 22}px` }}>
          {rows.map((r, i) => (
            <span key={r.key} className="min-w-[20px] flex-1 text-center text-[10px] text-slate-500">
              {rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0 ? `${Number(r.key.slice(5, 7))}/${Number(r.key.slice(8))}` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
