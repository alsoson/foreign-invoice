/** 資料存取：所有 Supabase 查詢集中在這裡 */
import { supabase } from './supabase'
import type { AiProvider, Invite, Member, Profile, Receipt, ReceiptItem, Role, Trip } from './types'

const ERROR_TEXT: Record<string, string> = {
  receipt_conflict: '這張發票剛被其他人修改過，請重新載入後再編輯。',
  receipt_not_found_or_forbidden: '找不到這張發票，或你沒有修改的權限。',
  not_owner: '只有旅程擁有者可以這樣做。',
  not_admin: '只有系統管理員可以這樣做。',
  already_owner: '你已經是擁有者了。',
  not_member: '對方不是這個旅程的成員。',
  too_many_active_invites: '有效的邀請連結太多了，請先作廢一些。',
  invalid_days: '有效天數需在 1～90 天之間。',
  'new row violates row-level security policy': '你沒有權限進行這個操作。',
}

/** 把資料庫錯誤轉成看得懂的中文 */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  for (const [k, v] of Object.entries(ERROR_TEXT)) if (msg.includes(k)) return v
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '網路連線失敗，請確認網路後再試一次。'
  return msg
}

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

/** PostgREST 一次最多回傳 1000 筆，超過時分頁取完 */
const PAGE = 1000
async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const rows = check(await query(from, from + PAGE - 1)) ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

const TRIP_COLS = 'id, owner_id, name, country, start_date, end_date, default_currency, default_ai_provider, budget, note, created_at, updated_at'
const RECEIPT_COLS =
  'id, trip_id, receipt_date, store_name_original, store_name_translated, category, currency, amount, payment_method, paid_by, raw_text, ai_provider, ai_model, note, created_by, updated_by, created_at, updated_at'
const ITEM_COLS = 'id, receipt_id, sort_order, name_original, name_translated, quantity, unit_price, subtotal'

// ---------- 旅程 ----------

export async function listTrips(): Promise<Trip[]> {
  return fetchAll<Trip>((f, t) => supabase.from('trips').select(TRIP_COLS).order('created_at', { ascending: false }).order('id').range(f, t))
}

export async function getTrip(id: string): Promise<Trip | null> {
  const rows = check(await supabase.from('trips').select(TRIP_COLS).eq('id', id).limit(1)) as Trip[]
  return rows[0] ?? null
}

export type TripInput = Pick<Trip, 'name' | 'country' | 'start_date' | 'end_date' | 'default_currency' | 'budget' | 'note' | 'default_ai_provider'>

export async function createTrip(ownerId: string, input: TripInput): Promise<Trip> {
  const rows = check(await supabase.from('trips').insert({ ...input, owner_id: ownerId }).select(TRIP_COLS)) as Trip[]
  return rows[0]
}

export async function updateTrip(id: string, input: TripInput): Promise<void> {
  const rows = check(await supabase.from('trips').update(input).eq('id', id).select('id'))
  if (!rows?.length) throw new Error('你沒有權限修改這個旅程。')
}

export async function deleteTrip(id: string): Promise<void> {
  const rows = check(await supabase.from('trips').delete().eq('id', id).select('id'))
  if (!rows?.length) throw new Error('只有旅程擁有者可以刪除旅程。')
}

export interface TripSummary {
  trip_id: string
  currency: string
  receipt_count: number
  total: number
}

export async function tripSummaries(): Promise<TripSummary[]> {
  const rows = await fetchAll<TripSummary>((f, t) => supabase.rpc('trip_summaries').range(f, t))
  return rows.map((r) => ({ ...r, receipt_count: Number(r.receipt_count), total: Number(r.total) }))
}

/** 目前使用者在每個旅程的角色 */
export async function myRoles(userId: string): Promise<Record<string, Role>> {
  const rows = check(await supabase.from('trip_members').select('trip_id, role').eq('user_id', userId)) as { trip_id: string; role: Role }[]
  return Object.fromEntries(rows.map((r) => [r.trip_id, r.role]))
}

// ---------- 成員 ----------

export async function listMembers(tripId: string): Promise<Member[]> {
  return check(await supabase.rpc('trip_member_list', { p_trip: tripId })) as Member[]
}

export async function setMemberRole(tripId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
  const rows = check(await supabase.from('trip_members').update({ role }).eq('trip_id', tripId).eq('user_id', userId).select('user_id'))
  if (!rows?.length) throw new Error('無法變更這位成員的角色。')
}

