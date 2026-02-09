// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
// import RealtimePage from './pages/RealtimePage'
import LiveRecorder from './pages/LiveRecorder'
import DeepRecorder from './pages/DeepRecord'
import DeepDynamicRecorder from './pages/DynamicSocket'
import ReDiarizе from './pages/ReDiariz'
import SpeechMatrix from './pages/SpeechMatrix'
import PythonePoc from './pages/PythonePoc'
import PreRecordedPythonePoc from './pages/PreRecordedPythone'
import SpeechToTextModify from './pages/ModifySpeechMatrice'
import SpeechToTextMultiSession from './pages/SessionUi'
function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<HomePage />} />
          {/* <Route path='/realtime' element={<RealtimePage />} /> */}
          {/* <Route path='/deep' element={<LiveRecorder />}></Route> */}
          {/* <Route path='/opt' element={<DeepRecorder />} /> */}


          <Route path='/dynamic' element={<DeepDynamicRecorder />}></Route>
          <Route path='/redynamic' element={<ReDiarizе />}></Route>
          <Route path='/pythonpoc' element={<PythonePoc />} />
          <Route path='/prepythone' element={<PreRecordedPythonePoc />} />


          {/* //----------- */}
          <Route path='/speechmatrix' element={<SpeechMatrix />} />
          <Route path='/speechmatrixmodify' element={<SpeechToTextModify />} />
          <Route path='/sessionSpeechMatrice' element={<SpeechToTextMultiSession/>}/>
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
