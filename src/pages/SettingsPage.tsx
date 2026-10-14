import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

interface Profile {
  display_name: string
  avatar_url: string | null
  default_currency: string
  is_admin: boolean
}

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name, avatar_url, default_currency, is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setProfile(data)
      })
  }, [user])

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">個人設定</h2>

      <section className="flex items-center gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="h-14 w-14 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-slate-200" />
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{profile?.display_name || '（未設定名稱）'}</p>
          <p className="truncate text-sm text-slate-500">{user?.email}</p>
          {profile?.is_admin && <p className="mt-1 inline-block rounded bg-teal-50 px-2 text-xs text-teal-700">系統管理員</p>}
        </div>
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">讀取個人資料失敗：{error}</p>}

      <section className="rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
        <p className="text-slate-500">預設幣別</p>
        <p className="font-medium text-slate-900">{profile?.default_currency ?? '—'}</p>
      </section>

      <button
        type="button"
        onClick={() => signOut()}
        className="w-full rounded-lg border border-red-200 bg-white py-3 font-semibold text-red-600 active:bg-red-50"
      >
        登出
      </button>

      <p className="text-center text-xs text-slate-400">版本 {__APP_VERSION__}</p>
    </div>
  )
}
