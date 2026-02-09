// import { useEffect, useRef, useState } from "react";

// const WS_URL = "ws://localhost:3000";

// export default function PythonePoc() {
//   const wsRef = useRef(null);
//   const mediaRecorderRef = useRef(null);
//   const streamRef = useRef(null);
//   const audioContextRef = useRef(null);
//   const processorRef = useRef(null);
//   const [status, setStatus] = useState("IDLE");
//   const [logs, setLogs] = useState([]);
//   const [isWaiterEnrolling, setIsWaiterEnrolling] = useState(false);

//   useEffect(() => {
//     wsRef.current = new WebSocket(WS_URL);

//     wsRef.current.onopen = () => {
//       console.log("✅ Connected to Node.js server");
//       setLogs((prev) => [...prev, "✅ Connected to server"]);
//     };

//     wsRef.current.onmessage = (event) => {
//       const data = JSON.parse(event.data);
//       console.log("📩 Received:", data);

//       if (data.type === "ENROLL_OK") {
//         setLogs((prev) => [...prev, "🔒 Waiter voice locked!"]);
//         setStatus("WAITER_LOCKED");
//         setIsWaiterEnrolling(false);
//       } else if (data.type === "SPEAKER_LABEL") {
//         setLogs((prev) => [
//           ...prev,
//           `🎤 ${data.speaker} (confidence: ${data.confidence.toFixed(3)})`
//         ]);
//       } else if (data.type === "ERROR") {
//         setLogs((prev) => [...prev, `❌ ${data.message}`]);
//       }
//     };

//     wsRef.current.onerror = (err) => {
//       console.error("WebSocket error:", err);
//       setLogs((prev) => [...prev, "❌ WebSocket error"]);
//     };

//     return () => {
//       wsRef.current?.close();
//       stopStream();
//     };
//   }, []);

//   const stopStream = () => {
//     if (audioContextRef.current) {
//       audioContextRef.current.close();
//       audioContextRef.current = null;
//     }
//     if (streamRef.current) {
//       streamRef.current.getTracks().forEach((track) => track.stop());
//       streamRef.current = null;
//     }
//   };

//   const startWaiterRecording = async () => {
//     try {
//       setStatus("RECORDING_WAITER");
//       setLogs(["🎙️ Recording waiter voice..."]);
      
//       const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//       streamRef.current = stream;
      
//       const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
//         ? "audio/webm;codecs=opus"
//         : "audio/webm";
      
//       mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });

//       const audioChunks = [];
      
//       mediaRecorderRef.current.ondataavailable = (e) => {
//         if (e.data.size > 0) {
//           console.log("📦 Chunk received:", e.data.size, "bytes");
//           audioChunks.push(e.data);
//         }
//       };

//       mediaRecorderRef.current.onstop = async () => {
//         console.log("⏹️ Recording stopped, processing audio...");
        
//         if (audioChunks.length === 0) {
//           console.error("❌ No audio chunks recorded!");
//           setLogs((prev) => [...prev, "❌ No audio recorded"]);
//           setStatus("IDLE");
//           return;
//         }

//         const audioBlob = new Blob(audioChunks, { type: mimeType });
//         console.log("📤 Converting to WAV...");
        
//         // Convert WebM to WAV using Web Audio API
//         const wavBlob = await convertToWav(audioBlob);
//         const buffer = await wavBlob.arrayBuffer();
//         const base64Audio = await arrayBufferToBase64(buffer);
        
//         console.log("📤 Sending WAV audio:", wavBlob.size, "bytes");
        
//         setIsWaiterEnrolling(true);
//         setLogs((prev) => [...prev, "📤 Sending waiter voice to server..."]);

//         wsRef.current.send(
//           JSON.stringify({
//             type: "WAITER_ENROLL",
//             audio: base64Audio,
//           })
//         );
//       };

//       mediaRecorderRef.current.start();
//       console.log("🎙️ Started recording waiter voice");
      
