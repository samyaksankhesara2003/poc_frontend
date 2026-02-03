// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
// import RealtimePage from './pages/RealtimePage'
import LiveRecorder from './pages/LiveRecorder'
import DeepRecorder from './pages/DeepRecord'
import DeepDynamicRecorder from './pages/DynamicSocket'

function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<HomePage />} />
          {/* <Route path='/realtime' element={<RealtimePage />} /> */}
          <Route path='/deep' element={<LiveRecorder />}></Route>
          <Route path='/opt' element={<DeepRecorder />} />
          <Route path='/dynamic' element={<DeepDynamicRecorder />}></Route>
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
