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
import DirectUiToSpeechSpeech from './pages/DirectUiToSpeechSpeech'
import SessionDirect from './pages/SessionDirect'
import SessionWithBackend from './pages/SessionWithBackend'
import Identification from './pages/Identification'
function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path='/' element={<HomePage />} />
          {/* <Route path='/realtime' element={<RealtimePage />} /> */}
          {/* <Route path='/deep' element={<LiveRecorder />}></Route> */}
          {/* <Route path='/opt' element={<DeepRecorder />} /> */}
          {/* <Route path='/pythonpoc' element={<PythonePoc />} />
          <Route path='/prepythone' element={<PreRecordedPythonePoc />} /> */}
          {/* <Route path='/sessionSpeechMatrice' element={<SpeechToTextMultiSession/>}/> */}


          <Route path='/dynamic' element={<DeepDynamicRecorder />}></Route>
          <Route path='/redynamic' element={<ReDiarizе />}></Route>
          {/* //----------- */}

          {/* with backend speechmatics */}
          <Route path='/speechmatrix' element={<SpeechMatrix />} />
          <Route path='/speechmatrixmodify' element={<SpeechToTextModify />} />

          {/* without backend - direct Speechmatics from browser */}
          <Route path='/direct-speech' element={<DirectUiToSpeechSpeech/>}/>
          <Route path='/session-direct' element={<SessionDirect/>}/>

          {/* session with backend: WebSocket → backend → Speechmatics */}
          <Route path='/session-backend' element={<SessionWithBackend/>}/>

          <Route path='/identification' element={<Identification/>}/>
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