//     } catch (error) {
//       console.error("❌ Error starting recording:", error);
//       setLogs((prev) => [...prev, `❌ ${error.message}`]);
//       setStatus("IDLE");
//     }
//   };

//   const stopWaiterRecording = () => {
//     if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
//       console.log("⏹️ Stopping waiter recording...");
//       setLogs((prev) => [...prev, "⏹️ Processing voice..."]);
      
//       mediaRecorderRef.current.stop();
//       stopStream();
//     }
//   };

//   const startConversation = async () => {
//     if (status !== "WAITER_LOCKED") {
//       alert("Please lock waiter voice first!");
//       return;
//     }

//     try {
//       setStatus("LIVE");
//       setLogs((prev) => [...prev, "💬 Starting conversation..."]);
      
//       const stream = await navigator.mediaDevices.getUserMedia({ 
//         audio: {
//           echoCancellation: true,
//           noiseSuppression: true,
//           sampleRate: 16000
//         } 
//       });
//       streamRef.current = stream;
      
//       // Use AudioContext to get raw PCM data
//       audioContextRef.current = new AudioContext({ sampleRate: 16000 });
//       const source = audioContextRef.current.createMediaStreamSource(stream);
      
//       // Create ScriptProcessor
//       const bufferSize = 16384; // ~1 second at 16kHz
//       processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
      
//       processorRef.current.onaudioprocess = async (e) => {
//         const inputData = e.inputBuffer.getChannelData(0);
        
//         // Convert Float32Array to Int16Array (WAV format)
//         const int16Data = new Int16Array(inputData.length);
//         for (let i = 0; i < inputData.length; i++) {
//           const s = Math.max(-1, Math.min(1, inputData[i]));
//           int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
//         }
        
//         // Create WAV file
//         const wavBlob = createWavBlob(int16Data, 16000);
//         const buffer = await wavBlob.arrayBuffer();
//         const base64Audio = await arrayBufferToBase64(buffer);
        
//         if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
//           wsRef.current.send(
//             JSON.stringify({
//               type: "AUDIO_CHUNK",
//               audio: base64Audio,
//             })
//           );
//         }
//       };
      
//       source.connect(processorRef.current);
//       processorRef.current.connect(audioContextRef.current.destination);
      
//       console.log("🎙️ Started conversation recording");
      
//     } catch (error) {
//       console.error("❌ Error starting conversation:", error);
//       setLogs((prev) => [...prev, `❌ ${error.message}`]);
//       setStatus("WAITER_LOCKED");
//     }
//   };

//   const stopSession = () => {
//     if (processorRef.current) {
//       processorRef.current.disconnect();
//       processorRef.current = null;
//     }
//     stopStream();
//     setStatus("WAITER_LOCKED");
//     setLogs((prev) => [...prev, "⏹️ Session stopped"]);
//   };

//   return (
//     <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
//       <h2>🎙️ Waiter Voice Lock POC</h2>

//       <div style={{ 
//         padding: 15, 
//         background: status === "LIVE" ? "#d4edda" : "#f8f9fa",
//         border: "2px solid #dee2e6",
//         borderRadius: 8,
//         marginBottom: 20
//       }}>
//         <strong>Status:</strong> <span style={{ fontSize: 18 }}>{status}</span>
//       </div>

