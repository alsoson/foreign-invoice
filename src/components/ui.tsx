/** 共用的小元件與樣式 */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Spinner } from './Spinner'

export const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-100'

export const btn = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 active:bg-teal-800 disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 active:bg-red-100 disabled:opacity-50',
  dangerSolid:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50',
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:p-5 ${className}`}>{children}</section>
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 md:mb-6">
      <h2 className="text-xl font-bold text-slate-900 md:text-2xl">{children}</h2>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
      {children}
    </p>
  )
}

export function Notice({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'teal' | 'slate' }) {
  const cls = { amber: 'bg-amber-50 text-amber-900', teal: 'bg-teal-50 text-teal-900', slate: 'bg-slate-100 text-slate-700' }[tone]
  return <div className={`rounded-lg p-3 text-sm ${cls}`}>{children}</div>
}

export function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 md:p-12">
      <p className="text-3xl">{icon}</p>
      <p className="mt-2 font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm">{children}</div>}
    </div>
  )
}

export function Field({ label, children, className = '', hint }: { label: string; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <label className={`block text-sm text-slate-700 ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

/** 第一次按顯示「確定？」，第二次才執行，避免誤按（不用瀏覽器的 confirm 對話框） */
export function ConfirmButton({
  children,
  confirmText,
  onConfirm,
  className = btn.danger,
  disabled,
}: {
  children: ReactNode
  confirmText: string
  onConfirm: () => void | Promise<void>
  className?: string
  disabled?: boolean
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!asking)
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    )
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-700">{confirmText}</span>
      <button
        type="button"
        className={btn.dangerSolid}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } finally {
            setBusy(false)
            setAsking(false)
          }
        }}
      >
        {busy ? '處理中…' : '確定'}
      </button>
      <button type="button" className={btn.secondary} onClick={() => setAsking(false)}>
        取消
      </button>
    </span>
  )
}

/** 只顯示 Google 帳號的頭像網址，避免成員把頭像改成自己的伺服器來記錄別人的 IP */
function safeAvatar(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(u.hostname) ? url : null
  } catch {
    return null
  }
}

export function Avatar({ name, url: rawUrl, size = 'h-8 w-8' }: { name: string; url?: string | null; size?: string }) {
  const url = safeAvatar(rawUrl)
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover`} referrerPolicy="no-referrer" />
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-medium text-white`}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700">
      ← {children}
    </Link>
  )
}

/** 選項按鈕組（類別、付款方式等） */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  disabled,
  name,
}: {
  options: { id: T; label: string; icon?: string }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
  name: string
}) {
  return (
    <div role="radiogroup" aria-label={name} className="mt-1 flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-3 py-1.5 text-sm ring-1 transition ${
            value === o.id ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
          }`}
        >
          {o.icon && <span className="mr-1">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  )
}
