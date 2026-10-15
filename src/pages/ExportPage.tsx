import { useState } from 'react'
import { errorMessage, listTrips, tripSummaries } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { exportTrips } from '../lib/excel'
import { formatDateRange } from '../lib/format'
import { btn, Card, Empty, ErrorBox, Loading, PageTitle } from '../components/ui'

/** 匯出 Excel：可以選一個或多個旅程 */
export function ExportPage() {
  const { data, error, loading } = useLoad(async () => {
    const [trips, sums] = await Promise.all([listTrips(), tripSummaries()])
    return { trips, sums }
  }, [])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'separate' | 'merged'>('separate')
  const [busy, setBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function run() {
    if (!data) return
    setBusy(true)
    setExportError(null)
    try {
      await exportTrips(
        data.trips.filter((t) => selected.has(t.id)),
        mode,
      )
    } catch (e) {
      setExportError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <PageTitle>匯出 Excel</PageTitle>
      <ErrorBox>{error}</ErrorBox>
      {loading && !data && <Loading />}
      {data?.trips.length === 0 && <Empty icon="📊" title="還沒有旅程可以匯出" />}
      {data && data.trips.length > 0 && (
        <div className="space-y-4">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">選擇旅程</h3>
              <button type="button" className={btn.ghost} onClick={() => setSelected(selected.size === data.trips.length ? new Set() : new Set(data.trips.map((t) => t.id)))}>
                {selected.size === data.trips.length ? '全部取消' : '全選'}
              </button>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.trips.map((t) => {
                const n = data.sums.filter((s) => s.trip_id === t.id).reduce((a, s) => a + s.receipt_count, 0)
                return (
                  <li key={t.id}>
                    <label className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 ring-1 ${selected.has(t.id) ? 'bg-teal-50 ring-teal-400' : 'ring-slate-200 hover:bg-slate-50'}`}>
                      <input type="checkbox" className="h-5 w-5 accent-teal-600" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{t.name}</span>
                        <span className="block text-xs text-slate-500">
                          {formatDateRange(t.start_date, t.end_date)} · {n} 張發票
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </Card>

          {selected.size > 1 && (
            <Card>
              <h3 className="mb-2 font-semibold text-slate-900">多個旅程的匯出方式</h3>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2">
                  <input type="radio" name="mode" className="mt-1 accent-teal-600" checked={mode === 'separate'} onChange={() => setMode('separate')} />
                  <span>
                    <b>每個旅程各自一組工作表</b>
                    <span className="block text-slate-500">例如「東京-總覽」「東京-發票明細」…</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="mode" className="mt-1 accent-teal-600" checked={mode === 'merged'} onChange={() => setMode('merged')} />
                  <span>
                    <b>合併成一份總表</b>
                    <span className="block text-slate-500">所有旅程放在同一組工作表，多一欄「旅程」方便篩選</span>
                  </span>
                </label>
              </div>
            </Card>
          )}

          <ErrorBox>{exportError}</ErrorBox>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-slate-500">工作表：總覽、發票明細、品項明細、類別統計、每日統計</p>
            <button type="button" className={btn.primary + ' py-3 md:px-10'} disabled={!selected.size || busy} onClick={run}>
              {busy ? '匯出中…' : `⬇️ 匯出 ${selected.size || ''} 個旅程`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
