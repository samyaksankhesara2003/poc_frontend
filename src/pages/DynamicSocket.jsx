import { useRef, useState } from "react";

export default function DeepDynamicRecorder() {
    const socketRef = useRef(null);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const streamRef = useRef(null);

    const [sessionState, setSessionState] = useState("idle");
    const [segments, setSegments] = useState([]);
    console.log(segments,"segments");
    
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
    // 🎤 Start Microphone (RAW PCM)
    // ─────────────────────────────
    const startMicrophone = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,  // ✅ Match Deepgram config
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        streamRef.current = stream;

        // ✅ Create AudioContext for PCM extraction
        audioContextRef.current = new AudioContext({ sampleRate: 16000 });
        const source = audioContextRef.current.createMediaStreamSource(stream);

        // ✅ Create AudioWorklet processor inline
        const processorCode = `
            class PCMProcessor extends AudioWorkletProcessor {
                process(inputs) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const samples = input[0];
                        const pcm = new Int16Array(samples.length);
                        
                        // Convert float32 [-1, 1] to int16 [-32768, 32767]
                        for (let i = 0; i < samples.length; i++) {
                            const s = Math.max(-1, Math.min(1, samples[i]));
                            pcm[i] = s < 0 ? s * 32768 : s * 32767;
                        }
                        
                        this.port.postMessage(pcm.buffer);
                    }
                    return true;
                }
            }
            registerProcessor('pcm-processor', PCMProcessor);
        `;

        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        await audioContextRef.current.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        processorRef.current = new AudioWorkletNode(
            audioContextRef.current,
            'pcm-processor'
        );

        // ✅ Send PCM data to WebSocket
        processorRef.current.port.onmessage = (event) => {
            if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current.send(event.data);
            }
        };

        source.connect(processorRef.current);
        processorRef.current.connect(audioContextRef.current.destination);
    };

    // ─────────────────────────────
    // ⏸ Pause Session
    // ─────────────────────────────
    const pauseSession = () => {
        // Stop audio processing
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

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
        // Cleanup audio
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        // Close WebSocket
        socketRef.current?.send(JSON.stringify({ type: "STOP" }));
        socketRef.current?.close();
        socketRef.current = null;

        const finalText = segments
            .map((s) => `Speaker ${s.speaker}: ${s.text}`)
            .join("\n");

        console.log("Final transcript:", finalText);

        // Optional: Send to backend
        // await axios.post("http://localhost:3000/poc/analysis", {
        //     text: finalText,
        // });

        setSessionState("idle");
        setInterimText("");
    };

    // ─────────────────────────────
    // 🖥 UI
    // ─────────────────────────────
    return (
        <div style={{ padding: 20 }}>
            <h2>🎙️ Live Conversation (Deepgram Diarization)</h2>

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

                {segments.length === 0 && !interimText && (
                    <p style={{ color: "#888", fontStyle: "italic" }}>
                        Click Start and begin speaking...
                    </p>
                )}

                {segments.map((seg, i) => (
                    <p key={i} style={{ margin: "10px 0" }}>
                        <strong style={{
                            color: seg.speaker === 0 ? "#2196F3" : "#FF9800"
                        }}>
                            Speaker {seg.speaker}:
                        </strong> {seg.text}
                    </p>
                ))}

                {interimText && (
                    <p style={{ color: "#999", fontStyle: "italic" }}>
                        <em>... {interimText}</em>
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
    backgroundColor: "#f9f9f9",
};