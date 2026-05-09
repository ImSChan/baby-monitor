import { NavLink } from 'react-router-dom'
import { Home, Video, Smile, Lightbulb, Settings } from 'lucide-react'

const navItems = [
  { path: '/', label: '홈', icon: Home },
  { path: '/live', label: '라이브', icon: Video },
  { path: '/emotion', label: '감정', icon: Smile },
  { path: '/smart-home', label: '스마트홈', icon: Lightbulb },
  { path: '/settings', label: '설정', icon: Settings },
]

function BottomNav() {
  return (
    <nav className='safe-bottom fixed bottom-0 left-1/2 z-50 grid h-[76px] w-full max-w-[430px] -translate-x-1/2 grid-cols-5 border-t border-slate-800 bg-slate-950/95 backdrop-blur'>
      {navItems.map((item) => {
        const Icon = item.icon

        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              [
                'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition',
                isActive ? 'text-blue-300' : 'text-slate-500',
              ].join(' ')
            }
          >
            <Icon size={22} />
            <span>{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

export default BottomNav
