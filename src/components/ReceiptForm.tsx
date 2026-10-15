import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CATEGORIES, CURRENCIES, PAYMENTS, type ItemDraft, type Member, type ReceiptDraft, type Receipt, type ReceiptItem, type Trip } from '../lib/types'
import { currencyDigits, formatMoney, round, todayIso, toNum } from '../lib/format'
import { errorMessage, type SaveReceiptInput } from '../lib/api'
import { btn, Chips, ErrorBox, Field, inputClass, Notice } from './ui'

let keySeq = 0
const newKey = () => `k${++keySeq}`

export function emptyItem(): ItemDraft {
  return { key: newKey(), name_original: '', name_translated: '', quantity: '1', unit_price: '', subtotal: '' }
}

export function emptyDraft(trip: Trip, paidBy = ''): ReceiptDraft {
  const today = todayIso()
  // 旅程期間外的「今天」改用旅程開始日，比較常見的是事後補登
  const inTrip = (!trip.start_date || today >= trip.start_date) && (!trip.end_date || today <= trip.end_date)
  return {
    receipt_date: inTrip ? today : (trip.start_date ?? today),
    store_name_original: '',
    store_name_translated: '',
    category: 'food',
    currency: trip.default_currency,
    amount: '',
    payment_method: 'cash',
    paid_by: paidBy,
    raw_text: '',
    note: '',
    items: [],
  }
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function draftFromReceipt(r: Receipt, items: ReceiptItem[]): ReceiptDraft {
  return {
    receipt_date: r.receipt_date,
    store_name_original: s(r.store_name_original),
    store_name_translated: s(r.store_name_translated),
    category: r.category,
    currency: r.currency,
    amount: s(r.amount),
    payment_method: r.payment_method,
    paid_by: s(r.paid_by),
    raw_text: s(r.raw_text),
    note: s(r.note),
    items: items.map((i) => ({
      key: newKey(),
      name_original: s(i.name_original),
      name_translated: s(i.name_translated),
      quantity: s(i.quantity),
      unit_price: s(i.unit_price),
      subtotal: s(i.subtotal),
    })),
  }
}

/** 表單內容 → save_receipt 的參數 */
export function draftToInput(d: ReceiptDraft, tripId: string): { receipt: SaveReceiptInput; items: Omit<ReceiptItem, 'id' | 'receipt_id'>[] } {
  const items = d.items
    .filter((i) => i.name_original.trim() || i.name_translated.trim() || toNum(i.subtotal) !== null || toNum(i.unit_price) !== null)
    .map((i, idx) => ({
      sort_order: idx,
      name_original: i.name_original.trim() || null,
      name_translated: i.name_translated.trim() || null,
      quantity: toNum(i.quantity) ?? 1,
      unit_price: toNum(i.unit_price),
      subtotal: toNum(i.subtotal),
    }))
  return {
    receipt: {
      trip_id: tripId,
      receipt_date: d.receipt_date,
      store_name_original: d.store_name_original.trim() || null,
      store_name_translated: d.store_name_translated.trim() || null,
      category: d.category,
      currency: d.currency.trim().toUpperCase(),
      amount: toNum(d.amount) ?? 0,
      payment_method: d.payment_method,
      paid_by: d.paid_by || null,
      raw_text: d.raw_text.trim() || null,
      note: d.note.trim() || null,
    },
    items,
  }
}

/** 比較兩份內容，算出使用者修改了幾個欄位（用來評估 AI 的準確度） */
export function countChangedFields(a: ReceiptDraft, b: ReceiptDraft): number {
  const keys: (keyof ReceiptDraft)[] = ['receipt_date', 'store_name_original', 'store_name_translated', 'category', 'currency', 'amount', 'payment_method']
  let n = keys.filter((k) => String(a[k]).trim() !== String(b[k]).trim()).length
  const norm = (d: ReceiptDraft) => JSON.stringify(draftToInput(d, '').items)
  if (norm(a) !== norm(b)) n += 1
  return n
}

export function itemsTotal(items: ItemDraft[]): number | null {
  const subs = items.map((i) => toNum(i.subtotal)).filter((n): n is number => n !== null)
  return subs.length ? round(subs.reduce((a, b) => a + b, 0)) : null
}

export function ReceiptForm({
  initial,
  members,
  readOnly,
  submitLabel = '儲存',
  onSubmit,
  tripOptions,
  tripId,
  onTripChange,
  footer,
}: {
  initial: ReceiptDraft
  members: Member[]
  readOnly?: boolean
  submitLabel?: string
  onSubmit: (d: ReceiptDraft) => Promise<void>
  /** 可以把發票移到的旅程（有編輯權限的） */
  tripOptions?: { id: string; name: string }[]
  tripId?: string
  onTripChange?: (id: string) => void
  footer?: ReactNode
}) {
  const [d, setD] = useState<ReceiptDraft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const set = <K extends keyof ReceiptDraft>(k: K, v: ReceiptDraft[K]) => setD((x) => ({ ...x, [k]: v }))

  const sum = itemsTotal(d.items)
  const amount = toNum(d.amount)
  const tol = currencyDigits(d.currency.toUpperCase() || 'JPY') === 0 ? 0.5 : 0.005
  const mismatch = sum !== null && amount !== null && Math.abs(sum - amount) > tol
  const currencies = useMemo(() => (CURRENCIES.includes(d.currency) ? CURRENCIES : [d.currency, ...CURRENCIES].filter(Boolean)), [d.currency])

  function setItem(key: string, field: keyof ItemDraft, value: string) {
    setD((x) => ({
      ...x,
      items: x.items.map((i) => {
        if (i.key !== key) return i
        const next = { ...i, [field]: value }
        // 改數量或單價時自動算小計
        if (field === 'quantity' || field === 'unit_price') {
          const q = toNum(next.quantity)
          const p = toNum(next.unit_price)
          if (q !== null && p !== null) next.subtotal = String(round(q * p))
        }
        return next
      }),
    }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!d.receipt_date) return setError('請填寫日期。')
    if (amount === null || amount < 0) return setError('請填寫金額（0 以上的數字）。')
    if (!/^[A-Za-z]{3}$/.test(d.currency.trim())) return setError('幣別請填 3 個英文字母，例如 JPY。')
    for (const i of d.items) {
      if (i.quantity.trim() && toNum(i.quantity) === null) return setError('品項的數量必須是數字。')
      if (i.unit_price.trim() && toNum(i.unit_price) === null) return setError('品項的單價必須是數字。')
      if (i.subtotal.trim() && toNum(i.subtotal) === null) return setError('品項的小計必須是數字。')
    }
    setBusy(true)
    try {
      await onSubmit(d)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={readOnly || busy} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-4">
          <Field label="日期">
            <input type="date" className={inputClass} value={d.receipt_date} onChange={(e) => set('receipt_date', e.target.value)} required />
          </Field>
          <Field label="幣別">
            <select className={inputClass} value={d.currency} onChange={(e) => set('currency', e.target.value)}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="總金額" className="sm:col-span-2 lg:col-span-2">
            <input className={inputClass + ' text-lg font-semibold'} inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" required aria-label="總金額" />
          </Field>
          <Field label="店名（原文）" className="sm:col-span-2">
            <input className={inputClass} value={d.store_name_original} onChange={(e) => set('store_name_original', e.target.value)} placeholder="例如：ファミリーマート" />
          </Field>
          <Field label="店名（中文）" className="sm:col-span-2">
            <input className={inputClass} value={d.store_name_translated} onChange={(e) => set('store_name_translated', e.target.value)} placeholder="例如：全家便利商店" />
          </Field>
        </div>

        <div>
          <span className="text-sm text-slate-700">類別</span>
          <Chips name="類別" options={CATEGORIES} value={d.category} onChange={(v) => set('category', v)} disabled={readOnly} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <span className="text-sm text-slate-700">付款方式</span>
            <Chips name="付款方式" options={PAYMENTS} value={d.payment_method} onChange={(v) => set('payment_method', v)} disabled={readOnly} />
          </div>
          {members.length > 1 && (
            <Field label="付款人">
              <select className={inputClass} value={d.paid_by} onChange={(e) => set('paid_by', e.target.value)}>
                <option value="">未指定</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {/* 品項 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">品項明細{d.items.length > 0 && `（${d.items.length}）`}</h3>
            {!readOnly && (
              <button type="button" className={btn.ghost} onClick={() => setD((x) => ({ ...x, items: [...x.items, emptyItem()] }))}>
                ＋ 新增品項
              </button>
            )}
          </div>
          {d.items.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">沒有品項明細（選填）</p>
          ) : (
            <ul className="space-y-2">
              <li className="hidden grid-cols-12 gap-2 px-3 text-xs text-slate-500 lg:grid" aria-hidden>
                <span className="col-span-3">品名（原文）</span>
                <span className="col-span-3">品名（中文）</span>
                <span className="col-span-1">數量</span>
                <span className="col-span-2">單價</span>
                <span className="col-span-2">小計</span>
              </li>
              {d.items.map((i, idx) => (
                <li key={i.key} className="grid grid-cols-6 gap-2 rounded-lg bg-slate-50 p-3 lg:grid-cols-12 lg:items-center" aria-label={`品項 ${idx + 1}`}>
                  <input aria-label="品名（原文）" className={inputClass + ' col-span-6 mt-0 lg:col-span-3'} placeholder="品名（原文）" value={i.name_original} onChange={(e) => setItem(i.key, 'name_original', e.target.value)} />
                  <input aria-label="品名（中文）" className={inputClass + ' col-span-6 mt-0 lg:col-span-3'} placeholder="品名（中文）" value={i.name_translated} onChange={(e) => setItem(i.key, 'name_translated', e.target.value)} />
                  <input aria-label="數量" className={inputClass + ' col-span-1 mt-0 px-2 lg:col-span-1'} inputMode="decimal" placeholder="數量" value={i.quantity} onChange={(e) => setItem(i.key, 'quantity', e.target.value)} />
                  <input aria-label="單價" className={inputClass + ' col-span-2 mt-0 lg:col-span-2'} inputMode="decimal" placeholder="單價" value={i.unit_price} onChange={(e) => setItem(i.key, 'unit_price', e.target.value)} />
                  <input aria-label="小計" className={inputClass + ' col-span-2 mt-0 lg:col-span-2'} inputMode="decimal" placeholder="小計" value={i.subtotal} onChange={(e) => setItem(i.key, 'subtotal', e.target.value)} />
                  {!readOnly ? (
                    <button type="button" aria-label="刪除品項" className={btn.ghost + ' col-span-1 text-red-600 lg:col-span-1'} onClick={() => setD((x) => ({ ...x, items: x.items.filter((y) => y.key !== i.key) }))}>
                      ✕
                    </button>
                  ) : (
                    <span className="col-span-1" />
                  )}
                </li>
              ))}
            </ul>
          )}
          {sum !== null && (
            <p className="mt-2 text-right text-sm text-slate-500">
              品項小計合計：<span className="font-semibold text-slate-700">{formatMoney(sum, d.currency)}</span>
            </p>
          )}
          {mismatch && (
            <div className="mt-2">
              <Notice>
                <p>
                  ⚠️ 品項小計合計（{formatMoney(sum!, d.currency)}）和總金額（{formatMoney(amount!, d.currency)}）不一致，可能有辨識錯誤，或有稅金、折扣沒有列入。
                </p>
                {!readOnly && (
                  <button type="button" className="mt-2 font-semibold text-amber-800 underline" onClick={() => set('amount', String(sum))}>
                    把總金額改成 {formatMoney(sum!, d.currency)}
                  </button>
                )}
              </Notice>
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <Field label="備註">
            <textarea className={inputClass} rows={2} value={d.note} onChange={(e) => set('note', e.target.value)} maxLength={1000} />
          </Field>
          {tripOptions && tripOptions.length > 1 && tripId && onTripChange && (
            <Field label="所屬旅程" hint="可以把這張發票移到其他旅程">
              <select className={inputClass} value={tripId} onChange={(e) => onTripChange(e.target.value)}>
                {tripOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

      </fieldset>

      {(d.raw_text || !readOnly) && (
        <div>
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? '隱藏' : '顯示'}辨識原文
          </button>
          {showRaw && (
            <textarea aria-label="辨識原文" className={inputClass + ' font-mono text-xs'} rows={6} value={d.raw_text} readOnly={readOnly} disabled={busy} onChange={(e) => set('raw_text', e.target.value)} />
          )}
        </div>
      )}

      <ErrorBox>{error}</ErrorBox>
      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">{footer}</div>
        {!readOnly && (
          <button type="submit" className={btn.primary + ' py-3 md:px-10'} disabled={busy}>
            {busy ? '儲存中…' : submitLabel}
          </button>
        )}
      </div>
    </form>
  )
}
