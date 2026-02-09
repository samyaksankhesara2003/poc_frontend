import { useEffect, useRef, useState } from "react";

const WS_URL = "ws://localhost:3000";

export default function PythonePoc() {
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState("IDLE");
  const [logs, setLogs] = useState([]);
  const [transcriptions, setTranscriptions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [waiterEnrollmentText, setWaiterEnrollmentText] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  
  const conversationChunksRef = useRef([]);

  useEffect(() => {
    connectWebSocket();
    
    return () => {
      wsRef.current?.close();
      stopStream();
    };
  }, []);

  const connectWebSocket = () => {
    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onopen = () => {
      console.log("✅ Connected to Node.js server");
      setLogs((prev) => [...prev, "✅ Connected to server"]);
      setIsConnected(true);
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("📩 Received:", data);

      if (data.type === "ENROLL_OK") {
        setLogs((prev) => [...prev, "🔒 Waiter voice locked!"]);
        if (data.transcription) {
          setWaiterEnrollmentText(data.transcription);
          setLogs((prev) => [...prev, `📝 Waiter enrolled: "${data.transcription}"`]);
        }
        setStatus("WAITER_LOCKED");
      } else if (data.type === "ANALYSIS_COMPLETE") {
        setIsProcessing(false);
        setLogs((prev) => [...prev, "✅ Analysis complete!"]);
        
        setTranscriptions(data.conversation);
        
        const waiterLines = data.conversation.filter(c => c.speaker === "WAITER").length;
        const customerLines = data.conversation.filter(c => c.speaker === "CUSTOMER").length;
        setLogs((prev) => [...prev, 
          `📊 Waiter: ${waiterLines} segments, Customer: ${customerLines} segments`
        ]);
        
        setStatus("ANALYSIS_DONE");
      } else if (data.type === "ERROR") {
        setLogs((prev) => [...prev, `❌ ${data.message}`]);
        setIsProcessing(false);
        setStatus("WAITER_LOCKED");
      }
    };

    wsRef.current.onerror = (err) => {
      console.error("WebSocket error:", err);
      setLogs((prev) => [...prev, "❌ WebSocket error"]);
      setIsConnected(false);
    };

    wsRef.current.onclose = () => {
      console.log("🔌 WebSocket closed");
      setIsConnected(false);
      setLogs((prev) => [...prev, "🔌 Disconnected from server"]);
    };
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const startWaiterRecording = async () => {
    try {
      if (!isConnected) {
        alert("Not connected to server. Please refresh the page.");
        return;
      }

      setStatus("RECORDING_WAITER");
      setLogs(["🎙️ Recording waiter voice..."]);
      setWaiterEnrollmentText("");
      setTranscriptions([]);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;
      
      // Force WAV format
      const options = { mimeType: "audio/webm" };
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      
      const audioChunks = [];
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          console.log("📦 Waiter chunk:", e.data.size, "bytes");
          audioChunks.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        console.log("⏹️ Waiter recording stopped");
        
        if (audioChunks.length === 0) {
          setLogs((prev) => [...prev, "❌ No audio recorded"]);
          setStatus("IDLE");
          stopStream();
          return;
        }

        try {
          const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          console.log("📤 Waiter blob size:", audioBlob.size);
          
          setLogs((prev) => [...prev, "🔄 Converting to WAV..."]);
          const wavBlob = await convertToWav(audioBlob);
          console.log("📤 WAV blob size:", wavBlob.size);
          
          const buffer = await wavBlob.arrayBuffer();
          const base64Audio = await arrayBufferToBase64(buffer);
          
          setLogs((prev) => [...prev, "📤 Sending waiter voice..."]);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "WAITER_ENROLL",
                audio: base64Audio,
              })
            );
          } else {
            throw new Error("WebSocket not connected");
          }
        } catch (error) {
          console.error("❌ Error processing waiter audio:", error);
          setLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
          setStatus("IDLE");
        }
        
        stopStream();
      };

      mediaRecorderRef.current.start();
      console.log("🎙️ Started recording waiter");
      
    } catch (error) {
      console.error("❌ Error:", error);
      setLogs((prev) => [...prev, `❌ ${error.message}`]);
      setStatus("IDLE");
    }
  };

  const stopWaiterRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      setLogs((prev) => [...prev, "⏹️ Processing..."]);
      mediaRecorderRef.current.stop();
    }
  };

  const startConversation = async () => {
    if (status !== "WAITER_LOCKED" && status !== "ANALYSIS_DONE") {
      alert("Please lock waiter voice first!");
      return;
    }

    if (!isConnected) {
      alert("Not connected to server. Please refresh the page.");
      return;
    }

    try {
      setStatus("RECORDING_CONVERSATION");
      setLogs((prev) => [...prev, "💬 Recording conversation..."]);
      setTranscriptions([]);
      conversationChunksRef.current = [];
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;
      
      const options = { mimeType: "audio/webm" };
      mediaRecorderRef.current = new MediaRecorder(stream, options);

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          console.log("📦 Conversation chunk:", e.data.size, "bytes");
          conversationChunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        setLogs((prev) => [...prev, "⏹️ Conversation stopped"]);
        console.log("📦 Total chunks:", conversationChunksRef.current.length);
        
        if (conversationChunksRef.current.length === 0) {
          setLogs((prev) => [...prev, "❌ No conversation recorded"]);
          setStatus("WAITER_LOCKED");
          stopStream();
          return;
        }

        try {
          const conversationBlob = new Blob(conversationChunksRef.current, { type: "audio/webm" });
          console.log("📤 Conversation blob size:", conversationBlob.size);
          
          setLogs((prev) => [...prev, "🔄 Converting to WAV..."]);
          const wavBlob = await convertToWav(conversationBlob);
          console.log("📤 Conversation WAV size:", wavBlob.size);
          
          const buffer = await wavBlob.arrayBuffer();
          const base64Audio = await arrayBufferToBase64(buffer);
          
          setIsProcessing(true);
          setStatus("PROCESSING");
          setLogs((prev) => [...prev, "🔄 Analyzing conversation..."]);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "ANALYZE_CONVERSATION",
                audio: base64Audio,
              })
            );
            console.log("✅ Sent conversation for analysis");
          } else {
            throw new Error("WebSocket not connected");
          }
        } catch (error) {
          console.error("❌ Error processing conversation:", error);
          setLogs((prev) => [...prev, `❌ Error: ${error.message}`]);
          setIsProcessing(false);
          setStatus("WAITER_LOCKED");
        }
        
        stopStream();
      };

      mediaRecorderRef.current.start(1000);
      console.log("🎙️ Started recording conversation");
      
    } catch (error) {
      console.error("❌ Error:", error);
      setLogs((prev) => [...prev, `❌ ${error.message}`]);
      setStatus("WAITER_LOCKED");
    }
  };

  const stopConversation = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      console.log("⏹️ Stopping conversation recording...");
      mediaRecorderRef.current.stop();
    }
  };

  const resetSession = () => {
    setStatus("IDLE");
    setLogs([]);
    setTranscriptions([]);
    setWaiterEnrollmentText("");
    conversationChunksRef.current = [];
  };

  const exportTranscript = () => {
    const transcript = transcriptions.map(t => 
      `[${t.start.toFixed(1)}s - ${t.end.toFixed(1)}s] ${t.speaker} (${(t.confidence * 100).toFixed(1)}%): ${t.text}`
    ).join('\n\n');
    
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation_${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif", maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2>🎙️ Waiter Voice Lock - Post-Conversation Analysis</h2>
        <div style={{ 
          padding: "8px 16px", 
          borderRadius: 20, 
          background: isConnected ? "#d4edda" : "#f8d7da",
          color: isConnected ? "#155724" : "#721c24",
          fontSize: 14,
          fontWeight: "bold"
        }}>
          {isConnected ? "🟢 Connected" : "🔴 Disconnected"}
        </div>
      </div>

      <div style={{ 
        padding: 15, 
        background: status === "RECORDING_CONVERSATION" ? "#d4edda" : "#f8f9fa",
        border: "2px solid #dee2e6",
        borderRadius: 8,
        marginBottom: 20
      }}>
        <strong>Status:</strong> <span style={{ fontSize: 18 }}>{status}</span>
        {waiterEnrollmentText && (
          <div style={{ marginTop: 10, fontSize: 14, color: "#666" }}>
            <strong>Waiter enrolled:</strong> "{waiterEnrollmentText}"
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 20 }}>
            <h3>Step 1: Enroll Waiter Voice</h3>
            <button 
              onClick={startWaiterRecording}
              disabled={status !== "IDLE" || !isConnected}
              style={{
                padding: "10px 20px",
                marginRight: 10,
                fontSize: 16,
                cursor: (status !== "IDLE" || !isConnected) ? "not-allowed" : "pointer",
                background: (status !== "IDLE" || !isConnected) ? "#ccc" : "#007bff",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              🎤 Start Waiter Voice
            </button>
            <button 
              onClick={stopWaiterRecording}
              disabled={status !== "RECORDING_WAITER"}
              style={{
                padding: "10px 20px",
                fontSize: 16,
                cursor: status !== "RECORDING_WAITER" ? "not-allowed" : "pointer",
                background: status !== "RECORDING_WAITER" ? "#ccc" : "#28a745",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              🔒 Stop & Lock Waiter
            </button>
            <p style={{ fontSize: 14, color: "#666", marginTop: 5 }}>
              💡 Record for 3-5 seconds for best results
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3>Step 2: Record Conversation</h3>
            <button 
              onClick={startConversation}
              disabled={(status !== "WAITER_LOCKED" && status !== "ANALYSIS_DONE") || !isConnected}
              style={{
                padding: "10px 20px",
                marginRight: 10,
                fontSize: 16,
                cursor: ((status !== "WAITER_LOCKED" && status !== "ANALYSIS_DONE") || !isConnected) ? "not-allowed" : "pointer",
                background: ((status !== "WAITER_LOCKED" && status !== "ANALYSIS_DONE") || !isConnected) ? "#ccc" : "#17a2b8",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              💬 Start Recording
            </button>
            <button 
              onClick={stopConversation}
              disabled={status !== "RECORDING_CONVERSATION"}
              style={{
                padding: "10px 20px",
                fontSize: 16,
                cursor: status !== "RECORDING_CONVERSATION" ? "not-allowed" : "pointer",
                background: status !== "RECORDING_CONVERSATION" ? "#ccc" : "#dc3545",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              ⏹️ Stop & Analyze
            </button>
            <p style={{ fontSize: 14, color: "#666", marginTop: 5 }}>
              📝 Conversation will be analyzed after you stop recording
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <button 
              onClick={resetSession}
              disabled={status === "IDLE" || status === "PROCESSING"}
              style={{
                padding: "10px 20px",
                fontSize: 16,
                cursor: (status === "IDLE" || status === "PROCESSING") ? "not-allowed" : "pointer",
                background: (status === "IDLE" || status === "PROCESSING") ? "#ccc" : "#6c757d",
                color: "white",
                border: "none",
                borderRadius: 5
              }}
            >
              🔄 New Session
            </button>
          </div>

          <h3>📋 System Logs:</h3>
          <div style={{ 
            maxHeight: 400, 
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

        <div style={{ flex: 1.5 }}>
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
            maxHeight: 650, 
            overflow: "auto", 
            background: "#fff",
            border: "1px solid #dee2e6",
            padding: 15,
            borderRadius: 5
          }}>
            {isProcessing ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 20 }}>⏳</div>
                <div style={{ fontSize: 18, color: "#666" }}>Analyzing conversation...</div>
                <div style={{ fontSize: 14, color: "#999", marginTop: 10 }}>
                  This may take a moment
                </div>
              </div>
            ) : transcriptions.length === 0 ? (
              <div style={{ color: "#888", textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 20 }}>📝</div>
                <div>Record a conversation to see the transcript</div>
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
                    <span>{t.start.toFixed(1)}s - {t.end.toFixed(1)}s</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                    {t.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Improved WAV conversion
async function convertToWav(audioBlob) {
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Get mono channel
    const audioData = audioBuffer.getChannelData(0);
    
    // Convert to Int16
    const int16Data = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Close audio context to free resources
    await audioContext.close();
    
    return createWavBlob(int16Data, audioBuffer.sampleRate);
  } catch (error) {
    console.error("WAV conversion error:", error);
    throw new Error(`WAV conversion failed: ${error.message}`);
  }
}

function createWavBlob(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  
  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, samples.length * 2, true);
  
  // write the PCM samples
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
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}