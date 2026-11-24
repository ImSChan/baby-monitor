import { Link,useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
export default function HomeReturnLink(){
  const {pathname}=useLocation()
  if(['/', '/login', '/register'].includes(pathname))return null
  return <div className="px-5 pt-3"><Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-blue-200"><ArrowLeft size={17}/>홈으로</Link></div>
}
