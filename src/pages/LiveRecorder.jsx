// import { useEffect, useRef, useState } from "react";

// export default function LiveRecorder() {
//     const socketRef = useRef(null);
//     const mediaRecorderRef = useRef(null);
//     const [isRecording, setIsRecording] = useState(false);
//     const [transcript, setTranscript] = useState("");




//     useEffect(() => {
//         if (socketRef.current) return;

//         socketRef.current = new WebSocket("ws://localhost:3000");

//         socketRef.current.onopen = () => {
//             console.log("✅ WebSocket connected");
//         };

//         socketRef.current.onmessage = (event) => {
//             const data = JSON.parse(event.data);
//             console.log(data.speakers, "data.speakers");

//             if (data.text) {
//                 setTranscript((prev) => prev + " " + data.text);
//             }
//         };

//         return () => {
//             socketRef.current?.close();
//             socketRef.current = null;
//         };
//     }, []);

//     const startRecording = async () => {
//         const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

//         const mediaRecorder = new MediaRecorder(stream, {
//             mimeType: "audio/webm;codecs=opus",
//         });

//         mediaRecorderRef.current = mediaRecorder;

//         mediaRecorder.ondataavailable = (event) => {
//             if (
//                 event.data.size > 0 &&
//                 socketRef.current?.readyState === WebSocket.OPEN
//             ) {
//                 event.data.arrayBuffer().then((buffer) => {
//                     socketRef.current.send(buffer);
//                 });
//             }
//         };

//         mediaRecorder.start(250); // send audio every 250ms
//         setIsRecording(true);
//     };

//     const stopRecording = () => {
//         mediaRecorderRef.current?.stop();
//         setIsRecording(false);
//     };

//     return (
//         <div style={{ padding: 20 }}>
//             <h2>🎙️ Live Conversation</h2>

//             {!isRecording ? (
//                 <button onClick={startRecording}>Start Speaking</button>
//             ) : (
//                 <button onClick={stopRecording}>Stop</button>
//             )}

//             <div
//                 style={{
//                     marginTop: 20,
//                     padding: 10,
//                     minHeight: 100,
//                     border: "1px solid #ccc",
//                 }}
//             >
//                 <strong>Live Transcript:</strong>
//                 <p>{transcript}</p>
//             </div>
//         </div>
//     );
// }
//-------------------------------------------------------------------------- working with open socket
import { useEffect, useRef, useState } from "react";

export default function LiveRecorder() {
    const socketRef = useRef(null);
    const mediaRecorderRef = useRef(null);

    const [isRecording, setIsRecording] = useState(false);  
    const [segments, setSegments] = useState([]);
    // segments = [{ speaker: 0, text: "hello" }, ...]

    useEffect(() => {
        if (socketRef.current) return;

        socketRef.current = new WebSocket("ws://localhost:3000");

        socketRef.current.onopen = () => {
            console.log("✅ WebSocket connected");
        };

        socketRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === "transcript" && data.speakers) {
                setSegments((prev) => [...prev, ...data.speakers]);
            }
            // if (data.type === "final_transcript" && data.speakers) {
            //     setSegments((prev) => [...prev, ...data.speakers]);
            //   }
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
        // const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1, // Mono audio works better for diarization
                sampleRate: 16000, // Standard for speech recognition
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }
        });
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

        mediaRecorder.start(250); // send audio every 250ms
        // mediaRecorder.start(1000);
        setIsRecording(true);
    };

    const stopRecording = () => {
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
    };

    return (
        <div style={{ padding: 20 }}>
            <h2>🎙️ Live Conversation (Speaker Diarization)</h2>

            {!isRecording ? (
                <button onClick={startRecording}>Start Speaking</button>
            ) : (
                <button onClick={stopRecording}>Stop</button>
            )}

            <div
                style={{
                    marginTop: 20,
                    padding: 10,
                    minHeight: 120,
                    border: "1px solid #ccc",
                    borderRadius: 6,
                }}
            >
                <strong>Live Transcript:</strong>

                {segments.length === 0 && (
                    <p style={{ color: "#888" }}>Start speaking…</p>
                )}

                {segments.map((seg, index) => (
                    <p key={index} style={{ margin: "6px 0" }}>
                        <strong>Speaker {seg.speaker}:</strong> {seg.text}
                    </p>
                ))}
            </div>
        </div>
    );
}
//-------------------------------------------------------------------------- working with open socket


//--working with closed socket
// import { useRef, useState } from "react";

// export default function LiveRecorder() {
//   const socketRef = useRef(null);
//   const mediaRecorderRef = useRef(null);

//   const [isRecording, setIsRecording] = useState(false);
//   const [segments, setSegments] = useState([]);

//   const startRecording = async () => {
//     // 1️⃣ Open WebSocket
//     socketRef.current = new WebSocket("ws://localhost:3000");

//     socketRef.current.onopen = async () => {
//       console.log("✅ WebSocket connected");

//       // 2️⃣ Start microphone ONLY after WS is ready
//       const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

//       const mediaRecorder = new MediaRecorder(stream, {
//         mimeType: "audio/webm;codecs=opus",
//       });

//       mediaRecorderRef.current = mediaRecorder;

//       mediaRecorder.ondataavailable = (event) => {
//         if (
//           event.data.size > 0 &&
//           socketRef.current?.readyState === WebSocket.OPEN
//         ) {
//           event.data.arrayBuffer().then((buffer) => {
//             socketRef.current.send(buffer);
//           });
//         }
//       };

//       mediaRecorder.start(250);
//       setIsRecording(true);
//     };

//     socketRef.current.onmessage = (event) => {
//       const data = JSON.parse(event.data);

//       if (data.type === "final_transcript" && data.speakers) {
//         setSegments((prev) => [...prev, ...data.speakers]);
//       }
//     };

//     socketRef.current.onerror = console.error;
//   };

//   const stopRecording = () => {
//     // 3️⃣ Stop mic
//     mediaRecorderRef.current?.stop();

//     // 4️⃣ Close WebSocket
//     socketRef.current?.close();

//     mediaRecorderRef.current = null;
//     socketRef.current = null;

//     setIsRecording(false);
//   };

//   return (
//     <div style={{ padding: 20 }}>
//       <h2>🎙️ Live Conversation</h2>

//       {!isRecording ? (
//         <button onClick={startRecording}>Start Speaking</button>
//       ) : (
//         <button onClick={stopRecording}>Stop</button>
//       )}

//       <div style={{ marginTop: 20 }}>
//         {segments.map((seg, i) => (
//           <p key={i}>
//             <strong>Speaker {seg.speaker}:</strong> {seg.text}
//           </p>
//         ))}
//       </div>
//     </div>
//   );
// }
//-------------------------------------------------------------------------- working with closed socket