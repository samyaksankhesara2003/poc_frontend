// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
// import RealtimePage from './pages/RealtimePage'
import LiveRecorder from './pages/LiveRecorder'

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<HomePage />} />
          {/* <Route path='/realtime' element={<RealtimePage />} /> */}
          <Route path='/deep' element={<LiveRecorder/>}></Route>
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
