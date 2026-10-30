// scan-receipt：照片 → AI 辨識＋翻譯 → 統一格式的 JSON
//
// POST body：
//   { action: 'providers', trip_id? }                       → 可用的 AI 清單（含今日剩餘次數）
//   { action: 'scan', trip_id, image, mime_type, provider?, exclude? }
//       provider 有指定：只用這一家（使用者自選或「換一個 AI 重新辨識」）
//       provider 沒指定：個人預設 → 旅程預設 → 系統預設 → 其餘依備援順序，失敗自動換下一家
//
// 照片只在記憶體中轉送給 AI，不會儲存。
import { ADAPTERS, ScanError, credentials, extractJson, normalize, type ProviderConfig } from '../_shared/ai.ts'
import { bearer, corsHeaders, json, type Deps } from '../_shared/http.ts'

const MAX_IMAGE_BASE64 = 7_000_000 // 約 5MB 的圖片
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const WINDOW_MS = 24 * 60 * 60 * 1000 // 每人每日上限以「最近 24 小時」計算
// 整個請求的時間上限：Edge Function 約 150 秒會被強制中斷，留一點餘裕給寫紀錄與回應
const DEADLINE_MS = 120_000
const MIN_ATTEMPT_MS = 5_000 // 剩下的時間少於這個就不再嘗試下一家

interface Attempt {
  provider: string
  status: string
  message?: string
}