//       <div style={{ marginBottom: 20 }}>
//         <h3>Step 1: Enroll Waiter Voice</h3>
//         <button 
//           onClick={startWaiterRecording}
//           disabled={status !== "IDLE"}
//           style={{
//             padding: "10px 20px",
//             marginRight: 10,
//             fontSize: 16,
//             cursor: status !== "IDLE" ? "not-allowed" : "pointer",
//             background: status !== "IDLE" ? "#ccc" : "#007bff",
//             color: "white",
//             border: "none",
//             borderRadius: 5
//           }}
//         >
//           🎤 Start Waiter Voice
//         </button>
//         <button 
//           onClick={stopWaiterRecording}
//           disabled={status !== "RECORDING_WAITER" || isWaiterEnrolling}
//           style={{
//             padding: "10px 20px",
//             fontSize: 16,
//             cursor: status !== "RECORDING_WAITER" || isWaiterEnrolling ? "not-allowed" : "pointer",
//             background: status !== "RECORDING_WAITER" || isWaiterEnrolling ? "#ccc" : "#28a745",
//             color: "white",
//             border: "none",
//             borderRadius: 5
//           }}
//         >
//           {isWaiterEnrolling ? "⏳ Processing..." : "🔒 Stop & Lock Waiter"}
//         </button>
//         <p style={{ fontSize: 14, color: "#666", marginTop: 5 }}>
//           💡 Record for 3-5 seconds for best results
//         </p>
//       </div>

//       <div style={{ marginBottom: 20 }}>
//         <h3>Step 2: Start Conversation</h3>
//         <button 
//           onClick={startConversation}
//           disabled={status !== "WAITER_LOCKED"}
//           style={{
//             padding: "10px 20px",
//             marginRight: 10,
//             fontSize: 16,
//             cursor: status !== "WAITER_LOCKED" ? "not-allowed" : "pointer",
//             background: status !== "WAITER_LOCKED" ? "#ccc" : "#17a2b8",
//             color: "white",
//             border: "none",
//             borderRadius: 5
//           }}
//         >
//           💬 Start Conversation
//         </button>
//         <button 
//           onClick={stopSession}
//           disabled={status !== "LIVE"}
//           style={{
//             padding: "10px 20px",
//             fontSize: 16,
//             cursor: status !== "LIVE" ? "not-allowed" : "pointer",
//             background: status !== "LIVE" ? "#ccc" : "#dc3545",
//             color: "white",
//             border: "none",
//             borderRadius: 5
//           }}
//         >
//           ⏹️ Stop Session
//         </button>
//       </div>

//       <hr style={{ margin: "30px 0" }} />

//       <h3>📋 Logs:</h3>
//       <div style={{ 
//         maxHeight: 400, 
//         overflow: "auto", 
//         background: "#1e1e1e", 
//         color: "#d4d4d4",
//         padding: 15,
//         fontFamily: "Consolas, Monaco, monospace",
//         fontSize: 14,
//         borderRadius: 5,
//         lineHeight: 1.6
//       }}>
//         {logs.length === 0 ? (
//           <div style={{ color: "#888" }}>No logs yet...</div>
//         ) : (
//           logs.map((l, i) => (
//             <div key={i} style={{ marginBottom: 5 }}>{l}</div>
//           ))
//         )}
//       </div>
//     </div>
//   );
// }

// // Convert any audio blob to WAV using Web Audio API
// async function convertToWav(audioBlob) {
//   const arrayBuffer = await audioBlob.arrayBuffer();
//   const audioContext = new AudioContext({ sampleRate: 16000 });
//   const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
//   // Get audio data (mono)
//   const audioData = audioBuffer.getChannelData(0);
  
//   // Convert to Int16
//   const int16Data = new Int16Array(audioData.length);
//   for (let i = 0; i < audioData.length; i++) {
//     const s = Math.max(-1, Math.min(1, audioData[i]));
//     int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
//   }
  
//   // Create WAV blob
//   return createWavBlob(int16Data, audioBuffer.sampleRate);
// }

// // Create a proper WAV file from PCM data
// function createWavBlob(samples, sampleRate) {
//   const buffer = new ArrayBuffer(44 + samples.length * 2);
//   const view = new DataView(buffer);
  
