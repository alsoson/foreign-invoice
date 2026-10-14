import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { appBaseUrl, supabase } from '../lib/supabase'

const RETURN_TO_KEY = 'fi:returnTo'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  signInWithGoogle: (returnTo?: string) => Promise<void>
  signOut: () => Promise<void>
  /** 取出並清除登入前想去的頁面（例如邀請連結） */
  takeReturnTo: () => string | null
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // 登入完成後，把網址上的 ?code=... 清掉，保留 # 路由
  useEffect(() => {
    if (session && window.location.search.includes('code=')) {
      window.history.replaceState(null, '', appBaseUrl() + window.location.hash)
    }
  }, [session])

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    loading,
    async signInWithGoogle(returnTo) {
      try {
        if (returnTo) localStorage.setItem(RETURN_TO_KEY, returnTo)
      } catch {
        /* 私密瀏覽模式可能無法寫入，忽略 */
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: appBaseUrl(),
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) throw error
    },
    async signOut() {
      await supabase.auth.signOut()
    },
    takeReturnTo() {
      try {
        const v = localStorage.getItem(RETURN_TO_KEY)
        localStorage.removeItem(RETURN_TO_KEY)
        return v
      } catch {
        return null
      }
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 裡使用')
  return ctx
}
