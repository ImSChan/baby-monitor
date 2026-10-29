
import {
  Navigate,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom'

import { useAuth } from '../contexts/AuthContext'

import CameraHostPage from '../pages/CameraHostPage'
import EmotionPage from '../pages/EmotionPage'
import HomePage from '../pages/HomePage'
import LivePage from '../pages/LivePage'
import SettingsPage from '../pages/SettingsPage'
import SmartHomePage from '../pages/SmartHomePage'
import LoginPage from '../pages/LoginPage'
import FeedbackPage from '../pages/FeedbackPage'

function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        로그인 확인 중...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/camera-host" element={<CameraHostPage />} />
        <Route path="/emotion" element={<EmotionPage />} />
        <Route path="/smart-home" element={<SmartHomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default AppRouter
