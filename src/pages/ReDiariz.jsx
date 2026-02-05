import { useRef, useState } from "react";
import axios from "axios";

export default function ReDiarizе() {
    const socketRef = useRef(null);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const streamRef = useRef(null);

    const [sessionState, setSessionState] = useState("idle");
    const [segments, setSegments] = useState([]);
    const [aiSegments, setAiSegments] = useState([]);
    const [interimText, setInterimText] = useState("");
    const processedIndices = useRef(new Set());
    const aiSegmentsRef = useRef([]); // ✅ ADD: Keep sync reference for context

    // console.log("Original segments:", segments);
    // console.log("AI segments:", aiSegments);

    // ✅ Send single segment to backend for re-diarization
    const processSingleSegment = async (segment, index) => {
        if (processedIndices.current.has(index)) return;
        processedIndices.current.add(index);

        try {
            // Get recent context for better accuracy
            // const recentContext = aiSegments.slice(-3);
            const recentContext = aiSegmentsRef.current.slice(-3);
            console.log("Context being sent:", recentContext);


            const response = await axios.post('http://localhost:3000/poc/rediarize-segment', {
                segment: segment,
                context: recentContext
            });
            console.log(response.data, "sagment second response");

            const correctedSegment = response.data.corrected;
            aiSegmentsRef.current = [...aiSegmentsRef.current, correctedSegment];

            setAiSegments(prev => [...prev, correctedSegment]);

        } catch (error) {
            console.error("Re-diarization error:", error);
            // Fallback
            aiSegmentsRef.current = [...aiSegmentsRef.current, fallbackSegment];

            setAiSegments(prev => [...prev, {
                speaker: segment.speaker === 0 ? "customer" : "waiter",
                text: segment.text,
                originalSpeaker: segment.speaker,
            }]);
        }
    };

    const startSession = async () => {
        setSegments([]);
        setAiSegments([]);
        aiSegmentsRef.current = []; // ✅ Reset ref too

        processedIndices.current.clear();

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
                setSegments((prev) => {
                    const newSegments = [...prev, ...data.speakers];

                    const startIndex = prev.length;
                    data.speakers.forEach((seg, idx) => {
                        processSingleSegment(seg, startIndex + idx);
                    });

                    return newSegments;
                });
                setInterimText("");
            }
        };

        socketRef.current.onerror = (err) => {
            console.error("WebSocket error:", err);
        };
    };

    const startMicrophone = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        streamRef.current = stream;
        audioContextRef.current = new AudioContext({ sampleRate: 16000 });
        const source = audioContextRef.current.createMediaStreamSource(stream);

        const processorCode = `
            class PCMProcessor extends AudioWorkletProcessor {
                process(inputs) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const samples = input[0];
                        const pcm = new Int16Array(samples.length);
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

        processorRef.current.port.onmessage = (event) => {
            if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current.send(event.data);
            }
        };

        source.connect(processorRef.current);
        processorRef.current.connect(audioContextRef.current.destination);
    };

    const pauseSession = () => {
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

    const resumeSession = async () => {
        socketRef.current?.send(JSON.stringify({ type: "RESUME" }));
        await startMicrophone();
        setSessionState("recording");
    };

    const stopSession = async () => {
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

        socketRef.current?.send(JSON.stringify({ type: "STOP" }));
        socketRef.current?.close();
        socketRef.current = null;

        setSessionState("idle");
        setInterimText("");
    };

    return (
        <div style={{ padding: 20 }}>
            <h2>🎙️ Restaurant Conversation (AI-Powered)</h2>

            {sessionState === "idle" && (
                <button onClick={startSession} style={btn("green")}>Start</button>
            )}

            {sessionState === "recording" && (
                <>
                    <button onClick={pauseSession} style={btn("orange")}>Pause</button>
                    <button onClick={stopSession} style={btn("red")}>Stop</button>
                </>
            )}

            {sessionState === "paused" && (
                <>
                    <button onClick={resumeSession} style={btn("green")}>Resume</button>
                    <button onClick={stopSession} style={btn("red")}>Stop</button>
                </>
            )}

            <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
                <div style={{ ...box, flex: 1 }}>
                    <strong>🤖 Deepgram (Original)</strong>
                    {segments.length === 0 && <p style={{ color: "#888" }}>Waiting...</p>}
                    {segments.map((seg, i) => (
                        <p key={i} style={{ margin: "10px 0" }}>
                            <strong style={{ color: seg.speaker === 0 ? "#2196F3" : "#FF9800" }}>
                                Speaker {seg.speaker}:
                            </strong> {seg.text}
                        </p>
                    ))}
                    {interimText && <p style={{ color: "#999" }}><em>... {interimText}</em></p>}
                </div>

                <div style={{ ...box, flex: 1, backgroundColor: "#f0f8ff" }}>
                    <strong>✨ AI Re-Diarized</strong>
                    {aiSegments.length === 0 && <p style={{ color: "#888" }}>AI processing...</p>}
                    {aiSegments.map((seg, i) => (
                        <p key={i} style={{ margin: "10px 0" }}>
                            <strong style={{
                                color: seg.speaker === "waiter" ? "#4CAF50" : "#FF5722",
                                textTransform: "capitalize"
                            }}>
                                {seg.speaker === "waiter" ? "👨‍🍳 Waiter" : "🙋 Customer"}:
                            </strong> {seg.text}
                        </p>
                    ))}
                </div>
            </div>
            
        </div>
    );
}

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