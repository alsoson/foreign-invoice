/** 資料表型別與共用常數 */

export type Role = 'owner' | 'editor' | 'viewer'
export type Category = 'food' | 'transport' | 'lodging' | 'shopping' | 'ticket' | 'other'
export type PaymentMethod = 'cash' | 'credit_card' | 'e_payment' | 'other'

export interface Trip {
  id: string
  owner_id: string
  name: string
  country: string | null
  start_date: string | null
  end_date: string | null
  default_currency: string
  default_ai_provider: string | null
  budget: number | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface Receipt {
  id: string
  trip_id: string
  receipt_date: string
  store_name_original: string | null
  store_name_translated: string | null
  category: Category
  currency: string
  amount: number
  payment_method: PaymentMethod
  paid_by: string | null
  raw_text: string | null
  ai_provider: string | null
  ai_model: string | null
  note: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface ReceiptItem {
  id?: string
  receipt_id?: string
  sort_order?: number
  name_original: string | null
  name_translated: string | null
  quantity: number
  unit_price: number | null
  subtotal: number | null
}

export interface Member {
  user_id: string
  role: Role
  joined_at: string
  display_name: string
  avatar_url: string | null
}

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  default_currency: string
  locale: string
  preferred_ai_provider: string | null
  is_admin: boolean
}

export interface AiProvider {
  id: string
  display_name: string
  adapter: 'ollama' | 'gemini' | 'openai' | 'claude'
  model: string
  enabled: boolean
  fallback_order: number
  is_default: boolean
  daily_limit_per_user: number | null
  timeout_seconds: number
  note: string | null
}

export interface Invite {
  id: string
  trip_id: string
  code: string
  role: 'editor' | 'viewer'
  label: string | null
  expires_at: string
  max_uses: number | null
  used_count: number
  created_at: string
  revoked: boolean
}

/** AI 辨識（或手動輸入）後、尚未存檔的發票內容 */
export interface ReceiptDraft {
  receipt_date: string
  store_name_original: string
  store_name_translated: string
  category: Category
  currency: string
  amount: string
  payment_method: PaymentMethod
  paid_by: string
  raw_text: string
  note: string
  items: ItemDraft[]
}

export interface ItemDraft {
  key: string
  name_original: string
  name_translated: string
  quantity: string
  unit_price: string
  subtotal: string
}

export const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'food', label: '餐飲', icon: '🍜' },
  { id: 'transport', label: '交通', icon: '🚃' },
  { id: 'lodging', label: '住宿', icon: '🏨' },
  { id: 'shopping', label: '購物', icon: '🛍️' },
  { id: 'ticket', label: '門票', icon: '🎫' },
  { id: 'other', label: '其他', icon: '📦' },
]
export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<Category, (typeof CATEGORIES)[number]>

export const PAYMENTS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: '現金' },
  { id: 'credit_card', label: '信用卡' },
  { id: 'e_payment', label: '電子支付' },
  { id: 'other', label: '其他' },
]
export const PAYMENT_LABEL = Object.fromEntries(PAYMENTS.map((p) => [p.id, p.label])) as Record<PaymentMethod, string>

export const ROLE_LABEL: Record<Role, string> = { owner: '擁有者', editor: '編輯者', viewer: '檢視者' }

export const CURRENCIES = ['JPY', 'KRW', 'THB', 'TWD', 'USD', 'EUR', 'HKD', 'CNY', 'SGD', 'VND', 'GBP', 'AUD', 'MYR', 'PHP', 'IDR', 'CHF', 'CAD', 'NZD', 'MOP']

export function canEdit(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'editor'
}
