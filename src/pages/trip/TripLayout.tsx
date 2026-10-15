import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useOutletContext, useParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { getTrip, listMembers, listReceipts } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useLoad } from '../../hooks/useLoad'
import { formatDateRange } from '../../lib/format'
import { ROLE_LABEL, type Member, type Receipt, type Role, type Trip } from '../../lib/types'
import { BackLink, Empty, ErrorBox, Loading } from '../../components/ui'

export interface TripContext {
  trip: Trip
  role: Role | null
  members: Member[]
  /** 發票有變動（自己或其他成員）時會加一，子頁面用它當作重新載入的依據 */
  version: number
  bump: () => void
  reloadTrip: () => Promise<void>
  reloadMembers: () => Promise<void>
  /** 載入這個旅程的發票（並記住 id，用來判斷即時同步的刪除事件是否與這個旅程有關） */
  loadReceipts: () => Promise<Receipt[]>
}

export function useTrip() {
  return useOutletContext<TripContext>()
}

const TABS = [
  { path: '', label: '發票', icon: '🧾' },
  { path: 'stats', label: '統計', icon: '📈' },
  { path: 'members', label: '成員', icon: '👥' },
  { path: 'settings', label: '旅程設定', icon: '✏️' },
]

/** 單一旅程的共用版面：標題、分頁、即時同步 */
export function TripLayout() {
  const { tripId = '' } = useParams()
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [version, setVersion] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const knownIds = useRef(new Set<string>())

  const tripQ = useLoad(() => getTrip(tripId), [tripId])
  const membersQ = useLoad(() => listMembers(tripId), [tripId])

  const bump = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setVersion((v) => v + 1), 250)
  }, [])

  // 即時同步：其他成員新增、修改、刪除發票或調整成員時，自動更新畫面
  useEffect(() => {
    const channel = supabase
      .channel(`trip-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts', filter: `trip_id=eq.${tripId}` }, bump)
      // 刪除事件無法依旅程篩選，只在刪掉的是畫面上的發票時才重新載入
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'receipts' }, (payload: { old?: { id?: string } }) => {
        if (payload.old?.id && knownIds.current.has(payload.old.id)) bump()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter: `trip_id=eq.${tripId}` }, () => {
        membersQ.reload()
        tripQ.reload()
      })
      .subscribe()
    // 手機切回 App 時（即時連線可能在背景時中斷），重新整理一次
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      bump()
      membersQ.reload()
      tripQ.reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, bump])

  if (tripQ.loading && !tripQ.data) return <Loading />
  if (tripQ.error) return <ErrorBox>讀取旅程失敗：{tripQ.error}</ErrorBox>
  if (!tripQ.data)
    return (
      <div>
        <BackLink to="/">旅程列表</BackLink>
        <Empty icon="🔒" title="找不到這個旅程">
          旅程可能已被刪除，或你已不是成員。
        </Empty>
      </div>
    )

  const trip = tripQ.data
  const members = membersQ.data ?? []
  const role = members.find((m) => m.user_id === user?.id)?.role ?? (trip.owner_id === user?.id ? 'owner' : null)
  const base = `/trips/${trip.id}`
  const sub = pathname.slice(base.length).replace(/^\//, '')
  const focus = sub.startsWith('receipts') || sub.startsWith('scan')

  const loadReceipts = async () => {
    const list = await listReceipts(trip.id)
    knownIds.current = new Set(list.map((r) => r.id))
    return list
  }
  const ctx: TripContext = { trip, role, members, version, bump, reloadTrip: tripQ.reload, reloadMembers: membersQ.reload, loadReceipts }

  return (
    <div>
      {focus ? (
        <BackLink to={base}>{trip.name}</BackLink>
      ) : (
        <>
          <BackLink to="/">旅程列表</BackLink>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-bold text-slate-900 md:text-2xl">{trip.name}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {formatDateRange(trip.start_date, trip.end_date)}
                {trip.country && ` · ${trip.country}`} · {trip.default_currency}
                {role && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{ROLE_LABEL[role]}</span>}
              </p>
            </div>
          </div>
          <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0 md:mb-6" aria-label="旅程分頁">
            {TABS.map((t) => {
              const active = t.path === '' ? sub === '' : sub.startsWith(t.path)
              return (
                <Link
                  key={t.path}
                  to={t.path ? `${base}/${t.path}` : base}
                  aria-current={active ? 'page' : undefined}
                  className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
                    active ? 'border-teal-600 font-semibold text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span aria-hidden className="mr-1">
                    {t.icon}
                  </span>
                  {t.label}
                </Link>
              )
            })}
          </nav>
        </>
      )}
      <Outlet context={ctx} />
    </div>
  )
}
