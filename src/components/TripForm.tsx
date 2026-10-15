import { useState, type FormEvent } from 'react'
import { CURRENCIES, type AiProvider, type Trip } from '../lib/types'
import type { TripInput } from '../lib/api'
import { errorMessage } from '../lib/api'
import { toNum } from '../lib/format'
import { btn, ErrorBox, Field, inputClass } from './ui'

/** 新增／編輯旅程的表單 */
export function TripForm({
  initial,
  defaultCurrency = 'JPY',
  providers,
  submitLabel,
  onSubmit,
  onCancel,
  disabled,
}: {
  initial?: Trip | null
  defaultCurrency?: string
  providers?: AiProvider[]
  submitLabel: string
  onSubmit: (input: TripInput) => Promise<void>
  onCancel?: () => void
  disabled?: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [country, setCountry] = useState(initial?.country ?? '')
  const [currency, setCurrency] = useState(initial?.default_currency ?? defaultCurrency)
  const [start, setStart] = useState(initial?.start_date ?? '')
  const [end, setEnd] = useState(initial?.end_date ?? '')
  const [budget, setBudget] = useState(initial?.budget != null ? String(initial.budget) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [ai, setAi] = useState(initial?.default_ai_provider ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currencies = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (start && end && end < start) {
      setError('結束日期不能早於開始日期。')
      return
    }
    const b = toNum(budget)
    if (budget.trim() && (b === null || b < 0)) {
      setError('預算請輸入 0 以上的數字。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        country: country.trim() || null,
        default_currency: currency,
        start_date: start || null,
        end_date: end || null,
        budget: b,
        note: note.trim() || null,
        default_ai_provider: ai || null,
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
      <Field label="旅程名稱" className="md:col-span-2">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：2026 東京行" maxLength={100} required disabled={disabled} />
      </Field>
      <Field label="國家／地區">
        <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="例如：日本" maxLength={50} disabled={disabled} />
      </Field>
      <Field label="預設幣別">
        <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={disabled}>
          {currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="開始日期">
        <input type="date" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} disabled={disabled} />
      </Field>
      <Field label="結束日期">
        <input type="date" className={inputClass} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} disabled={disabled} />
      </Field>
      <Field label={`預算（${currency}，選填）`}>
        <input className={inputClass} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="不設定" disabled={disabled} />
      </Field>
      {providers && providers.length > 0 ? (
        <Field label="旅程預設 AI（選填）">
          <select className={inputClass} value={ai} onChange={(e) => setAi(e.target.value)} disabled={disabled}>
            <option value="">不指定</option>
            {providers
              .filter((p) => p.enabled || p.id === ai)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
          </select>
        </Field>
      ) : (
        <div className="hidden lg:block" />
      )}
      <Field label="備註（選填）" className="md:col-span-2 lg:col-span-4">
        <textarea className={inputClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={disabled} />
      </Field>
      <div className="md:col-span-2 lg:col-span-4">
        <ErrorBox>{error}</ErrorBox>
      </div>
      {!disabled && (
        <div className="flex flex-col-reverse gap-2 md:col-span-2 md:flex-row md:justify-end lg:col-span-4">
          {onCancel && (
            <button type="button" className={btn.secondary} onClick={onCancel}>
              取消
            </button>
          )}
          <button type="submit" disabled={busy} className={btn.primary + ' md:px-8'}>
            {busy ? '儲存中…' : submitLabel}
          </button>
        </div>
      )}
    </form>
  )
}
