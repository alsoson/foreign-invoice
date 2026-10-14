import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthProvider'

/** 登入後的共用版面：上方標題列＋下方導覽列（手機優先） */
export function AppLayout() {
  const { user } = useAuth()
  const avatar = user?.user_metadata?.avatar_url as string | undefined

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <h1 className="text-lg font-semibold text-slate-900">旅遊發票</h1>
        <NavLink to="/settings" aria-label="個人設定">
          {avatar ? (
            <img src={avatar} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm text-white">
              {(user?.email ?? '?').slice(0, 1).toUpperCase()}
            </span>
          )}
        </NavLink>
      </header>

      <main className="flex-1 px-4 py-4 pb-24">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-2xl grid-cols-2">
          <TabLink to="/" label="旅程" icon="🧳" />
          <TabLink to="/settings" label="設定" icon="⚙️" />
        </div>
      </nav>
    </div>
  )
}

function TabLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'text-teal-700 font-semibold' : 'text-slate-500'}`
      }
    >
      <span aria-hidden className="text-xl leading-none">
        {icon}
      </span>
      {label}
    </NavLink>
  )
}
