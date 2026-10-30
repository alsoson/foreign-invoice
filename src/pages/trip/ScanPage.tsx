import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useTrip } from './TripLayout'
import { useAuth } from '../../auth/AuthProvider'
import { editableTrips, errorMessage, markScanLog, saveReceipt, setDefaultTrip } from '../../lib/api'
import { useProfile } from '../../auth/ProfileProvider'
import { useLoad } from '../../hooks/useLoad'
import { ATTEMPT_TEXT, SCAN_ERROR_TEXT, ScanFailed, compressImage, loadProviderOptions, scanReceipt, type Attempt, type CompressedImage, type ScanResponse } from '../../lib/scan'
import { canEdit, CATEGORY_MAP, PAYMENT_LABEL, type ReceiptDraft, type Trip } from '../../lib/types'
import { ReceiptForm, countChangedFields, draftToInput, emptyDraft, emptyItem } from '../../components/ReceiptForm'
import { btn, Card, ErrorBox, Field, inputClass, Notice } from '../../components/ui'
import { Spinner } from '../../components/Spinner'
import { formatMoney } from '../../lib/format'

type Phase =
  | { kind: 'pick' }
  | { kind: 'scanning'; label: string }
  | { kind: 'result'; draft: ReceiptDraft; scans: { res: ScanResponse; draft: ReceiptDraft }[]; formKey: number }
  | { kind: 'compare'; a: ScanResponse; b: ScanResponse }
  | { kind: 'error'; message: string; attempts: Attempt[] }

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function draftFromScan(res: ScanResponse, trip: Trip, paidBy: string): ReceiptDraft {
  const base = emptyDraft(trip, paidBy)
  const r = res.result
  return {
    ...base,
    receipt_date: r.receipt_date ?? base.receipt_date,
    store_name_original: s(r.store_name_original),
    store_name_translated: s(r.store_name_translated),
    category: r.category,
    currency: r.currency ?? trip.default_currency,
    amount: s(r.amount),
    payment_method: r.payment_method,
    raw_text: s(r.raw_text),
    items: r.items.map((i) => ({ ...emptyItem(), name_original: s(i.name_original), name_translated: s(i.name_translated), quantity: s(i.quantity), unit_price: s(i.unit_price), subtotal: s(i.subtotal) })),
  }
}

