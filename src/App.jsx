// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RealtimePage from './pages/RealtimePage'

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<HomePage />} />
          <Route path='/realtime' element={<RealtimePage />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
