import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from './Spinner'

/** 需要登入的頁面：未登入就導向登入頁，並記住原本要去的頁面 */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner full />
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