export async function removeMember(tripId: string, userId: string): Promise<void> {
  const rows = check(await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId).select('user_id'))
  if (!rows?.length) throw new Error('無法移除這位成員。')
}

export async function transferOwner(tripId: string, newOwner: string): Promise<void> {
  check(await supabase.rpc('transfer_trip_owner', { p_trip: tripId, p_new_owner: newOwner }))
}

// ---------- 邀請 ----------

export async function listInvites(tripId: string): Promise<Invite[]> {
  return check(
    await supabase
      .from('trip_invites')
      .select('id, trip_id, code, role, label, expires_at, max_uses, used_count, created_at, revoked')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false }),
  ) as Invite[]
}

export async function createInvite(tripId: string, role: 'editor' | 'viewer', days: number, maxUses: number | null, label: string): Promise<Invite> {
  return check(
    await supabase.rpc('create_invite', { p_trip: tripId, p_role: role, p_days: days, p_max_uses: maxUses, p_label: label || null }),
  ) as Invite
}

export async function revokeInvite(id: string): Promise<void> {
  check(await supabase.from('trip_invites').update({ revoked: true, revoked_at: new Date().toISOString() }).eq('id', id))
}

export interface InvitePreview {
  status: 'valid' | 'not_found' | 'expired' | 'revoked' | 'used_up' | 'already_member' | 'too_many_attempts' | 'not_logged_in'
  trip_id?: string
  trip_name?: string
  start_date?: string | null
  end_date?: string | null
  inviter_name?: string | null
  role?: 'editor' | 'viewer'
  expires_at?: string
}

export async function previewInvite(code: string): Promise<InvitePreview> {
  return check(await supabase.rpc('get_invite_preview', { p_code: code })) as InvitePreview
}

export async function acceptInvite(code: string): Promise<{ status: string; trip_id?: string }> {
  return check(await supabase.rpc('accept_invite', { p_code: code })) as { status: string; trip_id?: string }
}

export function inviteStatus(i: Invite): 'valid' | 'revoked' | 'expired' | 'used_up' {
  if (i.revoked) return 'revoked'
  if (new Date(i.expires_at) <= new Date()) return 'expired'
  if (i.max_uses !== null && i.used_count >= i.max_uses) return 'used_up'
  return 'valid'
}

// ---------- 發票 ----------

function normalizeReceipt(r: Receipt): Receipt {
  return { ...r, amount: Number(r.amount) }
}
function normalizeItem(i: ReceiptItem): ReceiptItem {
  return {
    ...i,
    quantity: Number(i.quantity),
    unit_price: i.unit_price === null ? null : Number(i.unit_price),
    subtotal: i.subtotal === null ? null : Number(i.subtotal),
  }
}

