// import './App.css'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'

import SessionDirect from './pages/SessionDirect'
import SessionWithBackend from './pages/SessionWithBackend'
import WaiterEnrollment from './pages/WaiterEnrollment'
import WaiterConversation from './pages/WaiterConversation'
function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          {/* <Route path='/realtime' element={<RealtimePage />} /> */}
          {/* <Route path='/deep' element={<LiveRecorder />}></Route> */}
          {/* <Route path='/opt' element={<DeepRecorder />} /> */}
          {/* <Route path='/pythonpoc' element={<PythonePoc />} />
          <Route path='/prepythone' element={<PreRecordedPythonePoc />} /> */}
          {/* <Route path='/sessionSpeechMatrice' element={<SpeechToTextMultiSession/>}/> */}


          {/* //----------- */}

          {/* with backend speechmatics */}
          {/*<Route path='/dynamic' element={<DeepDynamicRecorder />}></Route>
          <Route path='/redynamic' element={<ReDiarizе />}></Route>
          <Route path='/speechmatrix' element={<SpeechMatrix />} />
          <Route path='/speechmatrixmodify' element={<SpeechToTextModify />} />
          <Route path='/direct-speech' element={<DirectUiToSpeechSpeech/>}/>*/}

          {/* without backend - direct Speechmatics from browser */}

          {/* session with backend: WebSocket → backend → Speechmatics */}
          <Route path='/' element={<HomePage />} />

          <Route path='/session-direct' element={<SessionDirect />} />
          <Route path='/session-backend' element={<SessionWithBackend />} />
          <Route path='/waiter-enrollment' element={<WaiterEnrollment />} />
          <Route path='/waiter-conversation' element={<WaiterConversation />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
