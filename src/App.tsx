import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { RequireAuth } from './components/RequireAuth'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { TripsPage } from './pages/TripsPage'
import { SettingsPage } from './pages/SettingsPage'

/**
 * Google 登入完成後會回到網站首頁。
 * 如果登入前是從某個頁面（例如邀請連結 #/join/...）過來的，這裡把人帶回那個頁面。
 */
function ReturnToHandler() {
  const { session, takeReturnTo } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!session) return
    const target = takeReturnTo()
    if (target) navigate(target, { replace: true })
  }, [session])
  return null
}

export default function App() {
  return (
    <AuthProvider>
      {/* Hash 路由：網址為 .../#/trips，GitHub Pages 與 App 都不會出現 404 */}
      <HashRouter>
        <ReturnToHandler />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<TripsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
