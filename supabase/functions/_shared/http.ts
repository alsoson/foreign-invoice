// 共用：CORS 與 JSON 回應
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1] : null
}

/** Edge Function 需要的外部依賴（用參數注入，方便在 Node 裡測試） */
export interface Deps {
  env: (key: string) => string | undefined
  fetch: typeof fetch
  // deno-lint-ignore no-explicit-any
  createClient: (url: string, key: string, options?: any) => any
}
