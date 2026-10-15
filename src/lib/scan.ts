/** 拍照辨識：壓縮照片、呼叫 scan-receipt Edge Function */
import { supabase } from './supabase'
import type { Category, PaymentMethod } from './types'

export interface ScanResult {
  receipt_date: string | null
  store_name_original: string | null
  store_name_translated: string | null
  category: Category
  currency: string | null
  amount: number | null
  payment_method: PaymentMethod
  raw_text: string | null
  items: { name_original: string | null; name_translated: string | null; quantity: number; unit_price: number | null; subtotal: number | null }[]
}

export interface ScanResponse {
  result: ScanResult
  provider: string
  provider_name: string
  model: string
  is_fallback: boolean
  duration_ms: number
  log_id: string | null
  attempts: Attempt[]
}

export interface Attempt {
  provider: string
  status: string
  message?: string
}

export interface ProviderOption {
  id: string
  display_name: string
  model: string
  enabled: boolean
  is_default: boolean
  configured: boolean
  remaining_today: number | null
}

export class ScanFailed extends Error {
  constructor(
    public code: string,
    public attempts: Attempt[] = [],
  ) {
    super(code)
  }
}

export interface CompressedImage {
  base64: string
  mimeType: 'image/jpeg'
  dataUrl: string
  width: number
  height: number
}

/** 縮小到長邊 1600px 的 JPEG：檔案小、上傳快，文字仍清楚 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<CompressedImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('無法讀取這張照片（格式可能不支援，請改用 JPG 或 PNG）'))
      el.src = url
    })
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg', dataUrl, width: w, height: h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('scan-receipt', { body })
  if (error) {
    let payload: { error?: string; attempts?: Attempt[] } = {}
    const ctx = (error as { context?: Response }).context
    try {
      if (ctx && typeof ctx.json === 'function') payload = await ctx.json()
    } catch {
      /* 不是 JSON */
    }
    throw new ScanFailed(payload.error ?? (/fetch|network/i.test(error.message) ? 'network' : 'function_error'), payload.attempts ?? [])
  }
  return data as T
}

export function loadProviderOptions(tripId?: string) {
  return invoke<{ providers: ProviderOption[]; preferred: string | null; trip_default: string | null }>({ action: 'providers', trip_id: tripId })
}

export function scanReceipt(tripId: string, image: CompressedImage, provider?: string) {
  return invoke<ScanResponse>({ action: 'scan', trip_id: tripId, image: image.base64, mime_type: image.mimeType, provider: provider || undefined })
}

export const SCAN_ERROR_TEXT: Record<string, string> = {
  all_failed: '所有 AI 都辨識失敗了。',
  no_provider_available: '目前沒有可用的 AI 服務（可能尚未設定金鑰，或已達今日使用上限）。',
  provider_not_available: '這個 AI 目前沒有啟用。',
  viewer_cannot_scan: '檢視者不能新增發票。',
  not_member: '你不是這個旅程的成員。',
  image_too_large: '照片太大，請重新拍攝。',
  unsupported_image_type: '不支援這種圖片格式。',
  network: '網路連線失敗，請確認網路後再試一次。',
  function_error: '辨識服務暫時無法使用（Edge Function 可能尚未部署）。',
  unauthorized: '登入已過期，請重新登入。',
}

export const ATTEMPT_TEXT: Record<string, string> = {
  success: '成功',
  failed: '失敗',
  timeout: '逾時',
  quota_exceeded: '額度用完',
  invalid_output: '回傳格式錯誤',
  not_configured: '未設定金鑰',
  daily_limit: '已達今日上限',
}
