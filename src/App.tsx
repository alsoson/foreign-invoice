import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ProfileProvider } from './auth/ProfileProvider'
import { RequireAuth } from './components/RequireAuth'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { TripsPage } from './pages/TripsPage'
import { SettingsPage } from './pages/SettingsPage'
import { JoinPage } from './pages/JoinPage'
import { ExportPage } from './pages/ExportPage'
import { TripLayout } from './pages/trip/TripLayout'
import { ReceiptsPage } from './pages/trip/ReceiptsPage'
import { ReceiptEditPage } from './pages/trip/ReceiptEditPage'
import { ScanPage } from './pages/trip/ScanPage'
import { StatsPage } from './pages/trip/StatsPage'
import { MembersPage } from './pages/trip/MembersPage'
import { TripSettingsPage } from './pages/trip/TripSettingsPage'
import { AdminAiPage } from './pages/admin/AdminAiPage'

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
            <Route
              element={
                <ProfileProvider>
                  <AppLayout />
                </ProfileProvider>
              }
            >
              <Route index element={<TripsPage />} />
              <Route path="/join" element={<JoinPage />} />
              <Route path="/join/:code" element={<JoinPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/admin/ai" element={<AdminAiPage />} />
              <Route path="/trips/:tripId" element={<TripLayout />}>
                <Route index element={<ReceiptsPage />} />
                <Route path="receipts/new" element={<ReceiptEditPage />} />
                <Route path="receipts/:receiptId" element={<ReceiptEditPage />} />
                <Route path="scan" element={<ScanPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="settings" element={<TripSettingsPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
