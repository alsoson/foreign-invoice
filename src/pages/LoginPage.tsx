import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { isSupabaseConfigured } from '../lib/supabase'
import { detectInAppBrowser, externalBrowserUrl } from '../lib/inAppBrowser'

export function LoginPage() {
  const { session, signInWithGoogle } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inApp = detectInAppBrowser()

  if (session) return <Navigate to={from ?? '/'} replace />

  async function handleLogin() {
    setError(null)
    setBusy(true)
    try {
      await signInWithGoogle(from)
    } catch (e) {
      setError(e instanceof Error ? e.message : '登入失敗，請稍後再試')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-teal-50 to-white px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-600 text-3xl text-white shadow">
          🧾
        </div>
        <h1 className="text-2xl font-bold text-slate-900">旅遊發票</h1>
        <p className="mt-2 text-sm text-slate-600">拍照記錄、翻譯、統計旅途中的每一筆花費</p>

        {!isSupabaseConfigured && (
          <p className="mt-6 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-800">
            尚未設定 Supabase。請建立 <code>.env.local</code>，填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。
          </p>
        )}

        {inApp ? (
          <div className="mt-8 rounded-lg bg-amber-50 p-4 text-left text-sm text-amber-900">
            <p className="font-semibold">請改用瀏覽器開啟</p>
            <p className="mt-1">
              {inApp} 的內建瀏覽器無法使用 Google 登入。請點右上角選單，選擇「用瀏覽器開啟」。
            </p>
            {inApp === 'LINE' && (
              <a
                href={externalBrowserUrl()}
                className="mt-3 block rounded-lg bg-amber-600 py-2 text-center font-semibold text-white"
              >
                用外部瀏覽器開啟
              </a>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleLogin}
            disabled={busy || !isSupabaseConfigured}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 font-medium text-slate-800 shadow-sm active:bg-slate-100 disabled:opacity-50"
          >
            <GoogleIcon />
            {busy ? '前往 Google…' : '使用 Google 帳號登入'}
          </button>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
