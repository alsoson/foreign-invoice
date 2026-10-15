import { useState } from 'react'
import { useProfile } from '../../auth/ProfileProvider'
import { aiUsageStats, errorMessage, listProviders, setDefaultProvider, updateProvider } from '../../lib/api'
import { loadProviderOptions } from '../../lib/scan'
import { useLoad } from '../../hooks/useLoad'
import { toNum } from '../../lib/format'
import type { AiProvider } from '../../lib/types'
import { btn, Card, ErrorBox, Field, inputClass, Loading, Notice, PageTitle } from '../../components/ui'

/** 系統管理員：啟用／停用 AI、換模型、備援順序、使用上限，並查看各家成效 */
export function AdminAiPage() {
  const { profile } = useProfile()
  const [days, setDays] = useState(30)
  const providers = useLoad(() => listProviders(), [])
  // 金鑰是否已設定：由 Edge Function 回報（金鑰本身不會傳到前端）
  const keys = useLoad(async () => {
    const r = await loadProviderOptions()
    return Object.fromEntries(r.providers.map((p) => [p.id, p.configured])) as Record<string, boolean>
  }, [])
  const stats = useLoad(() => aiUsageStats(days), [days])

  if (profile && !profile.is_admin) return <Notice>只有系統管理員可以使用這個頁面。</Notice>
  if (!profile || (providers.loading && !providers.data)) return <Loading />

  return (
    <div className="space-y-4 md:space-y-6">
      <PageTitle>AI 服務管理</PageTitle>
      <Notice tone="slate">
        API 金鑰存放在 Supabase 的 Edge Function Secrets，不在這裡設定。修改這頁的設定會立即生效，不需要重新部署。
      </Notice>
      <ErrorBox>{providers.error}</ErrorBox>

      <div className="grid gap-4 md:gap-6 xl:grid-cols-2">
        {(providers.data ?? []).map((p) => (
          <ProviderCard key={`${p.id}-${p.is_default}`} p={p} keyConfigured={keys.data?.[p.id]} onSaved={providers.reload} />
        ))}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">各家成效</h3>
          <select className={inputClass + ' mt-0 w-auto py-1.5 text-sm'} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="統計期間">
            <option value={7}>最近 7 天</option>
            <option value={30}>最近 30 天</option>
            <option value={90}>最近 90 天</option>
          </select>
        </div>
        <ErrorBox>{stats.error}</ErrorBox>
        {stats.data?.length === 0 && <p className="text-sm text-slate-500">這段期間沒有辨識紀錄。</p>}
        {!!stats.data?.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 font-normal">服務</th>
                  <th className="py-2 text-right font-normal">次數</th>
                  <th className="py-2 text-right font-normal">成功率</th>
                  <th className="py-2 text-right font-normal">備援成功</th>
                  <th className="py-2 text-right font-normal">平均速度</th>
                  <th className="py-2 text-right font-normal">需要修正</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.map((s) => (
                  <tr key={s.provider} className="border-b border-slate-100">
                    <td className="py-2 font-medium text-slate-800">{providers.data?.find((p) => p.id === s.provider)?.display_name ?? s.provider}</td>
                    <td className="py-2 text-right">{s.total}</td>
                    <td className="py-2 text-right">{s.total ? Math.round((s.success / s.total) * 100) : 0}%</td>
                    <td className="py-2 text-right">{s.fallback}</td>
                    <td className="py-2 text-right">{s.avg_ms !== null ? `${(s.avg_ms / 1000).toFixed(1)} 秒` : '—'}</td>
                    <td className="py-2 text-right">{s.corrected_ratio !== null ? `${Math.round(s.corrected_ratio * 100)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">「需要修正」＝辨識成功後，使用者存檔前有修改欄位的比例；越低代表越準確。</p>
          </div>
        )}
      </Card>
    </div>
  )
}

function ProviderCard({ p, keyConfigured, onSaved }: { p: AiProvider; keyConfigured: boolean | undefined; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(p.enabled)
  const [model, setModel] = useState(p.model)
  const [order, setOrder] = useState(String(p.fallback_order))
  const [limit, setLimit] = useState(p.daily_limit_per_user === null ? '' : String(p.daily_limit_per_user))
  const [timeout, setTimeoutSec] = useState(String(p.timeout_seconds))
  const [note, setNote] = useState(p.note ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const t = toNum(timeout)
      const l = toNum(limit)
      if (!model.trim()) throw new Error('請填寫模型名稱。')
      if (t === null || t < 5 || t > 60) throw new Error('逾時秒數需在 5～60 之間。')
      if (limit.trim() && (l === null || l < 1)) throw new Error('每日上限需為 1 以上，或留空表示不限。')
      await updateProvider(p.id, {
        enabled,
        model: model.trim(),
        fallback_order: Math.round(toNum(order) ?? p.fallback_order),
        daily_limit_per_user: l === null ? null : Math.round(l),
        timeout_seconds: Math.round(t),
        note: note.trim() || null,
      })
      setMsg('✓ 已儲存')
      await onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">
            {p.display_name} {p.is_default && <span className="ml-1 rounded bg-teal-50 px-2 py-0.5 text-xs font-normal text-teal-700">系統預設</span>}
          </h3>
          <p className="text-xs text-slate-500">
            {p.id} · {p.adapter} ·{' '}
            {keyConfigured === undefined ? '金鑰狀態未知' : keyConfigured ? <span className="text-teal-700">金鑰已設定</span> : <span className="text-amber-700">金鑰未設定</span>}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-teal-600" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label={`啟用 ${p.display_name}`} />
          啟用
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="模型" className="col-span-2 sm:col-span-4">
          <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} aria-label={`${p.display_name} 模型`} />
        </Field>
        <Field label="備援順序" hint="小的先試">
          <input className={inputClass} inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
        </Field>
        <Field label="每人每日上限" hint="留空＝不限">
          <input className={inputClass} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field label="逾時（秒）">
          <input className={inputClass} inputMode="numeric" value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} />
        </Field>
        <Field label="備註">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <ErrorBox>{error}</ErrorBox>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btn.primary} onClick={save} disabled={busy}>
          {busy ? '儲存中…' : '儲存'}
        </button>
        {!p.is_default && (
          <button
            type="button"
            className={btn.secondary}
            disabled={busy || !p.enabled}
            title={p.enabled ? '' : '請先啟用並儲存'}
            onClick={async () => {
              setError(null)
              try {
                await setDefaultProvider(p.id)
                await onSaved()
              } catch (e) {
                setError(errorMessage(e))
              }
            }}
          >
            設為系統預設
          </button>
        )}
        {msg && <span className="text-sm text-teal-700">{msg}</span>}
      </div>
    </Card>
  )
}
