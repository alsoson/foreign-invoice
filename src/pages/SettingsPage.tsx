import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useProfile } from '../auth/ProfileProvider'
import { errorMessage, listProviders, ownedTripsWithMembers, updateProfile } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useLoad } from '../hooks/useLoad'
import { CURRENCIES } from '../lib/types'
import { Avatar, btn, Card, ErrorBox, Field, inputClass, Notice, PageTitle } from '../components/ui'

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const { profile, reloadProfile } = useProfile()
  const providers = useLoad(() => listProviders(), [])
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('TWD')
  const [ai, setAi] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    setName(profile.display_name)
    setCurrency(profile.default_currency)
    setAi(profile.preferred_ai_provider ?? '')
  }, [profile])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      await updateProfile(user.id, { display_name: name.trim(), default_currency: currency, preferred_ai_provider: ai || null })
      await reloadProfile()
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageTitle>個人設定</PageTitle>

      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={profile?.display_name || user?.email || ''} url={profile?.avatar_url} size="h-14 w-14" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{profile?.display_name || '（未設定名稱）'}</p>
            <p className="truncate text-sm text-slate-500">{user?.email}</p>
            {profile?.is_admin && <p className="mt-1 inline-block rounded bg-teal-50 px-2 text-xs text-teal-700">系統管理員</p>}
          </div>
        </div>
      </Card>

      <Card>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <Field label="顯示名稱" className="sm:col-span-2" hint="旅程成員會看到這個名稱">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
          </Field>
          <Field label="預設幣別" hint="新增旅程時預先帶入">
            <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="慣用的 AI" hint="拍照辨識時優先使用">
            <select className={inputClass} value={ai} onChange={(e) => setAi(e.target.value)}>
              <option value="">依系統預設</option>
              {(providers.data ?? [])
                .filter((p) => p.enabled || p.id === ai)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <ErrorBox>{error}</ErrorBox>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" className={btn.primary + ' md:px-8'} disabled={busy || !profile}>
              {busy ? '儲存中…' : '儲存'}
            </button>
            {saved && <span className="text-sm text-teal-700">✓ 已儲存</span>}
          </div>
        </form>
      </Card>

      {profile?.is_admin && (
        <Card>
          <Link to="/admin/ai" className="flex items-center justify-between text-sm font-medium text-slate-800">
            <span>🛠️ AI 服務管理</span>
            <span className="text-slate-400">›</span>
          </Link>
        </Card>
      )}

      <button type="button" onClick={() => signOut()} className={btn.danger + ' w-full py-3 md:w-auto md:px-8'}>
        登出
      </button>

      <DeleteAccount onDeleted={() => signOut()} />

      <p className="text-center text-xs text-slate-400 md:text-left">版本 {__APP_VERSION__}</p>
    </div>
  )
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blockers = useLoad(() => (open ? ownedTripsWithMembers() : Promise.resolve([])), [open])

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } })
      if (error) {
        let msg = '刪除失敗，請稍後再試。'
        try {
          const p = await (error as { context?: Response }).context?.json()
          if (p?.error === 'must_transfer_trips') msg = `請先轉讓這些旅程：${p.trips.join('、')}`
        } catch {
          /* 不是 JSON */
        }
        throw new Error(msg)
      }
      onDeleted()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button type="button" className="text-sm text-slate-400 underline hover:text-red-600" onClick={() => setOpen(true)}>
        刪除帳號
      </button>
    )

  const list = blockers.data ?? []
  return (
    <Card className="ring-red-200">
      <h3 className="font-semibold text-red-700">刪除帳號</h3>
      <p className="mt-1 text-sm text-slate-600">
        會刪除你的帳號、個人資料，以及<b>只有你一個人</b>的旅程（含所有發票）。你在別人旅程中新增的發票會保留。刪除後無法復原。
      </p>
      {list.length > 0 ? (
        <div className="mt-3">
          <Notice>
            以下旅程還有其他成員，請先到旅程的「成員」頁把擁有者轉讓給別人，才能刪除帳號：
            <ul className="mt-1 list-inside list-disc">
              {list.map((t) => (
                <li key={t.trip_id}>
                  <Link className="underline" to={`/trips/${t.trip_id}/members`}>
                    {t.name}
                  </Link>
                  （{t.member_count} 位成員）
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Field label="請輸入「刪除」確認">
            <input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <ErrorBox>{error}</ErrorBox>
          <div className="flex gap-2">
            <button type="button" className={btn.dangerSolid} disabled={typed.trim() !== '刪除' || busy || blockers.loading} onClick={run}>
              {busy ? '刪除中…' : '永久刪除帳號'}
            </button>
            <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
