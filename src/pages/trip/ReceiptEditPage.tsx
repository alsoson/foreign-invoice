import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { useTrip } from './TripLayout'
import { deleteReceipt, getReceipt, listTrips, myRoles, saveReceipt } from '../../lib/api'
import { useLoad } from '../../hooks/useLoad'
import { formatDateTime } from '../../lib/format'
import { canEdit } from '../../lib/types'
import { ReceiptForm, draftFromReceipt, draftToInput, emptyDraft } from '../../components/ReceiptForm'
import { Card, ConfirmButton, Empty, ErrorBox, Loading, Notice } from '../../components/ui'

/** 手動新增發票，或檢視／修改／刪除既有發票 */
export function ReceiptEditPage() {
  const { receiptId } = useParams()
  const { trip, role, members, bump } = useTrip()
  const { user } = useAuth()
  const navigate = useNavigate()
  const editable = canEdit(role)
  const [targetTrip, setTargetTrip] = useState(trip.id)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const existing = useLoad(() => (receiptId ? getReceipt(receiptId) : Promise.resolve(null)), [receiptId])
  // 可以把發票移過去的旅程：自己是擁有者或編輯者的
  const tripOptions = useLoad(async () => {
    if (!receiptId || !user || !editable) return []
    const [trips, roles] = await Promise.all([listTrips(), myRoles(user.id)])
    return trips.filter((t) => canEdit(roles[t.id])).map((t) => ({ id: t.id, name: t.name }))
  }, [receiptId, user?.id, editable])

  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? '已離開的成員'

  if (receiptId && existing.loading && !existing.data) return <Loading />
  if (receiptId && existing.error) return <ErrorBox>讀取發票失敗：{existing.error}</ErrorBox>
  if (receiptId && !existing.data) return <Empty icon="🔍" title="找不到這張發票">可能已被其他成員刪除。</Empty>
  if (!receiptId && !editable) return <Notice>你是檢視者，不能新增發票。</Notice>

  const rec = existing.data?.receipt
  // 網址上的旅程和發票實際所屬的旅程不同（例如發票已被移走）時，導到正確的旅程，避免存檔時又被移回來
  if (rec && rec.trip_id !== trip.id) return <Navigate to={`/trips/${rec.trip_id}/receipts/${rec.id}`} replace />
  const initial = rec ? draftFromReceipt(rec, existing.data!.items) : emptyDraft(trip, user?.id ?? '')

  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-slate-900 md:text-2xl">{rec ? (editable ? '編輯發票' : '發票內容') : '手動新增發票'}</h2>
      {rec && (
        <p className="mb-4 text-xs text-slate-500">
          由 {nameOf(rec.created_by)} 新增於 {formatDateTime(rec.created_at)}
          {rec.updated_by && ` · 最後由 ${nameOf(rec.updated_by)} 修改於 ${formatDateTime(rec.updated_at)}`}
          {rec.ai_provider && rec.ai_provider !== 'manual' && ` · AI 辨識：${rec.ai_provider}${rec.ai_model ? `（${rec.ai_model}）` : ''}`}
        </p>
      )}
      {!rec && <div className="mb-4" />}
      <Card>
        <ReceiptForm
          key={rec?.updated_at ?? 'new'}
          initial={initial}
          members={members}
          readOnly={!editable}
          submitLabel={rec ? '儲存修改' : '新增發票'}
          tripOptions={tripOptions.data ?? undefined}
          tripId={targetTrip}
          onTripChange={setTargetTrip}
          onSubmit={async (d) => {
            const { receipt, items } = draftToInput(d, targetTrip)
            await saveReceipt(rec ? { ...receipt, id: rec.id, expected_updated_at: rec.updated_at } : { ...receipt, ai_provider: 'manual' }, items)
            bump()
            navigate(`/trips/${targetTrip}`, { replace: !rec })
          }}
          footer={
            rec &&
            editable && (
              <ConfirmButton
                confirmText="確定刪除這張發票？"
                onConfirm={async () => {
                  setDeleteError(null)
                  try {
                    await deleteReceipt(rec.id)
                    bump()
                    navigate(`/trips/${trip.id}`, { replace: true })
                  } catch (e) {
                    setDeleteError(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                🗑️ 刪除
              </ConfirmButton>
            )
          }
        />
        <div className="mt-3">
          <ErrorBox>{deleteError}</ErrorBox>
        </div>
      </Card>
    </div>
  )
}
