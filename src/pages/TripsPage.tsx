import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useProfile } from '../auth/ProfileProvider'
import { createTrip, listTrips, myRoles, tripSummaries } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import { formatDateRange, formatMoney } from '../lib/format'
import { ROLE_LABEL } from '../lib/types'
import { TripForm } from '../components/TripForm'
import { btn, Card, Empty, ErrorBox, Loading, PageTitle } from '../components/ui'

/** 旅程列表：我建立的＋別人分享給我的，顯示發票張數與各幣別總額 */
export function TripsPage() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)

  const { data, error, loading } = useLoad(async () => {
    const [trips, sums, roles] = await Promise.all([listTrips(), tripSummaries(), user ? myRoles(user.id) : Promise.resolve({})])
    return { trips, sums, roles: roles as Record<string, keyof typeof ROLE_LABEL> }
  }, [user?.id])

  return (
    <div>
      <PageTitle
        actions={
          <>
            <Link to="/join" className={btn.secondary}>
              🔑 輸入邀請碼
            </Link>
            <button type="button" onClick={() => setShowForm((v) => !v)} className={btn.primary}>
              {showForm ? '取消' : '＋ 新增旅程'}
            </button>
          </>
        }
      >
        我的旅程
      </PageTitle>

      {showForm && user && (
        <Card className="mb-4 md:mb-6">
          <TripForm
            defaultCurrency={profile?.default_currency === 'TWD' ? 'JPY' : (profile?.default_currency ?? 'JPY')}
            submitLabel="建立旅程"
            onCancel={() => setShowForm(false)}
            onSubmit={async (input) => {
              const trip = await createTrip(user.id, input)
              navigate(`/trips/${trip.id}`)
            }}
          />
        </Card>
      )}

      <ErrorBox>{error && `讀取失敗：${error}`}</ErrorBox>
      {loading && !data && <Loading />}

      {data?.trips.length === 0 && !showForm && (
        <Empty icon="🧳" title="還沒有旅程">
          按「新增旅程」開始記錄，或用朋友給的邀請碼加入
        </Empty>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-3">
        {data?.trips.map((t) => {
          const sums = data.sums.filter((s) => s.trip_id === t.id)
          const count = sums.reduce((n, s) => n + s.receipt_count, 0)
          const role = data.roles[t.id]
          return (
            <li key={t.id}>
              <Link
                to={`/trips/${t.id}`}
                className="block h-full rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-teal-300 md:p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words font-semibold text-slate-900">{t.name}</p>
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t.default_currency}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {formatDateRange(t.start_date, t.end_date)}
                  {t.country && ` · ${t.country}`}
                </p>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                  <div className="text-sm">
                    {count === 0 ? (
                      <span className="text-slate-400">尚無發票</span>
                    ) : (
                      <>
                        <span className="text-slate-500">{count} 張發票</span>
                        {sums.map((s) => (
                          <span key={s.currency} className="block font-semibold text-slate-900">
                            {formatMoney(s.total, s.currency)}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                  {role && role !== 'owner' && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">分享・{ROLE_LABEL[role]}</span>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
