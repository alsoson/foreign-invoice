import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { acceptInvite, errorMessage, previewInvite, type InvitePreview } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { formatDateRange, formatDateTime } from '../lib/format'
import { ROLE_LABEL } from '../lib/types'
import { BackLink, btn, Card, ErrorBox, inputClass, Loading } from '../components/ui'

const STATUS_TEXT: Record<string, string> = {
  not_found: '找不到這個邀請碼，請確認有沒有打錯。',
  expired: '這個邀請連結已經過期，請向旅程擁有者索取新的連結。',
  revoked: '這個邀請連結已被作廢，請向旅程擁有者索取新的連結。',
  used_up: '這個邀請連結的使用次數已經用完，請向旅程擁有者索取新的連結。',
  too_many_attempts: '輸入錯誤太多次，請 1 小時後再試。',
  not_logged_in: '請先登入。',
}

/** 透過邀請連結（#/join/代碼）或手動輸入邀請碼加入旅程 */
export function JoinPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState('')

  if (!code) {
    const submit = (e: FormEvent) => {
      e.preventDefault()
      const c = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      if (c) navigate(`/join/${c}`)
    }
    return (
      <div className="mx-auto max-w-md">
        <BackLink to="/">旅程列表</BackLink>
        <Card>
          <h2 className="text-xl font-bold text-slate-900">輸入邀請碼</h2>
          <p className="mt-1 text-sm text-slate-600">輸入朋友給你的 8 碼邀請碼，加入他的旅程。</p>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              className={inputClass + ' text-center font-mono text-2xl tracking-[0.3em] uppercase'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ABCD2345"
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
              aria-label="邀請碼"
              required
            />
            <button type="submit" className={btn.primary + ' w-full py-3'}>
              下一步
            </button>
          </form>
        </Card>
      </div>
    )
  }

  return <JoinWithCode code={code} />
}

function JoinWithCode({ code }: { code: string }) {
  const navigate = useNavigate()
  const { data, error, loading } = useLoad<InvitePreview>(() => previewInvite(code), [code])
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  async function join() {
    setBusy(true)
    setJoinError(null)
    try {
      const r = await acceptInvite(code)
      if ((r.status === 'joined' || r.status === 'already_member') && r.trip_id) navigate(`/trips/${r.trip_id}`, { replace: true })
      else setJoinError(STATUS_TEXT[r.status] ?? `無法加入（${r.status}）`)
    } catch (e) {
      setJoinError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <BackLink to="/">旅程列表</BackLink>
      <Card>
        {loading && !data && <Loading />}
        <ErrorBox>{error}</ErrorBox>
        {data?.status === 'valid' && (
          <div className="text-center">
            <p className="text-4xl">🧳</p>
            <p className="mt-2 text-sm text-slate-500">{data.inviter_name || '朋友'} 邀請你加入旅程</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">{data.trip_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{formatDateRange(data.start_date ?? null, data.end_date ?? null)}</p>
            <p className="mt-3 inline-block rounded-full bg-teal-50 px-3 py-1 text-sm text-teal-700">
              加入後的角色：{ROLE_LABEL[data.role ?? 'viewer']}
              {data.role === 'editor' ? '（可以新增、修改發票）' : '（只能查看）'}
            </p>
            {data.expires_at && <p className="mt-2 text-xs text-slate-400">邀請將於 {formatDateTime(data.expires_at)} 到期</p>}
            <button type="button" className={btn.primary + ' mt-5 w-full py-3'} onClick={join} disabled={busy}>
              {busy ? '加入中…' : '加入旅程'}
            </button>
            <div className="mt-3">
              <ErrorBox>{joinError}</ErrorBox>
            </div>
          </div>
        )}
        {data?.status === 'already_member' && (
          <div className="text-center">
            <p className="text-4xl">✅</p>
            <p className="mt-2 font-medium text-slate-900">你已經是這個旅程的成員了</p>
            <button type="button" className={btn.primary + ' mt-4 w-full'} onClick={() => navigate(`/trips/${data.trip_id}`, { replace: true })}>
              前往旅程
            </button>
          </div>
        )}
        {data && !['valid', 'already_member'].includes(data.status) && (
          <div className="text-center">
            <p className="text-4xl">😕</p>
            <p className="mt-2 text-slate-700">{STATUS_TEXT[data.status] ?? '無法使用這個邀請連結。'}</p>
            <button type="button" className={btn.secondary + ' mt-4'} onClick={() => navigate('/join')}>
              重新輸入邀請碼
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
