import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthProvider'

const NAV_ITEMS = [
  { to: '/', label: '旅程', icon: '🧳' },
  { to: '/settings', label: '設定', icon: '⚙️' },
]

/**
 * 登入後的共用版面（RWD）
 * - 手機（< 768px）：上方標題列＋下方導覽列
 * - 平板（≥ 768px）：左側精簡側邊欄（只有圖示），內容區加寬
 * - 電腦（≥ 1024px）：左側完整側邊欄（圖示＋文字＋使用者資訊）
 */
export function AppLayout() {
  const { user } = useAuth()
  const avatar = user?.user_metadata?.avatar_url as string | undefined
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''

  const avatarEl = (size: string) =>
    avatar ? (
      <img src={avatar} alt="" className={`${size} shrink-0 rounded-full`} referrerPolicy="no-referrer" />
    ) : (
      <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm text-white`}>
        {(user?.email ?? '?').slice(0, 1).toUpperCase()}
      </span>
    )

  return (
    <div className="min-h-dvh bg-slate-50 md:flex">
      {/* 平板／電腦：左側側邊欄 */}
      <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-slate-200 bg-white md:flex md:w-20 lg:w-60">
        <div className="flex items-center gap-3 px-4 py-5 md:justify-center lg:justify-start lg:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-xl text-white">🧾</span>
          <span className="hidden text-lg font-semibold text-slate-900 lg:inline">旅遊發票</span>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <SideLink key={item.to} {...item} />
          ))}
        </nav>

        <NavLink
          to="/settings"
          className="m-3 flex items-center gap-3 rounded-lg p-2 hover:bg-slate-100 md:justify-center lg:justify-start"
          title={name}
        >
          {avatarEl('h-9 w-9')}
          <span className="hidden min-w-0 text-sm lg:block">
            <span className="block truncate font-medium text-slate-900">{name}</span>
            <span className="block truncate text-xs text-slate-500">{user?.email}</span>
          </span>
        </NavLink>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 手機：上方標題列 */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur md:hidden">
          <h1 className="text-lg font-semibold text-slate-900">旅遊發票</h1>
          <NavLink to="/settings" aria-label="個人設定">
            {avatarEl('h-8 w-8')}
          </NavLink>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-24 sm:px-6 md:px-8 md:py-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* 手機：下方導覽列 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-2">
          {NAV_ITEMS.map((item) => (
            <TabLink key={item.to} {...item} />
          ))}
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
        `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'font-semibold text-teal-700' : 'text-slate-500'}`
      }
    >
      <span aria-hidden className="text-xl leading-none">
        {icon}
      </span>
      {label}
    </NavLink>
  )
}

function SideLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end
      title={label}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm md:justify-center lg:justify-start ${
          isActive ? 'bg-teal-50 font-semibold text-teal-700' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      <span aria-hidden className="text-xl leading-none">
        {icon}
      </span>
      <span className="md:sr-only lg:not-sr-only">{label}</span>
    </NavLink>
  )
}
