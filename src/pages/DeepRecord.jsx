import axios from "axios";
import { useEffect, useRef, useState } from "react";

export default function DeepRecorder() {
    const socketRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const streamRef = useRef(null);

    const [isRecording, setIsRecording] = useState(false);
    const [segments, setSegments] = useState([]);
    const [interimText, setInterimText] = useState("");

    useEffect(() => {
        if (socketRef.current) return;

        socketRef.current = new WebSocket("ws://localhost:3000");

        socketRef.current.onopen = () => {
            console.log("✅ WebSocket connected");
        };

        socketRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === "interim_transcript") {
                setInterimText(data.transcript);
            } else if (data.type === "transcript" && data.speakers) {
                setSegments((prev) => [...prev, ...data.speakers]);
                setInterimText(""); // Clear interim when final arrives
            }
        };

        socketRef.current.onerror = (err) => {
            console.error("WebSocket error:", err);
        };

        return () => {
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, []);

    const startRecording = async () => {
        try {
            // Request high-quality audio
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1, // Mono audio works better for diarization
                    sampleRate: 16000, // Standard for speech recognition
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });

            streamRef.current = stream;

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: "audio/webm;codecs=opus",
                audioBitsPerSecond: 16000, // Good quality for speech
            });

            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (
                    event.data.size > 0 &&
                    socketRef.current?.readyState === WebSocket.OPEN
                ) {
                    event.data.arrayBuffer().then((buffer) => {
                        socketRef.current.send(buffer);
                    });
                }
            };

            // ✅ Increased chunk duration for better diarization
            mediaRecorder.start(1000); // 1 second chunks
            setIsRecording(true);
        } catch (error) {
            console.error("Error starting recording:", error);
            alert("Microphone access denied or not available");
        }
    };

    const stopRecording = async () => {
        mediaRecorderRef.current?.stop();

        // Stop all audio tracks
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
        const x = segments
            .map((m) => `Speaker ${m.speaker}: ${m.text}`)
            .join("\n");
        console.log(x, "saas");
        // const response = await axios.post('http://localhost:3000/poc/analysis', { text: x }, { headers: ' "Content-Type": "application/json"' })
        // console.log(response);
        setIsRecording(false);
        setInterimText("");
    };

    return (
        <div style={{ padding: 20 }}>
            <h2>🎙️ Live Conversation (Speaker Diarization)</h2>

            {!isRecording ? (
                <button
                    onClick={startRecording}
                    style={{
                        padding: "10px 20px",
                        fontSize: "16px",
                        backgroundColor: "#4CAF50",
                        color: "white",
                        border: "none",
                        borderRadius: "5px",
                        cursor: "pointer"
                    }}
                >
                    Start Speaking
                </button>
            ) : (
                <button
                    onClick={stopRecording}
                    style={{
                        padding: "10px 20px",
                        fontSize: "16px",
                        backgroundColor: "#f44336",
                        color: "white",
                        border: "none",
                        borderRadius: "5px",
                        cursor: "pointer"
                    }}
                >
                    Stop
                </button>
            )}

            <div
                style={{
                    marginTop: 20,
                    padding: 15,
                    minHeight: 200,
                    border: "2px solid #ddd",
                    borderRadius: 8,
                    backgroundColor: "#f9f9f9",
                }}
            >
                <strong>Live Transcript:</strong>

                {segments.length === 0 && !interimText && (
                    <p style={{ color: "#888", fontStyle: "italic" }}>
                        Start speaking… Make sure there are pauses between speakers for better diarization.
                    </p>
                )}

                {segments.map((seg, index) => (
                    <p key={index} style={{ margin: "10px 0", lineHeight: "1.6" }}>
                        <strong style={{
                            color: seg.speaker === 0 ? "#2196F3" : "#FF9800",
                            marginRight: "8px"
                        }}>
                            Speaker {seg.speaker}:
                        </strong>
                        {seg.text}
                    </p>
                ))}

                {interimText && (
                    <p style={{
                        margin: "10px 0",
                        color: "#999",
                        fontStyle: "italic"
                    }}>
                        <strong>...</strong> {interimText}
                    </p>
                )}
            </div>

            <div style={{ marginTop: 20, fontSize: "14px", color: "#666" }}>
                <strong>Tips for better diarization:</strong>
                <ul>
                    <li>Speak clearly with pauses between speakers</li>
                    <li>Avoid talking over each other</li>
                    <li>Use a good quality microphone</li>
                    <li>Minimize background noise</li>
                </ul>
            </div>
        </div>
    );
}

// import axios from "axios";
// import { useEffect, useRef, useState } from "react";

// export default function DeepRecorder() {
//     const socketRef = useRef(null);
//     const mediaRecorderRef = useRef(null);
//     const streamRef = useRef(null);

