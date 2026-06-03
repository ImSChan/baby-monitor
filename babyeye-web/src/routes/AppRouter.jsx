import { Navigate, Route, Routes } from 'react-router-dom'

import CameraHostPage from '../pages/CameraHostPage'
import EmotionPage from '../pages/EmotionPage'
import HomePage from '../pages/HomePage'
import LivePage from '../pages/LivePage'
import SettingsPage from '../pages/SettingsPage'
import SmartHomePage from '../pages/SmartHomePage'

function AppRouter() {
  return (
    <Routes>
      <Route path='/' element={<HomePage />} />
      <Route path='/live' element={<LivePage />} />
      <Route path='/camera-host' element={<CameraHostPage />} />
      <Route path='/emotion' element={<EmotionPage />} />
      <Route path='/smart-home' element={<SmartHomePage />} />
      <Route path='/settings' element={<SettingsPage />} />
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
  )
}

export default AppRouter
