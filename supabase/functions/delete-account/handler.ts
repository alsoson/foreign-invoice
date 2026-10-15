// delete-account：刪除自己的帳號（App Store 上架必須提供）
//
// 1. 自己擁有、且還有其他成員的旅程 → 拒絕，請先轉讓（回傳 409 與旅程名稱）
// 2. 刪除自己擁有的旅程（只有自己一人，發票等資料會一併刪除）
// 3. 刪除登入帳號；profiles、成員資格會自動刪除，別人旅程裡自己新增的發票保留（新增者變成空白）
import { bearer, corsHeaders, json, type Deps } from '../_shared/http.ts'

export function createHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

    const url = deps.env('SUPABASE_URL')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return json({ error: 'server_misconfigured' }, 500)
    const admin = deps.createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

    const token = bearer(req)
    if (!token) return json({ error: 'unauthorized' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userErr || !user?.id) return json({ error: 'unauthorized' }, 401)

    const body = await req.json().catch(() => ({}))
    if (body?.confirm !== 'DELETE') return json({ error: 'confirmation_required' }, 400)

    // 在同一個交易中鎖住、檢查並刪除只有自己的旅程（避免檢查後有人剛好加入）
    const { data: r, error: e1 } = await admin.rpc('delete_solo_trips', { p_user: user.id })
    if (e1) return json({ error: 'db_error', message: e1.message }, 500)
    if (r?.status === 'must_transfer') return json({ error: 'must_transfer_trips', trips: r.trips }, 409)
    const deleted = r?.deleted ?? 0

    const { error: e4 } = await admin.auth.admin.deleteUser(user.id)
    if (e4) return json({ error: 'delete_failed', message: e4.message }, 500)
    return json({ ok: true, deleted_trips: deleted })
  }
}
