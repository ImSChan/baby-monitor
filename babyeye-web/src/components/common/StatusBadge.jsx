function StatusBadge({ children, type = 'normal' }) {
  const colorMap = {
    normal: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
    warning: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
    danger: 'bg-rose-400/15 text-rose-300 border-rose-400/30',
    info: 'bg-blue-400/15 text-blue-300 border-blue-400/30',
  }

  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ' +
        colorMap[type]
      }
    >
      {children}
    </span>
  )
}

export default StatusBadge
