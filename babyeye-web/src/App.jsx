
import { BrowserRouter } from 'react-router-dom'

import AppRouter from './routes/AppRouter'
import BottomNav from './components/common/BottomNav'
import { AuthProvider, useAuth } from './contexts/AuthContext'

function AppLayout() {
  const { user, loading } = useAuth()

  return (
    <div className="min-h-screen bg-[#0B1020] text-white">
      <div
        className={`mx-auto min-h-screen max-w-[430px] bg-[#0B1020] ${
          user ? 'pb-24' : ''
        }`}
      >
        <AppRouter />
      </div>

      {!loading && user && <BottomNav />}
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
