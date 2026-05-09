function Card({ children, className = '' }) {
  return (
    <section
      className={
        'rounded-3xl border border-slate-700/60 bg-slate-900/80 p-5 shadow-card ' +
        className
      }
    >
      {children}
    </section>
  )
}

export default Card
