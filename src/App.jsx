// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Login from './pages/Login'
import Profile from './pages/Profile'
import Conversation from './pages/Conversation'

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/conversation" element={<Conversation />} />


        </Routes>
      </BrowserRouter>
    </>
  )
}
export default App
