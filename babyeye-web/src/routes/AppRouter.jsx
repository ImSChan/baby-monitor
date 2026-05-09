import { Routes, Route } from 'react-router-dom'

import HomePage from '../pages/HomePage'
import LivePage from '../pages/LivePage'
import EmotionPage from '../pages/EmotionPage'
import SmartHomePage from '../pages/SmartHomePage'
import SettingsPage from '../pages/SettingsPage'

function AppRouter() {
  return (
    <Routes>
      <Route path='/' element={<HomePage />} />
      <Route path='/live' element={<LivePage />} />
      <Route path='/emotion' element={<EmotionPage />} />
      <Route path='/smart-home' element={<SmartHomePage />} />
      <Route path='/settings' element={<SettingsPage />} />
    </Routes>
  )
}

export default AppRouter
