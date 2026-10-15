import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { useTrip } from './TripLayout'
import { createInvite, errorMessage, inviteStatus, listInvites, removeMember, revokeInvite, setMemberRole, transferOwner } from '../../lib/api'
import { appBaseUrl } from '../../lib/supabase'
import { useLoad } from '../../hooks/useLoad'
import { formatDateTime } from '../../lib/format'
import { ROLE_LABEL, type Invite, type Member } from '../../lib/types'
import { Avatar, btn, Card, ConfirmButton, ErrorBox, Field, inputClass, Notice } from '../../components/ui'

export function inviteLink(code: string) {
  return `${appBaseUrl()}#/join/${code}`
}

/** 成員管理與邀請連結 */
export function MembersPage() {
  const { trip, role, members, reloadMembers } = useTrip()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isOwner = role === 'owner'
  const [error, setError] = useState<string | null>(null)

  // 進入成員頁時重新載入，確保看到最新加入的成員
  useEffect(() => {
    reloadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
      await reloadMembers()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="grid gap-4 md:gap-6 lg:grid-cols-2 lg:items-start">
      <Card>
        <h3 className="mb-3 font-semibold text-slate-900">成員（{members.length}）</h3>
        <ErrorBox>{error}</ErrorBox>
        <ul className="divide-y divide-slate-100">
          {members.map((m) => (
            <MemberRow
              key={m.user_id}
              m={m}
              isMe={m.user_id === user?.id}
              isOwner={isOwner}
              onRole={(r) => run(() => setMemberRole(trip.id, m.user_id, r))}
              onRemove={() => run(() => removeMember(trip.id, m.user_id))}
              onTransfer={() => run(() => transferOwner(trip.id, m.user_id))}
            />
          ))}
        </ul>
        {role && role !== 'owner' && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <ConfirmButton
              confirmText="確定退出這個旅程？"
              onConfirm={async () => {
                setError(null)
                try {
                  await removeMember(trip.id, user!.id)
                  navigate('/', { replace: true })
                } catch (e) {
                  setError(errorMessage(e))
                }
              }}
            >
              🚪 退出旅程
            </ConfirmButton>
          </div>
        )}
        <div className="mt-4 text-xs text-slate-500">
          <p>・擁有者：全部權限，可管理成員與刪除旅程</p>
          <p>・編輯者：可新增、修改、刪除發票與編輯旅程資訊</p>
          <p>・檢視者：只能查看與匯出</p>
        </div>
      </Card>

      {isOwner ? (
        <Invites tripId={trip.id} tripName={trip.name} />
      ) : (
        <Card>
          <h3 className="font-semibold text-slate-900">邀請朋友</h3>
          <p className="mt-1 text-sm text-slate-600">只有旅程擁有者可以產生邀請連結，請請擁有者邀請。</p>
        </Card>
      )}
    </div>
  )
}

