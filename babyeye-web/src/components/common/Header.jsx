import { Bell } from 'lucide-react'

function Header({ title = 'Baby Monitor', subtitle = '실시간 영아 상태 모니터링' }) {
  return (
    <header className='mb-5 flex items-center justify-between'>
      <div>
        <p className='text-sm text-slate-400'>{subtitle}</p>
        <h1 className='mt-1 text-2xl font-bold tracking-tight text-white'>
          {title}
        </h1>
      </div>

      <button
        type='button'
        className='flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-200'
        aria-label='알림'
      >
        <Bell size={20} />
      </button>
    </header>
  )
}

export default Header
