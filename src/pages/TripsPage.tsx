import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/Spinner'

interface Trip {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
  default_currency: string
  owner_id: string
}

const CURRENCIES = ['JPY', 'KRW', 'THB', 'TWD', 'USD', 'EUR', 'HKD', 'CNY', 'SGD', 'VND', 'GBP', 'AUD']

/** 旅程列表（階段 0：可新增旅程，用來確認登入、資料庫與權限都正常） */
export function TripsPage() {
  const { user } = useAuth()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function load() {
    const { data, error } = await supabase
      .from('trips')
      .select('id, name, start_date, end_date, default_currency, owner_id')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setTrips(data)
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 md:mb-6">
        <h2 className="text-xl font-bold text-slate-900 md:text-2xl">我的旅程</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 active:bg-teal-800 md:px-4"
        >
          {showForm ? '取消' : '＋ 新增旅程'}
        </button>
      </div>

      {showForm && user && (
        <NewTripForm
          ownerId={user.id}
          onCreated={() => {
            setShowForm(false)
            load()
          }}
        />
      )}

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">讀取失敗：{error}</p>}

      {trips === null && !error && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {trips?.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 md:p-16">
          <p className="text-3xl">🧳</p>
          <p className="mt-2">還沒有旅程</p>
          <p className="text-sm">按右上角「新增旅程」開始記錄</p>
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-3">
        {trips?.map((t) => (
          <li key={t.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md md:p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words font-semibold text-slate-900">{t.name}</p>
              <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t.default_currency}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {t.start_date ? `${t.start_date} – ${t.end_date ?? ''}` : '未設定日期'}
              {t.owner_id !== user?.id && ' · 別人分享的'}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NewTripForm({ ownerId, onCreated }: { ownerId: string; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('JPY')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('trips').insert({
      owner_id: ownerId,
      name: name.trim(),
      default_currency: currency,
      start_date: start || null,
      end_date: end || null,
    })
    setBusy(false)
    if (error) setError(error.message)
    else onCreated()
  }

  const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base'

  return (
    <form onSubmit={submit} className="mb-4 grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:mb-6 md:grid-cols-2 md:gap-4 md:p-6 lg:grid-cols-5">
      <label className="block text-sm text-slate-700 md:col-span-2">
        旅程名稱
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：2026 東京行" maxLength={100} required />
      </label>
      <label className="block text-sm text-slate-700 md:col-span-2 lg:col-span-1">
        預設幣別
        <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3 md:col-span-2 md:gap-4">
        <label className="block text-sm text-slate-700">
          開始日期
          <input type="date" className={input} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="block text-sm text-slate-700">
          結束日期
          <input type="date" className={input} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-sm text-red-600 md:col-span-full">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-lg bg-teal-600 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50 md:col-span-full md:w-auto md:justify-self-end md:px-8">
        {busy ? '建立中…' : '建立旅程'}
      </button>
    </form>
  )
}