export function createHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const deadline = Date.now() + DEADLINE_MS
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

    const url = deps.env('SUPABASE_URL')
    const serviceKey = deps.env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return json({ error: 'server_misconfigured' }, 500)
    const admin = deps.createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

    // ---------- 驗證使用者 ----------
    const token = bearer(req)
    if (!token) return json({ error: 'unauthorized' }, 401)
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    const user = userData?.user
    if (userErr || !user?.id) return json({ error: 'unauthorized' }, 401)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'invalid_body' }, 400)
    }
    const action = body.action ?? 'scan'
    const tripId = typeof body.trip_id === 'string' ? body.trip_id : null

    const { data: profile } = await admin.from('profiles').select('preferred_ai_provider, is_admin').eq('id', user.id).limit(1)
    const me = profile?.[0] ?? { preferred_ai_provider: null, is_admin: false }

    let trip: { default_currency: string; default_ai_provider: string | null } | null = null
    if (tripId) {
      const { data: mem } = await admin.from('trip_members').select('role').eq('trip_id', tripId).eq('user_id', user.id).limit(1)
      const role = mem?.[0]?.role
      if (!role) return json({ error: 'not_member' }, 403)
      if (action === 'scan' && role === 'viewer') return json({ error: 'viewer_cannot_scan' }, 403)
      const { data: t } = await admin.from('trips').select('default_currency, default_ai_provider').eq('id', tripId).limit(1)
      trip = t?.[0] ?? null
    } else if (action === 'scan') {
      return json({ error: 'trip_required' }, 400)
    }

    // ---------- 設定與使用量 ----------
    const { data: all, error: pErr } = await admin.from('ai_providers').select('id, display_name, adapter, model, enabled, fallback_order, is_default, daily_limit_per_user, timeout_seconds').order('fallback_order')
    if (pErr) return json({ error: 'db_error', message: pErr.message }, 500)
    const providers = (all ?? []) as ProviderConfig[]

    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const { data: logs } = await admin.from('ai_scan_logs').select('provider').eq('user_id', user.id).gte('created_at', since)
    const used: Record<string, number> = {}
    for (const l of logs ?? []) used[l.provider] = (used[l.provider] ?? 0) + 1
    const remaining = (p: ProviderConfig) => (p.daily_limit_per_user === null ? null : Math.max(0, p.daily_limit_per_user - (used[p.id] ?? 0)))

    if (action === 'providers') {
      const visible = me.is_admin ? providers : providers.filter((p) => p.enabled)
      return json({
        providers: visible.map((p) => ({
          id: p.id,
          display_name: p.display_name,
          model: p.model,
          enabled: p.enabled,
          is_default: p.is_default,
          configured: credentials(p, deps.env).configured,
          remaining_today: remaining(p),
        })),
        preferred: me.preferred_ai_provider,
        trip_default: trip?.default_ai_provider ?? null,
      })
    }
    if (action !== 'scan') return json({ error: 'unknown_action' }, 400)

    // ---------- 驗證照片 ----------
    const image = typeof body.image === 'string' ? body.image.replace(/^data:[^;]+;base64,/, '') : ''
    const mimeType = typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg'
    if (!image) return json({ error: 'image_required' }, 400)
    if (image.length > MAX_IMAGE_BASE64) return json({ error: 'image_too_large' }, 413)
    if (!MIME_TYPES.includes(mimeType)) return json({ error: 'unsupported_image_type' }, 400)

    // ---------- 決定嘗試順序 ----------
    const enabled = providers.filter((p) => p.enabled)
    const exclude = new Set(Array.isArray(body.exclude) ? body.exclude.map(String) : [])
    let order: ProviderConfig[]
    let allowFallback: boolean
    if (typeof body.provider === 'string' && body.provider) {
      const p = enabled.find((x) => x.id === body.provider)
      if (!p) return json({ error: 'provider_not_available' }, 400)
      order = [p]
      allowFallback = false
    } else {
      const preferred = [me.preferred_ai_provider, trip?.default_ai_provider, enabled.find((p) => p.is_default)?.id]
      const first = preferred.map((id) => enabled.find((p) => p.id === id)).filter((p): p is ProviderConfig => !!p)
      order = [...new Map([...first, ...enabled].map((p) => [p.id, p])).values()].filter((p) => !exclude.has(p.id))
      allowFallback = true
    }

    const attempts: Attempt[] = []
    let tried = 0
    for (const p of order) {
      const cred = credentials(p, deps.env)
      if (!cred.configured) {
        attempts.push({ provider: p.id, status: 'not_configured', message: '尚未設定金鑰' })
        continue
      }
      if (remaining(p) === 0) {
        attempts.push({ provider: p.id, status: 'daily_limit', message: '已達今日使用上限' })
        continue
      }
      if (tried > 0 && !allowFallback) break
      const budgetMs = Math.min(p.timeout_seconds * 1000, deadline - Date.now())
      if (budgetMs < MIN_ATTEMPT_MS) {
        attempts.push({ provider: p.id, status: 'skipped', message: '時間不足，未嘗試' })
        continue
      }

      const isFallback = tried > 0
      // 先原子地預留一次額度（同時送出多張也不會超過上限）
      const { data: logId, error: rErr } = await admin.rpc('reserve_ai_scan', {
        p_user: user.id,
        p_trip: tripId,
        p_provider: p.id,
        p_model: p.model,
        p_limit: p.daily_limit_per_user,
        p_fallback: isFallback,
      })
      if (rErr) return json({ error: 'db_error', message: rErr.message }, 500)
      if (!logId) {
        attempts.push({ provider: p.id, status: 'daily_limit', message: '已達今日使用上限' })
        continue
      }
      tried++
      const started = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), budgetMs)
      try {
        const text = await ADAPTERS[p.adapter]({ provider: p, apiKey: cred.apiKey, baseUrl: cred.baseUrl, image, mimeType, fetch: deps.fetch, signal: controller.signal })
        const result = normalize(extractJson(text))
        const duration = Date.now() - started
        await admin.from('ai_scan_logs').update({ status: 'success', duration_ms: duration }).eq('id', logId)
        attempts.push({ provider: p.id, status: 'success' })
        return json({ result, provider: p.id, provider_name: p.display_name, model: p.model, is_fallback: isFallback, duration_ms: duration, log_id: logId, attempts })
      } catch (e) {
        const err = e instanceof ScanError ? e : new ScanError(controller.signal.aborted ? 'timeout' : 'failed', String((e as Error)?.message ?? e), '辨識失敗')
        await admin
          .from('ai_scan_logs')
          .update({ status: err.status, duration_ms: Date.now() - started, error_message: err.message.slice(0, 500) })
          .eq('id', logId)
        // 給使用者的訊息不含網址或服務的回應內容；完整原因只在管理員可看的紀錄裡
        attempts.push({ provider: p.id, status: err.status, message: err.publicMessage.slice(0, 200) })
      } finally {
        clearTimeout(timer)
      }
    }

    return json({ error: tried ? 'all_failed' : 'no_provider_available', attempts }, tried ? 502 : 503)
  }
}
