import { useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

const RealtimePage = () => {
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorderRef.current = new MediaRecorder(stream);
    chunksRef.current = [];

    recorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    // Send complete audio when stopped
    recorderRef.current.onstop = async () => {
      if (chunksRef.current.length > 0) {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        const arrayBuffer = await audioBlob.arrayBuffer();
        
        socket.emit("audio-complete", arrayBuffer);
        chunksRef.current = [];
      }
    };

    // Record in 5-second segments for pseudo real-time
    recorderRef.current.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recorderRef.current && isRecording) {
      recorderRef.current.stop();
      recorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  socket.on("realtime-text", (newText) => {
    setText(newText);
  });

  return (
    <div style={{ padding: "20px" }}>
      <h2>Voice to Text</h2>
      <button onClick={startRecording} disabled={isRecording}>
        Start Recording
      </button>
      <button onClick={stopRecording} disabled={!isRecording}>
        Stop Recording
      </button>

      <div style={{ marginTop: "20px", padding: "10px", border: "1px solid #ccc" }}>
        <strong>Transcription:</strong>
        <pre style={{ whiteSpace: "pre-wrap" }}>{text || "Click Start to begin..."}</pre>
      </div>
    </div>
  );
};

export default RealtimePage;



// import { useRef, useState } from "react";
// import { io } from "socket.io-client";

// const socket = io("http://localhost:3000");

// const RealtimePage = () => {
//   const recorderRef = useRef(null);
//   const chunksRef = useRef([]);
//   const streamRef = useRef(null);
//   const isRecordingRef = useRef(false); // Use ref instead of state for immediate updates
//   const [text, setText] = useState("");
//   const [isRecording, setIsRecording] = useState(false);

//   const sendAudio = async () => {
//     if (chunksRef.current.length > 0) {
//       const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
//       const arrayBuffer = await audioBlob.arrayBuffer();
      
//       socket.emit("audio-segment", arrayBuffer);
//       chunksRef.current = [];
//     }
//   };

//   const startNewRecorder = () => {
//     if (!isRecordingRef.current) return; // Don't start if stopped

//     recorderRef.current = new MediaRecorder(streamRef.current);
    
//     recorderRef.current.ondataavailable = (e) => {
//       if (e.data.size > 0) {
//         chunksRef.current.push(e.data);
//       }
//     };

//     recorderRef.current.onstop = async () => {
//       await sendAudio();
      
//       // Only start new recorder if still recording
//       if (isRecordingRef.current) {
//         setTimeout(() => startNewRecorder(), 100); // Small delay before next segment
//       }
//     };

//     recorderRef.current.start();
    
//     // Stop and restart every 3 seconds
//     setTimeout(() => {
//       if (recorderRef.current && recorderRef.current.state === "recording") {
//         recorderRef.current.stop();
//       }
//     }, 3000);
//   };

//   const startRecording = async () => {
//     try {
//       streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
//       chunksRef.current = [];
//       isRecordingRef.current = true;
//       setIsRecording(true);
      
//       startNewRecorder();
//     } catch (error) {
//       console.error("Error starting recording:", error);
//       alert("Microphone access denied");
//     }
//   };

//   const stopRecording = async () => {
//     isRecordingRef.current = false; // Stop creating new recorders
//     setIsRecording(false);
    
//     if (recorderRef.current && recorderRef.current.state === "recording") {
//       recorderRef.current.stop();
//     }
    
//     if (streamRef.current) {
//       streamRef.current.getTracks().forEach(track => track.stop());
//     }
//   };

//   // Set up socket listener
//   socket.off("realtime-text"); // Remove old listeners
//   socket.on("realtime-text", (newText) => {
//     console.log("Received text:", newText);
//     setText((prev) => prev + " " + newText);
//   });

//   return (
//     <div style={{ padding: "20px" }}>
//       <h2>Realtime Voice to Text</h2>
//       <button 
//         onClick={startRecording} 
//         disabled={isRecording}
//         style={{ 
//           padding: "10px 20px", 
//           fontSize: "16px", 
//           marginRight: "10px",
//           backgroundColor: isRecording ? "#ccc" : "#4CAF50",
//           color: "white",
//           border: "none",
//           borderRadius: "5px",
//           cursor: isRecording ? "not-allowed" : "pointer"
//         }}
//       >
//         {isRecording ? "Recording..." : "Start Recording"}
//       </button>
//       <button 
//         onClick={stopRecording} 
//         disabled={!isRecording}
//         style={{ 
//           padding: "10px 20px", 
//           fontSize: "16px",
//           backgroundColor: !isRecording ? "#ccc" : "#f44336",
//           color: "white",
//           border: "none",
//           borderRadius: "5px",
//           cursor: !isRecording ? "not-allowed" : "pointer"
//         }}
//       >
//         Stop Recording
//       </button>

//       <div style={{ 
//         marginTop: "20px", 
//         padding: "15px", 
//         border: "2px solid #ddd",
//         borderRadius: "5px",
//         backgroundColor: "#f9f9f9",
//         minHeight: "100px"
//       }}>
//         <strong>Transcription:</strong>
//         <pre style={{ 
//           whiteSpace: "pre-wrap", 
//           fontFamily: "Arial",
//           fontSize: "16px",
//           marginTop: "10px"
//         }}>
//           {text || "Click 'Start Recording' to begin..."}
//         </pre>
//       </div>
//     </div>
//   );
// };

// export default RealtimePage;