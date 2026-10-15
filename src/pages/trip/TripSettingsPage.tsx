import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTrip } from './TripLayout'
import { deleteTrip, errorMessage, listProviders, updateTrip } from '../../lib/api'
import { useLoad } from '../../hooks/useLoad'
import { canEdit } from '../../lib/types'
import { TripForm } from '../../components/TripForm'
import { Card, ConfirmButton, ErrorBox, Notice } from '../../components/ui'

/** 編輯旅程資訊、刪除旅程 */
export function TripSettingsPage() {
  const { trip, role, reloadTrip } = useTrip()
  const navigate = useNavigate()
  const providers = useLoad(() => listProviders(), [])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = canEdit(role)

  return (
    <div className="max-w-4xl space-y-4 md:space-y-6">
      <Card>
        <h3 className="mb-3 font-semibold text-slate-900">旅程資訊</h3>
        {!editable && (
          <div className="mb-3">
            <Notice tone="slate">你是檢視者，只能查看旅程資訊。</Notice>
          </div>
        )}
        <TripForm
          key={trip.updated_at}
          initial={trip}
          providers={providers.data ?? []}
          submitLabel="儲存"
          disabled={!editable}
          onSubmit={async (input) => {
            setSaved(false)
            await updateTrip(trip.id, input)
            await reloadTrip()
            setSaved(true)
          }}
        />
        {saved && <p className="mt-2 text-sm text-teal-700">✓ 已儲存</p>}
      </Card>

      {role === 'owner' && (
        <Card className="ring-red-200">
          <h3 className="font-semibold text-red-700">刪除旅程</h3>
          <p className="mt-1 text-sm text-slate-600">旅程裡的所有發票、品項、成員與邀請連結都會一起刪除，而且無法復原。建議先匯出 Excel 備份。</p>
          <div className="mt-3">
            <ConfirmButton
              confirmText={`確定刪除「${trip.name}」？`}
              onConfirm={async () => {
                setError(null)
                try {
                  await deleteTrip(trip.id)
                  navigate('/', { replace: true })
                } catch (e) {
                  setError(errorMessage(e))
                }
              }}
            >
              🗑️ 刪除旅程
            </ConfirmButton>
          </div>
          <div className="mt-2">
            <ErrorBox>{error}</ErrorBox>
          </div>
        </Card>
      )}
    </div>
  )
}
