import axios from "axios";
import { useRef, useState } from "react";

export default function DeepDynamicRecorder() {
    const socketRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const streamRef = useRef(null);

    const [sessionState, setSessionState] = useState("idle");
    const [segments, setSegments] = useState([]);
    const [interimText, setInterimText] = useState("");

    // ─────────────────────────────
    // 🔌 Open WebSocket + Start Session
    // ─────────────────────────────
    const startSession = async () => {
        socketRef.current = new WebSocket("ws://localhost:3000");

        socketRef.current.onopen = async () => {
            console.log("✅ WebSocket connected");

            socketRef.current.send(JSON.stringify({ type: "START" }));

            await startMicrophone();
            setSessionState("recording");
        };

        socketRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === "interim_transcript") {
                setInterimText(data.transcript);
            }

            if (data.type === "transcript" && data.speakers) {
                setSegments((prev) => [...prev, ...data.speakers]);
                setInterimText("");
            }
        };

        socketRef.current.onerror = (err) => {
            console.error("WebSocket error:", err);
        };
    };

    // ─────────────────────────────
    // 🎤 Start Microphone
    // ─────────────────────────────
    const startMicrophone = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        streamRef.current = stream;

        const recorder = new MediaRecorder(stream, {
            mimeType: "audio/webm;codecs=opus",
        });

        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
            if (
                event.data.size > 0 &&
                socketRef.current?.readyState === WebSocket.OPEN
            ) {
                event.data.arrayBuffer().then((buffer) => {
                    socketRef.current.send(buffer);
                });
            }
        };

        recorder.start(1000); // 1s chunks (best for diarization)
    };

    // ─────────────────────────────
    // ⏸ Pause Session
    // ─────────────────────────────
    const pauseSession = () => {
        mediaRecorderRef.current?.stop();
        socketRef.current?.send(JSON.stringify({ type: "PAUSE" }));
        setSessionState("paused");
    };

    // ─────────────────────────────
    // ▶️ Resume Session
    // ─────────────────────────────
    const resumeSession = async () => {
        socketRef.current?.send(JSON.stringify({ type: "RESUME" }));
        await startMicrophone();
        setSessionState("recording");
    };

    // ─────────────────────────────
    // ⏹ Stop Session
    // ─────────────────────────────
    const stopSession = async () => {
        mediaRecorderRef.current?.stop();
        streamRef.current?.getTracks().forEach((t) => t.stop());

        socketRef.current?.send(JSON.stringify({ type: "STOP" }));
        socketRef.current?.close();

        const finalText = segments
            .map((s) => `Speaker ${s.speaker}: ${s.text}`)
            .join("\n");

        // await axios.post("http://localhost:3000/poc/analysis", {
        //     text: finalText,
        // });

        mediaRecorderRef.current = null;
        streamRef.current = null;
        socketRef.current = null;

        setSessionState("idle");
        setInterimText("");
    };

    // ─────────────────────────────
    // 🖥 UI
    // ─────────────────────────────
    return (
        <div style={{ padding: 20 }}>
            <h2>🎙️ Live Conversation (Deepgram)</h2>

            {sessionState === "idle" && (
                <button onClick={startSession} style={btn("green")}>
                    Start
                </button>
            )}

            {sessionState === "recording" && (
                <>
                    <button onClick={pauseSession} style={btn("orange")}>
                        Pause
                    </button>
                    <button onClick={stopSession} style={btn("red")}>
                        Stop
                    </button>
                </>
            )}

            {sessionState === "paused" && (
                <>
                    <button onClick={resumeSession} style={btn("green")}>
                        Resume
                    </button>
                    <button onClick={stopSession} style={btn("red")}>
                        Stop
                    </button>
                </>
            )}

            <div style={box}>
                <strong>Transcript:</strong>

                {segments.map((seg, i) => (
                    <p key={i}>
                        <strong>Speaker {seg.speaker}:</strong> {seg.text}
                    </p>
                ))}

                {interimText && (
                    <p style={{ color: "#999" }}>
                        <em>{interimText}</em>
                    </p>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────
// 🎨 Styles
// ─────────────────────────────
const btn = (color) => ({
    marginRight: 10,
    padding: "10px 18px",
    backgroundColor: color,
    color: "#fff",
    border: "none",
    borderRadius: 5,
    cursor: "pointer",
});

const box = {
    marginTop: 20,
    padding: 15,
    border: "1px solid #ccc",
    borderRadius: 6,
    minHeight: 150,
};
