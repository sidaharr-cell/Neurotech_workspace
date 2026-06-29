import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Shell from './components/Layout'
import Feed from './pages/Feed'
import Research from './pages/Research'
import Devices from './pages/Devices'
import Organizations from './pages/Organizations'
import Trials from './pages/Trials'
import SearchPage from './pages/SearchPage'
import PersonProfile from './pages/PersonProfile'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Feed />} />
          <Route path="research" element={<Research />} />
          <Route path="devices" element={<Devices />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="trials" element={<Trials />} />
          <Route path="search" element={<SearchPage />} />
          {/* People: reachable by link, intentionally absent from nav + default search */}
          <Route path="people/:slug" element={<PersonProfile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
