import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && key && !key.startsWith('請貼上'))

export const supabase = createClient(url || 'https://invalid.supabase.co', key || 'missing', {
  auth: {
    // PKCE：登入後回到網址的 ?code=...（查詢字串），
    // 不會和 Hash 路由的 #/... 互相衝突
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})

/** 網站根網址（不含 # 後面的路由），用來當 Google 登入完成後的返回位置 */
export function appBaseUrl(): string {
  return window.location.origin + window.location.pathname
}
