import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { getProfile } from '../lib/api'
import { useLoad } from '../hooks/useLoad'
import type { Profile } from '../lib/types'

interface ProfileState {
  profile: Profile | null
  reloadProfile: () => Promise<void>
}

const ProfileContext = createContext<ProfileState>({ profile: null, reloadProfile: async () => {} })

/** 登入後載入自己的 profiles 資料（顯示名稱、預設幣別、是否為管理員…） */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { data, reload } = useLoad(() => (user ? getProfile(user.id) : Promise.resolve(null)), [user?.id])
  return <ProfileContext.Provider value={{ profile: data, reloadProfile: reload }}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  return useContext(ProfileContext)
}
