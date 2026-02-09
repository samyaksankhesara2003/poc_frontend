import { useRef, useState } from "react";

const WS_URL = "ws://localhost:3000";

export default function SpeechToTextModify() {
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);

  // 🔥 Remove overlapping duplicate words
  const removeOverlap = (prevText, newText) => {
    const prev = prevText.trim().split(" ");
    const next = newText.trim().split(" ");

    let overlapLength = 0;
    const maxCheck = Math.min(prev.length, next.length);

    for (let i = 1; i <= maxCheck; i++) {
      const prevSlice = prev.slice(-i).join(" ");
      const nextSlice = next.slice(0, i).join(" ");
      if (prevSlice === nextSlice) {
        overlapLength = i;
      }
    }

    return next.slice(overlapLength).join(" ");
  };

  const startRecording = async () => {
    if (isRecording) return;

    setTranscript([]);
    setIsRecording(true);

    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.message !== "AddTranscript") return;

      const sentence = data.metadata?.transcript?.trim();
      if (!sentence) return;

      const firstResult = data.results?.[0];
      const speaker =
        firstResult?.alternatives?.[0]?.speaker || "S1";

      setTranscript((prev) => {
        const last = prev[prev.length - 1];

        if (last && last.speaker === speaker) {
          const cleanPart = removeOverlap(last.text, sentence);
          if (!cleanPart) return prev;

          const updated = [...prev];
          updated[updated.length - 1].text += " " + cleanPart;
          return updated;
        }

        return [...prev, { speaker, text: sentence }];
      });
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const audioContext = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const pcm = convertFloatTo16BitPCM(input);
      wsRef.current.send(pcm);
    };
  };

  const stopRecording = () => {
    setIsRecording(false);

    if (processorRef.current) processorRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (streamRef.current)
      streamRef.current.getTracks().forEach((track) => track.stop());
    if (wsRef.current) wsRef.current.close();
  };

  const convertFloatTo16BitPCM = (input) => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    let offset = 0;

    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return buffer;
  };

  return (
    <div style={containerStyle}>
      <h2>Realtime Speech To Text</h2>

      <div style={{ marginBottom: 20 }}>
        <button
          onClick={startRecording}
          disabled={isRecording}
          style={startButton}
        >
          Start
        </button>

        <button
          onClick={stopRecording}
          disabled={!isRecording}
          style={stopButton}
        >
          Stop
        </button>
      </div>

      <div style={transcriptBox}>
        {transcript.map((t, i) => (
          <div key={i} style={{ marginBottom: 15 }}>
            <div
              style={{
                fontWeight: "bold",
                color: t.speaker === "S1" ? "#00bcd4" : "#4caf50",
              }}
            >
              Speaker {t.speaker}
            </div>
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const containerStyle = {
  padding: 30,
  fontFamily: "Arial",
  maxWidth: 700,
  margin: "auto",
};

const startButton = {
  padding: "10px 20px",
  background: "#007bff",
  color: "white",
  border: "none",
  borderRadius: 5,
  marginRight: 10,
  cursor: "pointer",
};

const stopButton = {
  padding: "10px 20px",
  background: "#d9534f",
  color: "white",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
};

const transcriptBox = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 15,
  height: 350,
  overflowY: "auto",
  background: "#f9f9f9",
  fontSize: 16,
  lineHeight: 1.6,
};
