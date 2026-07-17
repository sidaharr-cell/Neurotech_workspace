import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Shell from './components/Layout'
import Feed from './pages/Feed'
import Media from './pages/Media'
import Research from './pages/Research'
import Trials from './pages/Trials'
import Companies from './pages/Companies'
import Devices from './pages/Devices'
import SearchPage from './pages/SearchPage'
import PersonProfile from './pages/PersonProfile'
import ItemDetail from './pages/ItemDetail'
import PaperDetail from './pages/PaperDetail'
import HowItWorks from './pages/HowItWorks'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Feed />} />
          <Route path="media" element={<Media />} />
          <Route path="research" element={<Research />} />
          <Route path="trials" element={<Trials />} />
          <Route path="companies" element={<Companies />} />
          <Route path="devices" element={<Devices />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="item/:id" element={<ItemDetail />} />
          <Route path="paper/:pmid" element={<PaperDetail />} />
          {/* People: reachable by link, intentionally absent from nav + default search */}
          <Route path="people/:slug" element={<PersonProfile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