function MemberRow({
  m,
  isMe,
  isOwner,
  onRole,
  onRemove,
  onTransfer,
}: {
  m: Member
  isMe: boolean
  isOwner: boolean
  onRole: (r: 'editor' | 'viewer') => void
  onRemove: () => void
  onTransfer: () => void
}) {
  const manageable = isOwner && m.role !== 'owner'
  return (
    <li className="py-3" aria-label={`成員 ${m.display_name}`}>
      <div className="flex items-center gap-3">
        <Avatar name={m.display_name} url={m.avatar_url} size="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">
            {m.display_name}
            {isMe && <span className="ml-1 text-xs text-slate-500">（我）</span>}
          </p>
          <p className="text-xs text-slate-500">{formatDateTime(m.joined_at)} 加入</p>
        </div>
        {manageable ? (
          <select aria-label={`${m.display_name} 的角色`} className={inputClass + ' mt-0 w-auto py-1.5 text-sm'} value={m.role} onChange={(e) => onRole(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">編輯者</option>
            <option value="viewer">檢視者</option>
          </select>
        ) : (
          <span className={`rounded-full px-2 py-0.5 text-xs ${m.role === 'owner' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-600'}`}>{ROLE_LABEL[m.role]}</span>
        )}
      </div>
      {manageable && (
        <div className="mt-2 flex flex-wrap gap-2 pl-13">
          <ConfirmButton className={btn.ghost + ' text-red-600'} confirmText={`移除 ${m.display_name}？`} onConfirm={onRemove}>
            移除
          </ConfirmButton>
          <ConfirmButton className={btn.ghost} confirmText={`把擁有者轉讓給 ${m.display_name}？你會變成編輯者。`} onConfirm={onTransfer}>
            轉讓擁有者
          </ConfirmButton>
        </div>
      )}
    </li>
  )
}

function Invites({ tripId, tripName }: { tripId: string; tripName: string }) {
  const invites = useLoad(() => listInvites(tripId), [tripId])
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [days, setDays] = useState(7)
  const [maxUses, setMaxUses] = useState<string>('10')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Invite | null>(null)
  const [showOld, setShowOld] = useState(false)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const inv = await createInvite(tripId, role, days, maxUses === '' ? null : Number(maxUses), label.trim())
      setFresh(inv)
      setLabel('')
      await invites.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const all = invites.data ?? []
  const active = all.filter((i) => inviteStatus(i) === 'valid')
  const old = all.filter((i) => inviteStatus(i) !== 'valid')

  return (
    <Card>
      <h3 className="font-semibold text-slate-900">邀請朋友加入</h3>
      <p className="mt-1 text-sm text-slate-600">產生邀請連結後用 LINE 等通訊軟體傳給朋友，對方用 Google 登入後就會自動加入。</p>
      <form onSubmit={create} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="角色">
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">編輯者</option>
            <option value="viewer">檢視者</option>
          </select>
        </Field>
        <Field label="有效期限">
          <select className={inputClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} 天
              </option>
            ))}
          </select>
        </Field>
        <Field label="可使用次數">
          <select className={inputClass} value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
            <option value="1">1 次</option>
            <option value="5">5 次</option>
            <option value="10">10 次</option>
            <option value="">不限</option>
          </select>
        </Field>
        <Field label="標籤（選填）">
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={50} placeholder="例如：家人群組" />
        </Field>
        <div className="col-span-2 sm:col-span-4">
          <button type="submit" className={btn.primary + ' w-full sm:w-auto'} disabled={busy}>
            {busy ? '產生中…' : '🔗 產生邀請連結'}
          </button>
        </div>
      </form>
      <div className="mt-3">
        <ErrorBox>{error || invites.error}</ErrorBox>
      </div>

      {fresh && (
        <div className="mt-4">
          <Notice tone="teal">
            <p className="font-semibold">邀請連結已產生，傳給朋友吧！</p>
            <ShareBox invite={fresh} tripName={tripName} />
          </Notice>
        </div>
      )}

      {active.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">有效的邀請（{active.length}）</h4>
          <ul className="space-y-2">
            {active.map((i) => (
              <li key={i.id} className="rounded-lg bg-slate-50 p-3" aria-label={`邀請 ${i.code}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-lg font-semibold tracking-widest text-slate-900">{i.code}</p>
                    <p className="text-xs text-slate-500">
                      {i.label && `${i.label} · `}
                      {ROLE_LABEL[i.role]} · 已使用 {i.used_count}
                      {i.max_uses !== null ? `／${i.max_uses}` : ''} 次 · {formatDateTime(i.expires_at)} 到期
                    </p>
                  </div>
                  <ConfirmButton
                    className={btn.ghost + ' text-red-600'}
                    confirmText="作廢這個連結？"
                    onConfirm={async () => {
                      await revokeInvite(i.id)
                      if (fresh?.id === i.id) setFresh(null)
                      await invites.reload()
                    }}
                  >
                    作廢
                  </ConfirmButton>
                </div>
                <ShareBox invite={i} tripName={tripName} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      {old.length > 0 && (
        <div className="mt-4">
          <button type="button" className="text-sm text-slate-500 underline" onClick={() => setShowOld((v) => !v)}>
            {showOld ? '隱藏' : '顯示'}已失效的邀請（{old.length}）
          </button>
          {showOld && (
            <ul className="mt-2 space-y-1 text-sm text-slate-500">
              {old.map((i) => (
                <li key={i.id}>
                  <span className="font-mono">{i.code}</span> · {{ revoked: '已作廢', expired: '已過期', used_up: '次數已用完', valid: '' }[inviteStatus(i)]}
                  {i.label && ` · ${i.label}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function ShareBox({ invite, tripName, compact }: { invite: Invite; tripName: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  const link = inviteLink(invite.code)
  const text = `邀請你加入旅程「${tripName}」一起記帳：\n${link}\n（或在 App 輸入邀請碼 ${invite.code}）`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      window.prompt('複製這個連結', link)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  async function share() {
    try {
      await navigator.share({ title: `加入旅程：${tripName}`, text })
    } catch {
      /* 使用者取消分享 */
    }
  }

  return (
    <div className={compact ? 'mt-2' : 'mt-2 space-y-2'}>
      {!compact && (
        <>
          <p className="break-all rounded bg-white/70 px-2 py-1 font-mono text-xs" data-testid="invite-link">
            {link}
          </p>
          <p>
            邀請碼：<span className="font-mono text-lg font-semibold tracking-widest">{invite.code}</span>
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" className={btn.secondary + ' py-1.5'} onClick={share}>
            📤 分享
          </button>
        )}
        <a className={btn.secondary + ' py-1.5 text-[#06C755]'} href={`https://line.me/R/share?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          💬 用 LINE 傳送
        </a>
        <button type="button" className={btn.secondary + ' py-1.5'} onClick={copy}>
          {copied ? '✓ 已複製' : '📋 複製連結'}
        </button>
      </div>
    </div>
  )
}
