
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'

import NotificationsPage from '../pages/NotificationsPage'
import NotificationResultPage from '../pages/NotificationResultPage'
import ReviewPage from '../pages/ReviewPage'
import { useAuth } from '../contexts/AuthContext'

import CameraHostPage from '../pages/CameraHostPage'
import HomePage from '../pages/HomePage'
import CarePage from '../pages/CarePage'
import LivePage from '../pages/LivePage'
import SettingsPage from '../pages/SettingsPage'
import LoginPage from '../pages/LoginPage'


function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        로그인 확인 중...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  }

  return <Outlet />
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/care" element={<CarePage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/camera-host" element={<CameraHostPage />} />
        <Route path="/emotion" element={<Navigate to="/" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/reviews" element={<ReviewPage />} />
        <Route path="/notifications/:eventId" element={<NotificationResultPage />} />
        <Route path="/feedback" element={<Navigate to="/notifications" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default AppRouter
