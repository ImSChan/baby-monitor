import { BrowserRouter } from 'react-router-dom'
import AppRouter from './routes/AppRouter'
import BottomNav from './components/common/BottomNav'

function App() {
  return (
    <BrowserRouter>
      <div className='min-h-screen bg-[#0B1020] text-white'>
        <div className='mx-auto min-h-screen max-w-[430px] bg-[#0B1020] pb-24'>
          <AppRouter />
        </div>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}

export default App
