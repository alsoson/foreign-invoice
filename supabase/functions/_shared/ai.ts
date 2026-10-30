// AI 辨識：各家服務的 Adapter、提示詞、回傳格式整理
// 新增一家 AI：在 ADAPTERS 加一個函式，並在 ai_providers 表新增一筆設定即可。

export interface ProviderConfig {
  id: string
  display_name: string
  adapter: 'ollama' | 'gemini' | 'openai' | 'claude'
  model: string
  enabled: boolean
  fallback_order: number
  is_default: boolean
  daily_limit_per_user: number | null
  timeout_seconds: number
}

export interface ScanItem {
  name_original: string | null
  name_translated: string | null
  quantity: number
  unit_price: number | null
  subtotal: number | null
}

export interface ScanResult {
  receipt_date: string | null
  store_name_original: string | null
  store_name_translated: string | null
  category: 'food' | 'transport' | 'lodging' | 'shopping' | 'ticket' | 'other'
  currency: string | null
  amount: number | null
  payment_method: 'cash' | 'credit_card' | 'e_payment' | 'other'
  raw_text: string | null
  items: ScanItem[]
}

export const PROMPT = `你是發票辨識助手。請讀取這張收據圖片，並且：
1. 擷取日期、店名、品項、數量、單價、小計、總金額、幣別、付款方式。
2. 將店名與品名翻譯成繁體中文，同時保留原文。
3. 依內容判斷類別：food（餐飲）、transport（交通）、lodging（住宿）、shopping（購物）、ticket（門票）、other（其他）。
4. 付款方式填 cash（現金）、credit_card（信用卡）、e_payment（電子支付、交通卡、QR 支付）或 other。
5. 幣別使用 ISO 4217 三碼（例如 JPY、KRW、THB、EUR、USD）。金額只填數字，不要加逗號或貨幣符號。
6. 日期格式 YYYY-MM-DD；收據上是和曆（令和）或佛曆時請換算成西元。
7. 只輸出符合下列格式的 JSON，不要加其他說明；看不清楚的欄位填 null。

{"receipt_date":"2026-10-01","store_name_original":"","store_name_translated":"","category":"food","currency":"JPY","amount":1280,"payment_method":"cash","raw_text":"（收據上的原文）","items":[{"name_original":"","name_translated":"","quantity":1,"unit_price":160,"subtotal":160}]}`

/** 呼叫失敗時的分類，會寫進 ai_scan_logs.status */
export class ScanError extends Error {
  /** message：完整原因（只寫進管理員可看的紀錄）；publicMessage：給使用者看的，不含網址或回應內容 */
  constructor(
    public status: 'failed' | 'timeout' | 'quota_exceeded' | 'invalid_output',
    message: string,
    public publicMessage: string = message,
  ) {
    super(message)
  }
}

export interface CallInput {
  provider: ProviderConfig
  apiKey: string | undefined
  baseUrl: string | undefined
  image: string // base64，不含 data: 前綴
  mimeType: string
  fetch: typeof fetch
  signal: AbortSignal
}

async function post(input: CallInput, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response
  try {
    res = await input.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: input.signal })
  } catch (e) {
    if (input.signal.aborted) throw new ScanError('timeout', `超過 ${input.provider.timeout_seconds} 秒沒有回應`)
    throw new ScanError('failed', `連線失敗：${(e as Error).message}`.slice(0, 300), '無法連線到這個 AI 服務')
  }
  const text = await res.text()
  if (res.status === 429) throw new ScanError('quota_exceeded', `額度已用完或請求太頻繁（HTTP 429）`)
  if (!res.ok) throw new ScanError('failed', `HTTP ${res.status}：${text.slice(0, 300)}`, `服務回應錯誤（HTTP ${res.status}）`)
  try {
    return JSON.parse(text)
  } catch {
    throw new ScanError('invalid_output', 'API 回應不是 JSON')
  }
}

type Adapter = (input: CallInput) => Promise<string>