//     const [isRecording, setIsRecording] = useState(false);
//     const [segments, setSegments] = useState([]);
//     const [interimText, setInterimText] = useState("");

   

//     const startRecording = async () => {
//         setSegments([]);
//         setInterimText("");
      
//         socketRef.current = new WebSocket("ws://localhost:3000");
      
//         socketRef.current.onopen = async () => {
//           console.log("✅ WebSocket connected");
      
//           // give backend time to connect Deepgram
//           await new Promise(r => setTimeout(r, 300));
      
//           const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//           streamRef.current = stream;
      
//           const mediaRecorder = new MediaRecorder(stream, {
//             mimeType: "audio/webm;codecs=opus",
//           });
      
//           mediaRecorderRef.current = mediaRecorder;
      
//           mediaRecorder.ondataavailable = (e) => {
//             if (
//               e.data.size > 0 &&
//               socketRef.current?.readyState === WebSocket.OPEN
//             ) {
//               e.data.arrayBuffer().then(buf => {
//                 socketRef.current.send(buf);
//               });
//             }
//           };
      
//         //   mediaRecorder.start();
//         //   setTimeout(() => mediaRecorder.requestData(), 50);
//           mediaRecorder.start(1000);
      
//           setIsRecording(true);
//         };
      
//         socketRef.current.onmessage = (e) => {
//           const data = JSON.parse(e.data);
      
//           if (data.type === "interim_transcript") {
//             setInterimText(data.transcript);
//           }
      
//           if (data.type === "transcript") {
//             setSegments(prev => [...prev, ...data.speakers]);
//             setInterimText("");
//           }
//         };
//       };
      

//     const stopRecording = async () => {
//         mediaRecorderRef.current?.stop();

//         // Stop all audio tracks
//         if (streamRef.current) {
//             streamRef.current.getTracks().forEach(track => track.stop());
//         }
//         const x = segments
//             .map((m) => `Speaker ${m.speaker}: ${m.text}`)
//             .join("\n");
//         console.log(x, "saas");
//         // const response = await axios.post('http://localhost:3000/poc/analysis', { text: x }, { headers: ' "Content-Type": "application/json"' })
//         // console.log(response);
//         setIsRecording(false);
//         setInterimText("");
//     };

//     return (
//         <div style={{ padding: 20 }}>
//             <h2>🎙️ Live Conversation (Speaker Diarization)</h2>

//             {!isRecording ? (
//                 <button
//                     onClick={startRecording}
//                     style={{
//                         padding: "10px 20px",
//                         fontSize: "16px",
//                         backgroundColor: "#4CAF50",
//                         color: "white",
//                         border: "none",
//                         borderRadius: "5px",
//                         cursor: "pointer"
//                     }}
//                 >
//                     Start Speaking
//                 </button>
//             ) : (
//                 <button
//                     onClick={stopRecording}
//                     style={{
//                         padding: "10px 20px",
//                         fontSize: "16px",
//                         backgroundColor: "#f44336",
//                         color: "white",
//                         border: "none",
//                         borderRadius: "5px",
//                         cursor: "pointer"
//                     }}
//                 >
//                     Stop
//                 </button>
//             )}

//             <div
//                 style={{
//                     marginTop: 20,
//                     padding: 15,
//                     minHeight: 200,
//                     border: "2px solid #ddd",
//                     borderRadius: 8,
//                     backgroundColor: "#f9f9f9",
//                 }}
//             >
//                 <strong>Live Transcript:</strong>

//                 {segments.length === 0 && !interimText && (
//                     <p style={{ color: "#888", fontStyle: "italic" }}>
//                         Start speaking… Make sure there are pauses between speakers for better diarization.
//                     </p>
//                 )}

//                 {segments.map((seg, index) => (
//                     <p key={index} style={{ margin: "10px 0", lineHeight: "1.6" }}>
//                         <strong style={{
//                             color: seg.speaker === 0 ? "#2196F3" : "#FF9800",
//                             marginRight: "8px"
//                         }}>
//                             Speaker {seg.speaker}:
//                         </strong>
//                         {seg.text}
//                     </p>
//                 ))}

//                 {interimText && (
//                     <p style={{
//                         margin: "10px 0",
//                         color: "#999",
//                         fontStyle: "italic"
//                     }}>
//                         <strong>...</strong> {interimText}
//                     </p>
//                 )}
//             </div>

//             <div style={{ marginTop: 20, fontSize: "14px", color: "#666" }}>
//                 <strong>Tips for better diarization:</strong>
//                 <ul>
//                     <li>Speak clearly with pauses between speakers</li>
//                     <li>Avoid talking over each other</li>
//                     <li>Use a good quality microphone</li>
//                     <li>Minimize background noise</li>
//                 </ul>
//             </div>
//         </div>
//     );
// }