//   // WAV header
//   writeString(view, 0, 'RIFF');
//   view.setUint32(4, 36 + samples.length * 2, true);
//   writeString(view, 8, 'WAVE');
//   writeString(view, 12, 'fmt ');
//   view.setUint32(16, 16, true); // fmt chunk size
//   view.setUint16(20, 1, true); // PCM format
//   view.setUint16(22, 1, true); // mono
//   view.setUint32(24, sampleRate, true);
//   view.setUint32(28, sampleRate * 2, true); // byte rate
//   view.setUint16(32, 2, true); // block align
//   view.setUint16(34, 16, true); // bits per sample
//   writeString(view, 36, 'data');
//   view.setUint32(40, samples.length * 2, true);
  
//   // Write PCM data
//   const offset = 44;
//   for (let i = 0; i < samples.length; i++) {
//     view.setInt16(offset + i * 2, samples[i], true);
//   }
  
//   return new Blob([buffer], { type: 'audio/wav' });
// }

// function writeString(view, offset, string) {
//   for (let i = 0; i < string.length; i++) {
//     view.setUint8(offset + i, string.charCodeAt(i));
//   }
// }

// async function arrayBufferToBase64(buffer) {
//   const blob = new Blob([buffer]);
//   return new Promise((resolve, reject) => {
//     const reader = new FileReader();
//     reader.onload = () => {
//       const base64 = reader.result.split(',')[1];
//       resolve(base64);
//     };
//     reader.onerror = reject;
//     reader.readAsDataURL(blob);
//   });
// }

import { useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:3000";

export default function PythonePoc() {
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const [status, setStatus] = useState("IDLE");
  const [logs, setLogs] = useState([]);
  const [transcriptions, setTranscriptions] = useState([]);
  const [isWaiterEnrolling, setIsWaiterEnrolling] = useState(false);
  const [waiterEnrollmentText, setWaiterEnrollmentText] = useState("");

  useEffect(() => {
    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onopen = () => {
      console.log("✅ Connected to Node.js server");
      setLogs((prev) => [...prev, "✅ Connected to server"]);
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("📩 Received:", data);

      if (data.type === "ENROLL_OK") {
        setLogs((prev) => [...prev, "🔒 Waiter voice locked!"]);
        if (data.transcription) {
          setWaiterEnrollmentText(data.transcription);
          setLogs((prev) => [...prev, `📝 Waiter said: "${data.transcription}"`]);
        }
        setStatus("WAITER_LOCKED");
        setIsWaiterEnrolling(false);
      } else if (data.type === "SPEAKER_LABEL") {
        const { speaker, confidence, transcription, timestamp } = data;
        
        setLogs((prev) => [
          ...prev,
          `🎤 ${speaker} (${(confidence * 100).toFixed(1)}%): "${transcription}"`
        ]);
        
        setTranscriptions((prev) => [
          ...prev,
          {
            speaker,
            confidence,
            text: transcription,
            timestamp: new Date(timestamp).toLocaleTimeString()
          }
        ]);
      } else if (data.type === "ERROR") {
        setLogs((prev) => [...prev, `❌ ${data.message}`]);
      }
    };

    wsRef.current.onerror = (err) => {
      console.error("WebSocket error:", err);
      setLogs((prev) => [...prev, "❌ WebSocket error"]);
    };

    return () => {
      wsRef.current?.close();
      stopStream();
    };
  }, []);

  const stopStream = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startWaiterRecording = async () => {
    try {
      setStatus("RECORDING_WAITER");
      setLogs(["🎙️ Recording waiter voice..."]);
      setWaiterEnrollmentText("");
      setTranscriptions([]);
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });

      const audioChunks = [];
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          console.log("📦 Chunk received:", e.data.size, "bytes");
          audioChunks.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        console.log("⏹️ Recording stopped, processing audio...");
        
        if (audioChunks.length === 0) {
          console.error("❌ No audio chunks recorded!");
          setLogs((prev) => [...prev, "❌ No audio recorded"]);
          setStatus("IDLE");
          return;
        }

        const audioBlob = new Blob(audioChunks, { type: mimeType });
        console.log("📤 Converting to WAV...");
        
        const wavBlob = await convertToWav(audioBlob);
        const buffer = await wavBlob.arrayBuffer();
        const base64Audio = await arrayBufferToBase64(buffer);
        
        console.log("📤 Sending WAV audio:", wavBlob.size, "bytes");
        
        setIsWaiterEnrolling(true);
        setLogs((prev) => [...prev, "📤 Sending waiter voice to server..."]);

        wsRef.current.send(
          JSON.stringify({
            type: "WAITER_ENROLL",
            audio: base64Audio,
          })
        );
      };

      mediaRecorderRef.current.start();
      console.log("🎙️ Started recording waiter voice");
      
    } catch (error) {
      console.error("❌ Error starting recording:", error);
      setLogs((prev) => [...prev, `❌ ${error.message}`]);
      setStatus("IDLE");
    }
  };

  const stopWaiterRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      console.log("⏹️ Stopping waiter recording...");
      setLogs((prev) => [...prev, "⏹️ Processing voice..."]);
      
      mediaRecorderRef.current.stop();
      stopStream();
    }
  };

  const startConversation = async () => {
    if (status !== "WAITER_LOCKED") {
      alert("Please lock waiter voice first!");
      return;
    }

    try {
      setStatus("LIVE");
      setLogs((prev) => [...prev, "💬 Starting conversation..."]);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;
      
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      const bufferSize = 16384;
      processorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
      
      processorRef.current.onaudioprocess = async (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        const wavBlob = createWavBlob(int16Data, 16000);
        const buffer = await wavBlob.arrayBuffer();
        const base64Audio = await arrayBufferToBase64(buffer);
        
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "AUDIO_CHUNK",
              audio: base64Audio,
            })
          );
        }
      };
      
      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);
      
      console.log("🎙️ Started conversation recording");
      
    } catch (error) {
      console.error("❌ Error starting conversation:", error);
      setLogs((prev) => [...prev, `❌ ${error.message}`]);
      setStatus("WAITER_LOCKED");
    }
  };

  const stopSession = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    stopStream();
    setStatus("WAITER_LOCKED");
    setLogs((prev) => [...prev, "⏹️ Session stopped"]);
  };

  const exportTranscript = () => {
    const transcript = transcriptions.map(t => 
      `[${t.timestamp}] ${t.speaker} (${(t.confidence * 100).toFixed(1)}%): ${t.text}`
    ).join('\n');
    
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${new Date().toISOString()}.txt`;
    a.click();
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif", maxWidth: 1200 }}>
      <h2>🎙️ Waiter Voice Lock POC with Transcription</h2>

      <div style={{ 
        padding: 15, 
        background: status === "LIVE" ? "#d4edda" : "#f8f9fa",
        border: "2px solid #dee2e6",
        borderRadius: 8,
        marginBottom: 20
      }}>
        <strong>Status:</strong> <span style={{ fontSize: 18 }}>{status}</span>
        {waiterEnrollmentText && (
          <div style={{ marginTop: 10, fontSize: 14, color: "#666" }}>
            <strong>Waiter enrolled with:</strong> "{waiterEnrollmentText}"
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 20 }}>
            <h3>Step 1: Enroll Waiter Voice</h3>
            <button 
              onClick={startWaiterRecording}
              disabled={status !== "IDLE"}
              style={{
                padding: "10px 20px",
                marginRight: 10,
                fontSize: 16,
                cursor: status !== "IDLE" ? "not-allowed" : "pointer",
                background: status !== "IDLE" ? "#ccc" : "#007bff",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              🎤 Start Waiter Voice
            </button>
            <button 
              onClick={stopWaiterRecording}
              disabled={status !== "RECORDING_WAITER" || isWaiterEnrolling}
              style={{
                padding: "10px 20px",
                fontSize: 16,
                cursor: status !== "RECORDING_WAITER" || isWaiterEnrolling ? "not-allowed" : "pointer",
                background: status !== "RECORDING_WAITER" || isWaiterEnrolling ? "#ccc" : "#28a745",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              {isWaiterEnrolling ? "⏳ Processing..." : "🔒 Stop & Lock Waiter"}
            </button>
            <p style={{ fontSize: 14, color: "#666", marginTop: 5 }}>
              💡 Record for 3-5 seconds for best results
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3>Step 2: Start Conversation</h3>
            <button 
              onClick={startConversation}
              disabled={status !== "WAITER_LOCKED"}
              style={{
                padding: "10px 20px",
                marginRight: 10,
                fontSize: 16,
                cursor: status !== "WAITER_LOCKED" ? "not-allowed" : "pointer",
                background: status !== "WAITER_LOCKED" ? "#ccc" : "#17a2b8",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              💬 Start Conversation
            </button>
            <button 
              onClick={stopSession}
              disabled={status !== "LIVE"}
              style={{
                padding: "10px 20px",
                fontSize: 16,
                cursor: status !== "LIVE" ? "not-allowed" : "pointer",
                background: status !== "LIVE" ? "#ccc" : "#dc3545",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              ⏹️ Stop Session
            </button>
          </div>

          <h3>📋 System Logs:</h3>
          <div style={{ 
            maxHeight: 300, 
            overflow: "auto", 
            background: "#1e1e1e", 
            color: "#d4d4d4",
            padding: 15,
            fontFamily: "Consolas, Monaco, monospace",
            fontSize: 12,
            borderRadius: 5,
            lineHeight: 1.6
          }}>
            {logs.length === 0 ? (
              <div style={{ color: "#888" }}>No logs yet...</div>
            ) : (
              logs.map((l, i) => (
                <div key={i} style={{ marginBottom: 5 }}>{l}</div>
              ))
            )}
          </div>
        </div>

        {/* <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>💬 Conversation Transcript</h3>
            {transcriptions.length > 0 && (
              <button 
                onClick={exportTranscript}
                style={{
                  padding: "8px 15px",
                  fontSize: 14,
                  background: "#6c757d",
                  color: "white",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer"
                }}
              >
                📥 Export
              </button>
            )}
          </div>
          <div style={{ 
            maxHeight: 500, 
            overflow: "auto", 
            background: "#fff",
            border: "1px solid #dee2e6",
            padding: 15,
            borderRadius: 5
          }}>
            {transcriptions.length === 0 ? (
              <div style={{ color: "#888", textAlign: "center", padding: 20 }}>
                Start conversation to see transcriptions...
              </div>
            ) : (
              transcriptions.map((t, i) => (
                <div 
                  key={i} 
                  style={{ 
                    marginBottom: 15,
                    padding: 12,
                    background: t.speaker === "WAITER" ? "#e7f3ff" : "#f8f9fa",
                    borderLeft: `4px solid ${t.speaker === "WAITER" ? "#007bff" : "#28a745"}`,
                    borderRadius: 4
                  }}
                >
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between",
                    marginBottom: 5,
                    fontSize: 12,
                    color: "#666"
                  }}>
                    <span>
                      <strong style={{ color: t.speaker === "WAITER" ? "#007bff" : "#28a745" }}>
                        {t.speaker}
                      </strong>
                      {" "}({(t.confidence * 100).toFixed(1)}%)
                    </span>
                    <span>{t.timestamp}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                    {t.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div> */}
      </div>
    </div>
  );
}

// Helper functions (same as before)
async function convertToWav(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const audioData = audioBuffer.getChannelData(0);
  const int16Data = new Int16Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    const s = Math.max(-1, Math.min(1, audioData[i]));
    int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  return createWavBlob(int16Data, audioBuffer.sampleRate);
}

function createWavBlob(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  
  const offset = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset + i * 2, samples[i], true);
  }
  
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

async function arrayBufferToBase64(buffer) {
  const blob = new Blob([buffer]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}