export async function listReceipts(tripId: string): Promise<Receipt[]> {
  const rows = await fetchAll<Receipt>((f, t) =>
    supabase.from('receipts').select(RECEIPT_COLS).eq('trip_id', tripId).order('receipt_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t),
  )
  return rows.map(normalizeReceipt)
}

export async function listReceiptsForTrips(tripIds: string[]): Promise<Receipt[]> {
  if (!tripIds.length) return []
  const rows = await fetchAll<Receipt>((f, t) =>
    supabase.from('receipts').select(RECEIPT_COLS).in('trip_id', tripIds).order('receipt_date', { ascending: true }).order('created_at', { ascending: true }).order('id').range(f, t),
  )
  return rows.map(normalizeReceipt)
}

export async function getReceipt(id: string): Promise<{ receipt: Receipt; items: ReceiptItem[] } | null> {
  const rows = check(await supabase.from('receipts').select(RECEIPT_COLS).eq('id', id).limit(1)) as Receipt[]
  if (!rows[0]) return null
  const items = check(await supabase.from('receipt_items').select(ITEM_COLS).eq('receipt_id', id).order('sort_order')) as ReceiptItem[]
  return { receipt: normalizeReceipt(rows[0]), items: items.map(normalizeItem) }
}

/** 一次取得多張發票的品項（分批查詢，避免網址太長） */
export async function listItems(receiptIds: string[]): Promise<ReceiptItem[]> {
  const out: ReceiptItem[] = []
  for (let i = 0; i < receiptIds.length; i += 80) {
    const chunk = receiptIds.slice(i, i + 80)
    const rows = await fetchAll<ReceiptItem>((f, t) => supabase.from('receipt_items').select(ITEM_COLS).in('receipt_id', chunk).order('receipt_id').order('sort_order').order('id').range(f, t))
    out.push(...rows.map(normalizeItem))
  }
  return out
}

export interface SaveReceiptInput {
  id?: string
  trip_id: string
  receipt_date: string
  store_name_original: string | null
  store_name_translated: string | null
  category: string
  currency: string
  amount: number
  payment_method: string
  paid_by: string | null
  raw_text: string | null
  note: string | null
  ai_provider?: string | null
  ai_model?: string | null
  expected_updated_at?: string
}

export async function saveReceipt(input: SaveReceiptInput, items: Omit<ReceiptItem, 'id' | 'receipt_id'>[]): Promise<string> {
  return check(await supabase.rpc('save_receipt', { p_receipt: input, p_items: items })) as string
}

export async function deleteReceipt(id: string): Promise<void> {
  const rows = check(await supabase.from('receipts').delete().eq('id', id).select('id'))
  if (!rows?.length) throw new Error('你沒有權限刪除這張發票。')
}

// ---------- 個人資料 ----------

export async function getProfile(id: string): Promise<Profile | null> {
  const rows = check(
    await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, default_currency, locale, preferred_ai_provider, default_trip_id, is_admin')
      .eq('id', id)
      .limit(1),
  ) as Profile[]
  return rows[0] ?? null
}

export async function updateProfile(id: string, input: Partial<Pick<Profile, 'display_name' | 'default_currency' | 'preferred_ai_provider' | 'default_trip_id'>>): Promise<void> {
  check(await supabase.from('profiles').update(input).eq('id', id))
}

/** 設定或取消預設旅程（tripId 為 null 表示取消） */
export async function setDefaultTrip(userId: string, tripId: string | null): Promise<void> {
  await updateProfile(userId, { default_trip_id: tripId })
}

/** 自己可以新增發票的旅程（擁有者或編輯者），用於預設旅程與切換旅程 */
export async function editableTrips(userId: string): Promise<Trip[]> {
  const [trips, roles] = await Promise.all([listTrips(), myRoles(userId)])
  return trips.filter((t) => roles[t.id] === 'owner' || roles[t.id] === 'editor')
}

export async function ownedTripsWithMembers(): Promise<{ trip_id: string; name: string; member_count: number }[]> {
  return check(await supabase.rpc('owned_trips_with_members')) as { trip_id: string; name: string; member_count: number }[]
}

// ---------- AI ----------

const PROVIDER_COLS = 'id, display_name, adapter, model, enabled, fallback_order, is_default, daily_limit_per_user, timeout_seconds, note'

/** 已啟用的 AI（管理員會拿到全部） */
export async function listProviders(): Promise<AiProvider[]> {
  return check(await supabase.from('ai_providers').select(PROVIDER_COLS).order('fallback_order')) as AiProvider[]
}

export async function updateProvider(id: string, input: Partial<Omit<AiProvider, 'id' | 'adapter' | 'is_default'>>): Promise<void> {
  const rows = check(await supabase.from('ai_providers').update(input).eq('id', id).select('id'))
  if (!rows?.length) throw new Error('只有系統管理員可以修改 AI 設定。')
}

export async function setDefaultProvider(id: string): Promise<void> {
  check(await supabase.rpc('set_default_ai_provider', { p_id: id }))
}

export interface UsageStat {
  provider: string
  total: number
  success: number
  failed: number
  fallback: number
  avg_ms: number | null
  corrected_ratio: number | null
}

export async function aiUsageStats(days: number): Promise<UsageStat[]> {
  const rows = check(await supabase.rpc('ai_usage_stats', { p_days: days })) as UsageStat[]
  return rows.map((r) => ({
    ...r,
    total: Number(r.total),
    success: Number(r.success),
    failed: Number(r.failed),
    fallback: Number(r.fallback),
    avg_ms: r.avg_ms === null ? null : Number(r.avg_ms),
    corrected_ratio: r.corrected_ratio === null ? null : Number(r.corrected_ratio),
  }))
}

/** 存檔後回填辨識紀錄：對應的發票、使用者修改了幾個欄位 */
export async function markScanLog(logId: string, receiptId: string, fieldsCorrected: number): Promise<void> {
  await supabase.from('ai_scan_logs').update({ receipt_id: receiptId, fields_corrected: fieldsCorrected }).eq('id', logId)
}