export const ADAPTERS: Record<ProviderConfig['adapter'], Adapter> = {
  // Ollama（Ollama Cloud 與自架共用）：POST {base}/api/chat
  async ollama(input) {
    const base = (input.baseUrl ?? 'https://ollama.com').replace(/\/+$/, '')
    const data = await post(input, `${base}/api/chat`, input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}, {
      model: input.provider.model,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [{ role: 'user', content: PROMPT, images: [input.image] }],
    })
    return data?.message?.content ?? ''
  },

  // Google Gemini：generateContent，要求回傳 JSON
  async gemini(input) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.provider.model)}:generateContent`
    const data = await post(input, url, { 'x-goog-api-key': input.apiKey ?? '' }, {
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: input.mimeType, data: input.image } }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    })
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    return parts.map((p: { text?: string }) => p.text ?? '').join('')
  },

  // OpenAI：Chat Completions＋JSON mode
  async openai(input) {
    const data = await post(input, 'https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${input.apiKey}` }, {
      model: input.provider.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.image}` } },
          ],
        },
      ],
    })
    return data?.choices?.[0]?.message?.content ?? ''
  },

  // Anthropic Claude：Messages API
  async claude(input) {
    const data = await post(input, 'https://api.anthropic.com/v1/messages', { 'x-api-key': input.apiKey ?? '', 'anthropic-version': '2023-06-01' }, {
      model: input.provider.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: input.image } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    })
    return (data?.content ?? [])
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('')
  },
}

/** 各服務對應的金鑰與網址（環境變數，設定在 Supabase Secrets） */
/** 內建服務的 id 必須搭配固定的 adapter，否則金鑰可能被送到別家 */
const BUILTIN_ADAPTER: Record<string, ProviderConfig['adapter']> = { 'ollama-cloud': 'ollama', 'ollama-self': 'ollama', gemini: 'gemini', openai: 'openai', claude: 'claude' }

export function credentials(p: Pick<ProviderConfig, 'id' | 'adapter'>, env: (k: string) => string | undefined): { apiKey?: string; baseUrl?: string; configured: boolean } {
  if (BUILTIN_ADAPTER[p.id] && BUILTIN_ADAPTER[p.id] !== p.adapter) return { configured: false }
  switch (p.id) {
    case 'ollama-cloud':
      return { apiKey: env('OLLAMA_API_KEY'), baseUrl: 'https://ollama.com', configured: !!env('OLLAMA_API_KEY') }
    case 'ollama-self':
      return { apiKey: env('OLLAMA_SELF_TOKEN'), baseUrl: env('OLLAMA_SELF_URL'), configured: !!env('OLLAMA_SELF_URL') }
    case 'gemini':
      return { apiKey: env('GEMINI_API_KEY'), configured: !!env('GEMINI_API_KEY') }
    case 'openai':
      return { apiKey: env('OPENAI_API_KEY'), configured: !!env('OPENAI_API_KEY') }
    case 'claude':
      return { apiKey: env('ANTHROPIC_API_KEY'), configured: !!env('ANTHROPIC_API_KEY') }
    default: {
      // 自訂的服務：<ID>_API_KEY、<ID>_BASE_URL（例如 my-ollama → MY_OLLAMA_API_KEY）
      const prefix = p.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
      const apiKey = env(`${prefix}_API_KEY`)
      const baseUrl = env(`${prefix}_BASE_URL`)
      return { apiKey, baseUrl, configured: p.adapter === 'ollama' ? !!baseUrl : !!apiKey }
    }
  }
}

// ---------- 整理 AI 回傳的內容 ----------

/** 從模型輸出中取出 JSON（容許 ```json 區塊或前後多餘文字） */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1))
      } catch {
        /* 下面統一丟錯 */
      }
    }
  }
  throw new ScanError('invalid_output', '模型沒有回傳有效的 JSON')
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s && s.toLowerCase() !== 'null' ? s.slice(0, 500) : null
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/[\s，]/g, '')
  const negative = /^-|^\(.*\)$/.test(s) // 結尾的「-」是日本收據的寫法（¥1,280-），不是負數
  s = s.replace(/[^\d.,]/g, '')
  // 歐洲格式：只有逗號、且逗號後剛好兩位（12,50）→ 小數點
  if (!s.includes('.') && /^\d{1,3}(\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(s)) s = s.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,50
  else s = s.replace(/,/g, '')
  if (!s || s === '.') return null
  const n = Number(s)
  return Number.isFinite(n) ? (negative ? -n : n) : null
}

