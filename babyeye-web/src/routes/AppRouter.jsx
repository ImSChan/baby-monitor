import { Navigate, Route, Routes } from 'react-router-dom'

import BottomNav from '../components/layout/BottomNav'
import CameraHostPage from '../pages/CameraHostPage'
import EmotionPage from '../pages/EmotionPage'
import HomePage from '../pages/HomePage'
import LivePage from '../pages/LivePage'
import SettingsPage from '../pages/SettingsPage'
import SmartHomePage from '../pages/SmartHomePage'

function AppRouter() {
  return (
    <div className='mx-auto min-h-screen max-w-[430px] bg-slate-950 text-white'>
      <div className='pb-24'>
        <Routes>
          <Route path='/' element={<HomePage />} />
          <Route path='/live' element={<LivePage />} />
          <Route path='/camera-host' element={<CameraHostPage />} />
          <Route path='/emotion' element={<EmotionPage />} />
          <Route path='/smart-home' element={<SmartHomePage />} />
          <Route path='/settings' element={<SettingsPage />} />
          <Route path='*' element={<Navigate to='/' replace />} />
        </Routes>
      </div>

      <BottomNav />
    </div>
  )
}

export default AppRouter
