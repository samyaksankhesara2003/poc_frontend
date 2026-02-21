// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ReDiarizе from './pages/ReDiariz'
import SessionDirect from './pages/SessionDirect'
import SessionWithBackend from './pages/SessionWithBackend'
import Identification from './pages/Identification'
function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path='/redynamic' element={<ReDiarizе />}></Route>
          <Route path='/session-direct' element={<SessionDirect />} />

          {/* session with backend: WebSocket → backend → Speechmatics */}
          <Route path='/session-backend' element={<SessionWithBackend />} />
          <Route path='/identification' element={<Identification />} />

           {/* new working plan */}
          <Route path='/' element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}
export default App
