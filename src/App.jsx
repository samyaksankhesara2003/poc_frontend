// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import Profile from './pages/Profile'
import HomePage from './pages/HomePage'
import ReDiarizе from './pages/ReDiariz'
import SessionDirect from './pages/SessionDirect'
import SessionWithBackend from './pages/SessionWithBackend'
import Identification from './pages/Identification'
import Conversation from './pages/Conversation'

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/conversation" element={<Conversation />} />

          <Route path='/redynamic' element={<ReDiarizе />}></Route>
          <Route path='/session-direct' element={<SessionDirect />} />
          <Route path='/session-backend' element={<SessionWithBackend />} />
          <Route path='/identification' element={<Identification />} />

          <Route path='/home' element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}
export default App