/** 拍照辨識：拍照 → AI 辨識＋翻譯 → 確認修正 → 存檔。照片不會儲存。 */
export function ScanPage() {
  const { trip, role, members, bump } = useTrip()
  const { user } = useAuth()
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<CompressedImage | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const [choice, setChoice] = useState('') // '' = 自動
  const [compare, setCompare] = useState(false)
  const [compareB, setCompareB] = useState('')
  const [rescanWith, setRescanWith] = useState('')
  const opts = useLoad(() => loadProviderOptions(trip.id), [trip.id])
  const { profile, reloadProfile } = useProfile()
  const trips = useLoad(() => (user ? editableTrips(user.id) : Promise.resolve([])), [user?.id])
  const [defaultBusy, setDefaultBusy] = useState(false)
  const [defaultError, setDefaultError] = useState<string | null>(null)
  const isDefault = profile?.default_trip_id === trip.id

  async function toggleDefault() {
    if (!user) return
    setDefaultBusy(true)
    setDefaultError(null)
    try {
      await setDefaultTrip(user.id, isDefault ? null : trip.id)
      await reloadProfile()
    } catch (e) {
      setDefaultError(errorMessage(e))
    } finally {
      setDefaultBusy(false)
    }
  }

  const providers = (opts.data?.providers ?? []).filter((p) => p.enabled)
  // 沒設定金鑰的 AI 不顯示給使用者（管理員到「AI 管理」頁看）
  const listed = providers.filter((p) => p.configured)
  const usable = listed.filter((p) => p.remaining_today !== 0)
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.display_name ?? id

  if (!canEdit(role)) return <Notice>你是檢視者，不能新增發票。</Notice>

  async function onFile(file: File | undefined) {
    if (!file) return
    setPhase({ kind: 'scanning', label: '處理照片中…' })
    let img: CompressedImage
    try {
      img = await compressImage(file)
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message, attempts: [] })
      return
    }
    setImage(img)
    if (compare) await runCompare(img)
    else await run(img, choice)
  }

  async function run(img: CompressedImage, provider: string, previous: { res: ScanResponse; draft: ReceiptDraft }[] = []) {
    setPhase({ kind: 'scanning', label: provider ? `${nameOf(provider)} 辨識中…` : 'AI 辨識中…' })
    try {
      const res = await scanReceipt(trip.id, img, provider)
      const draft = draftFromScan(res, trip, user?.id ?? '')
      setPhase({ kind: 'result', draft, scans: [...previous, { res, draft }], formKey: Date.now() })
      setRescanWith('')
    } catch (e) {
      const f = e instanceof ScanFailed ? e : new ScanFailed('network')
      setPhase({ kind: 'error', message: SCAN_ERROR_TEXT[f.code] ?? `辨識失敗（${f.code}）`, attempts: f.attempts })
    }
  }

  async function runCompare(img: CompressedImage) {
    const a = choice || usable[0]?.id
    const b = compareB || usable.find((p) => p.id !== a)?.id
    if (!a || !b || a === b) {
      setPhase({ kind: 'error', message: '比對模式需要兩個不同、可用的 AI。', attempts: [] })
      return
    }
    setPhase({ kind: 'scanning', label: `${nameOf(a)} 與 ${nameOf(b)} 同時辨識中…` })
    const [ra, rb] = await Promise.allSettled([scanReceipt(trip.id, img, a), scanReceipt(trip.id, img, b)])
    if (ra.status === 'fulfilled' && rb.status === 'fulfilled') setPhase({ kind: 'compare', a: ra.value, b: rb.value })
    else if (ra.status === 'fulfilled' || rb.status === 'fulfilled') {
      const ok = (ra.status === 'fulfilled' ? ra.value : (rb as PromiseFulfilledResult<ScanResponse>).value)!
      const bad = (ra.status === 'rejected' ? ra.reason : (rb as PromiseRejectedResult).reason) as ScanFailed
      const draft = draftFromScan(ok, trip, user?.id ?? '')
      setPhase({ kind: 'result', draft, scans: [{ res: ok, draft }], formKey: Date.now() })
      setRescanWith('')
      void bad
    } else {
      const f = ra.reason as ScanFailed
      setPhase({ kind: 'error', message: SCAN_ERROR_TEXT[f.code] ?? '兩個 AI 都辨識失敗了。', attempts: [...(f.attempts ?? []), ...((rb.reason as ScanFailed).attempts ?? [])] })
    }
  }

  async function save(d: ReceiptDraft, scans: { res: ScanResponse; draft: ReceiptDraft }[]) {
    const last = scans[scans.length - 1].res
    const { receipt, items } = draftToInput(d, trip.id)
    const id = await saveReceipt({ ...receipt, ai_provider: last.provider, ai_model: last.model }, items)
    // 回填辨識紀錄：使用者改了幾個欄位，用來比較各家 AI 的準確度
    await Promise.all(scans.filter((x) => x.res.log_id).map((x) => markScanLog(x.res.log_id!, id, countChangedFields(x.draft, d)).catch(() => {})))
    bump()
    navigate(`/trips/${trip.id}`, { replace: true })
  }

  const reset = () => {
    setImage(null)
    setPhase({ kind: 'pick' })
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 className="text-xl font-bold text-slate-900 md:text-2xl">拍照辨識</h2>
        {phase.kind === 'pick' && (
          <div className="flex w-full min-w-0 items-end gap-2 sm:w-auto">
            <Field label="旅程" className="min-w-0 flex-1 sm:w-64 sm:flex-none">
              <select
                className={inputClass}
                value={trip.id}
                aria-label="切換旅程"
                onChange={(e) => {
                  reset()
                  navigate(`/trips/${e.target.value}/scan`, { replace: true })
                }}
              >
                {(trips.data?.some((t) => t.id === trip.id) ? trips.data : [trip, ...(trips.data ?? [])]).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === profile?.default_trip_id ? '★ ' : ''}
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              className={(isDefault ? btn.secondary + ' text-teal-700' : btn.secondary) + ' shrink-0 whitespace-nowrap'}
              disabled={defaultBusy || !profile}
              aria-pressed={isDefault}
              onClick={toggleDefault}
              title={isDefault ? '取消預設旅程' : '打開 App 時直接進到這個旅程的拍照辨識'}
            >
              {defaultBusy ? '儲存中…' : isDefault ? '★ 預設' : '☆ 設為預設'}
            </button>
          </div>
        )}
      </div>
      <ErrorBox>{defaultError}</ErrorBox>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} data-testid="camera-input" />
      <input ref={albumRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} data-testid="album-input" />

      <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
        {/* 左側：照片與 AI 選擇 */}
        <div className="space-y-4">
          {image ? (
            <Card className="p-2 md:p-2">
              <img src={image.dataUrl} alt="收據照片" className="max-h-80 w-full rounded-lg object-contain lg:max-h-[70vh]" />
              <p className="mt-2 text-center text-xs text-slate-500">照片只用於辨識，不會儲存</p>
            </Card>
          ) : null}

          {phase.kind === 'pick' && (
            <Card>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={btn.primary + ' flex-col py-6 text-base'} onClick={() => cameraRef.current?.click()}>
                  <span className="text-3xl">📷</span>拍照
                </button>
                <button type="button" className={btn.secondary + ' flex-col py-6 text-base'} onClick={() => albumRef.current?.click()}>
                  <span className="text-3xl">🖼️</span>從相簿選擇
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <Field label="使用的 AI">
                  <select className={inputClass} value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="使用的 AI">
                    <option value="">自動（依預設順序，失敗自動換下一家）</option>
                    {listed.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.remaining_today === 0}>
                        {p.display_name}
                        {p.remaining_today === 0 ? '（今日已達上限）' : p.remaining_today !== null ? `（今日剩 ${p.remaining_today} 次）` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                {usable.length >= 2 && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                    比對模式：同時用兩個 AI 辨識，挑選正確的欄位
                  </label>
                )}
                {compare && (
                  <Field label="第二個 AI">
                    <select className={inputClass} value={compareB} onChange={(e) => setCompareB(e.target.value)} aria-label="第二個 AI">
                      <option value="">自動選擇</option>
                      {usable
                        .filter((p) => p.id !== (choice || usable[0]?.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.display_name}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {opts.data && usable.length === 0 && <Notice>目前沒有可用的 AI 服務。請管理員到「AI 管理」設定金鑰，或先用手動輸入。</Notice>}
                {opts.error && <Notice>無法取得 AI 清單（辨識服務可能尚未部署）：{opts.error}</Notice>}
              </div>
              <p className="mt-4 text-center text-sm">
                <Link to={`/trips/${trip.id}/receipts/new`} className="text-slate-500 underline">
                  改用手動輸入
                </Link>
              </p>
            </Card>
          )}

          {phase.kind === 'scanning' && (
            <Card>
              <div className="flex flex-col items-center gap-3 py-6" role="status">
                <Spinner />
                <p className="font-medium text-slate-700">{phase.label}</p>
                <p className="text-xs text-slate-500">通常需要 5～30 秒</p>
              </div>
            </Card>
          )}

          {phase.kind === 'error' && (
            <Card>
              <ErrorBox>{phase.message}</ErrorBox>
              <AttemptList attempts={phase.attempts} nameOf={nameOf} />
              <div className="mt-4 flex flex-wrap gap-2">
                {image && (
                  <button type="button" className={btn.primary} onClick={() => run(image, choice)}>
                    再試一次
                  </button>
                )}
                <button type="button" className={btn.secondary} onClick={reset}>
                  重新拍照
                </button>
                <Link to={`/trips/${trip.id}/receipts/new`} className={btn.secondary}>
                  手動輸入
                </Link>
              </div>
            </Card>
          )}

          {phase.kind === 'result' && image && (
            <Card>
              {(() => {
                const last = phase.scans[phase.scans.length - 1].res
                return (
                  <>
                    <p className="text-sm text-slate-700" data-testid="scan-source">
                      ✨ 由 <b>{last.provider_name}</b> 辨識（{(last.duration_ms / 1000).toFixed(1)} 秒）
                    </p>
                    {last.is_fallback && (
                      <p className="mt-1 text-xs text-amber-700">
                        已自動備援：
                        {last.attempts
                          .filter((a) => a.status !== 'success')
                          .map((a) => `${nameOf(a.provider)}${ATTEMPT_TEXT[a.status] ?? a.status}`)
                          .join('、')}
                      </p>
                    )}
                  </>
                )
              })()}
              <p className="mt-2 text-xs text-slate-500">請確認下方內容，有錯可以直接修改，或換一個 AI 重新辨識。</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="換一個 AI 重新辨識" className="min-w-0 flex-1">
                  <select className={inputClass} value={rescanWith} onChange={(e) => setRescanWith(e.target.value)} aria-label="換一個 AI 重新辨識">
                    <option value="">選擇 AI</option>
                    {usable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                        {phase.scans.some((x) => x.res.provider === p.id) ? '（已用過）' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="button" className={btn.secondary} disabled={!rescanWith} onClick={() => run(image, rescanWith, phase.scans)}>
                  重新辨識
                </button>
              </div>
              <button type="button" className={btn.ghost + ' mt-2'} onClick={reset}>
                📷 重新拍照
              </button>
            </Card>
          )}
        </div>

        {/* 右側：辨識結果 */}
        <div>
          {phase.kind === 'result' && (
            <Card>
              <ReceiptForm key={phase.formKey} initial={phase.draft} members={members} submitLabel="確認並儲存" onSubmit={(d) => save(d, phase.scans)} />
            </Card>
          )}
          {phase.kind === 'compare' && (
            <CompareView
              a={phase.a}
              b={phase.b}
              trip={trip}
              paidBy={user?.id ?? ''}
              onUse={(draft) => setPhase({ kind: 'result', draft, scans: [{ res: phase.a, draft: draftFromScan(phase.a, trip, user?.id ?? '') }, { res: phase.b, draft: draftFromScan(phase.b, trip, user?.id ?? '') }], formKey: Date.now() })}
            />
          )}
          {phase.kind === 'pick' && (
            <div className="hidden lg:block">
              <Notice tone="slate">
                <p className="font-medium">拍照小技巧</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  <li>把收據攤平，整張都拍進畫面</li>
                  <li>光線充足、避免反光和陰影</li>
                  <li>長收據可以分兩次拍，再手動合併</li>
                </ul>
              </Notice>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AttemptList({ attempts, nameOf }: { attempts: Attempt[]; nameOf: (id: string) => string }) {
  if (!attempts.length) return null
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {attempts.map((a, i) => (
        <li key={i} className="text-slate-600">
          <b>{nameOf(a.provider)}</b>：{ATTEMPT_TEXT[a.status] ?? a.status}
          {a.message && <span className="block text-xs text-slate-400">{a.message}</span>}
        </li>
      ))}
    </ul>
  )
}

type FieldKey = 'receipt_date' | 'store_name_original' | 'store_name_translated' | 'category' | 'currency' | 'amount' | 'payment_method' | 'items'
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'receipt_date', label: '日期' },
  { key: 'store_name_original', label: '店名（原文）' },
  { key: 'store_name_translated', label: '店名（中文）' },
  { key: 'category', label: '類別' },
  { key: 'currency', label: '幣別' },
  { key: 'amount', label: '總金額' },
  { key: 'payment_method', label: '付款方式' },
  { key: 'items', label: '品項' },
]

/** 比對模式：兩家 AI 的結果並排，不一致的欄位標成黃色，讓使用者逐欄挑選 */
function CompareView({ a, b, trip, paidBy, onUse }: { a: ScanResponse; b: ScanResponse; trip: Trip; paidBy: string; onUse: (d: ReceiptDraft) => void }) {
  const da = draftFromScan(a, trip, paidBy)
  const db = draftFromScan(b, trip, paidBy)
  const show = (d: ReceiptDraft, k: FieldKey): string => {
    if (k === 'items') return d.items.length ? `${d.items.length} 項：${d.items.slice(0, 3).map((i) => i.name_translated || i.name_original).join('、')}${d.items.length > 3 ? '…' : ''}` : '（無）'
    if (k === 'category') return CATEGORY_MAP[d.category]?.label ?? d.category
    if (k === 'payment_method') return PAYMENT_LABEL[d.payment_method] ?? d.payment_method
    if (k === 'amount') return d.amount ? formatMoney(Number(d.amount), d.currency) : '（無）'
    return String(d[k] || '（無）')
  }
  const same = (k: FieldKey) => (k === 'items' ? JSON.stringify(draftToInput(da, '').items) === JSON.stringify(draftToInput(db, '').items) : String(da[k]) === String(db[k]))
  const [pick, setPick] = useState<Record<FieldKey, 'a' | 'b'>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, 'a'])) as Record<FieldKey, 'a' | 'b'>)

  function use() {
    const out: ReceiptDraft = { ...da }
    for (const f of FIELDS) {
      const src = pick[f.key] === 'a' ? da : db
      if (f.key === 'items') out.items = src.items
      else (out as unknown as Record<string, unknown>)[f.key] = src[f.key]
    }
    out.raw_text = pick.items === 'a' ? da.raw_text : db.raw_text
    onUse(out)
  }

  const diffCount = FIELDS.filter((f) => !same(f.key)).length
  return (
    <Card>
      <h3 className="font-semibold text-slate-900">比對結果</h3>
      <p className="mt-1 text-sm text-slate-600">{diffCount ? `有 ${diffCount} 個欄位不一致（黃色），請點選正確的那一個。` : '兩個 AI 的結果完全一致。'}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2 pr-2 font-normal">欄位</th>
              <th className="py-2 pr-2 font-normal">{a.provider_name}</th>
              <th className="py-2 font-normal">{b.provider_name}</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => {
              const diff = !same(f.key)
              return (
                <tr key={f.key} className={`border-t border-slate-100 ${diff ? 'bg-amber-50' : ''}`} data-diff={diff || undefined}>
                  <td className="py-2 pr-2 align-top text-slate-600">{f.label}</td>
                  {(['a', 'b'] as const).map((side) => (
                    <td key={side} className="py-2 pr-2 align-top">
                      {diff ? (
                        <label className="flex cursor-pointer items-start gap-2">
                          <input type="radio" name={`pick-${f.key}`} className="mt-0.5 accent-teal-600" checked={pick[f.key] === side} onChange={() => setPick((p) => ({ ...p, [f.key]: side }))} />
                          <span className="break-words">{show(side === 'a' ? da : db, f.key)}</span>
                        </label>
                      ) : (
                        <span className="break-words text-slate-800">{show(side === 'a' ? da : db, f.key)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className={btn.primary + ' mt-4 w-full md:w-auto md:px-8'} onClick={use}>
        使用選擇的結果
      </button>
    </Card>
  )
}