const CATEGORY_WORDS: [ScanResult['category'], RegExp][] = [
  ['food', /^(food|餐飲|飲食|餐廳|食物|飲料|咖啡)$/i],
  ['transport', /^(transport|transportation|交通|車資|計程車|電車)$/i],
  ['lodging', /^(lodging|hotel|accommodation|住宿|飯店|旅館)$/i],
  ['shopping', /^(shopping|購物|商品|超市|便利商店)$/i],
  ['ticket', /^(ticket|tickets|admission|門票|票券|景點|入場)$/i],
]

const PAYMENT_WORDS: [ScanResult['payment_method'], RegExp][] = [
  ['e_payment', /(e[_-]?payment|電子|\bic\b|icカード|suica|pasmo|icoca|paypay|line ?pay|\bqr\b|apple ?pay|google ?pay|t-?money|交通卡|悠遊卡|電子マネー)/i],
  ['credit_card', /(credit|信用卡|visa|master|\bjcb\b|amex|クレジット|카드)/i],
  ['cash', /(cash|現金|お預り|お預かり|현금)/i],
]
const PAYMENT_CODES = ['cash', 'credit_card', 'e_payment', 'other'] as const

// 單獨的「$」「元」無法判斷是哪一國，留給使用者確認
const SYMBOLS: Record<string, string> = {
  '円': 'JPY', '¥': 'JPY', '￥': 'JPY', '₩': 'KRW', '원': 'KRW', '฿': 'THB', '€': 'EUR', '£': 'GBP', '₫': 'VND',
  'NT$': 'TWD', 'US$': 'USD', 'HK$': 'HKD', 'S$': 'SGD', 'A$': 'AUD', 'AU$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'NZ$': 'NZD',
  'MOP$': 'MOP', 'RM': 'MYR', '₱': 'PHP', 'RP': 'IDR', '₹': 'INR', 'CHF': 'CHF',
}

function isDate(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** 把模型輸出整理成固定格式；完全沒有可用資料時丟出 invalid_output */
export function normalize(raw: unknown): ScanResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ScanError('invalid_output', '回傳的 JSON 格式不正確')
  const o = raw as Record<string, unknown>

  const itemsIn = Array.isArray(o.items) ? o.items : []
  const items: ScanItem[] = itemsIn
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => {
      const quantity = num(i.quantity) ?? 1
      const unit = num(i.unit_price)
      const sub = num(i.subtotal) ?? (unit !== null ? Math.round(unit * quantity * 1000) / 1000 : null)
      return { name_original: str(i.name_original), name_translated: str(i.name_translated), quantity, unit_price: unit, subtotal: sub }
    })
    .filter((i) => i.name_original || i.name_translated || i.subtotal !== null)
    .slice(0, 200)

  let amount = num(o.amount)
  if (amount === null && items.some((i) => i.subtotal !== null)) {
    amount = Math.round(items.reduce((s, i) => s + (i.subtotal ?? 0), 0) * 1000) / 1000
  }
  if (amount !== null && amount < 0) amount = Math.abs(amount)

  const catRaw = str(o.category) ?? ''
  const category = CATEGORY_WORDS.find(([, re]) => re.test(catRaw))?.[0] ?? 'other'
  const payRaw = str(o.payment_method) ?? ''
  const payment_method =
    (PAYMENT_CODES as readonly string[]).includes(payRaw.toLowerCase())
      ? (payRaw.toLowerCase() as ScanResult['payment_method'])
      : (PAYMENT_WORDS.find(([, re]) => re.test(payRaw))?.[0] ?? 'other')

  let currency = str(o.currency)?.toUpperCase() ?? null
  if (currency && !/^[A-Z]{3}$/.test(currency)) currency = SYMBOLS[str(o.currency)!] ?? SYMBOLS[currency] ?? null

  const date = str(o.receipt_date)
  const result: ScanResult = {
    receipt_date: isDate(date) ? date : null,
    store_name_original: str(o.store_name_original),
    store_name_translated: str(o.store_name_translated),
    category,
    currency,
    amount,
    payment_method,
    raw_text: typeof o.raw_text === 'string' ? o.raw_text.slice(0, 10000) : null,
    items,
  }
  if (result.amount === null && !result.items.length && !result.store_name_original && !result.store_name_translated) {
    throw new ScanError('invalid_output', '沒有辨識出任何發票內容（圖片可能不是收據或太模糊）')
  }
  return result
}
