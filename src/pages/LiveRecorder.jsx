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
                // setSegments(data.speakers);
                setSegments((prev) => [...prev, ...data.speakers]);
            }
            // if (data.type === "final_transcript" && data.speakers) {
            //     setSegments((prev) => [...prev, ...data.speakers]);
            // }
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        const mediaRecorder = new MediaRecorder(stream, {
            mimeType: "audio/webm;codecs=opus",
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
