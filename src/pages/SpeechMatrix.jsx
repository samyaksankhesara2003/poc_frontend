import { useRef, useState } from "react";

const WS_URL = "ws://localhost:3000";

export default function SpeechToText() {
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);

  const [transcript, setTranscript] = useState([]);
  const [isRecording, setIsRecording] = useState(false);

  const startRecording = async () => {
    if (isRecording) return;

    setTranscript([]);
    setIsRecording(true);

    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      const words = data.results?.map((r) => ({
        text: r.alternatives?.[0]?.content,
        speaker: r.alternatives?.[0]?.speaker || "S1",
      }));

      if (words?.length) {
        setTranscript((prev) => [...prev, ...words]);
      }
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

    // Stop audio processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop mic tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    console.log("🛑 Recording stopped");
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
    <div>
      {!isRecording ? (
        <button onClick={startRecording}>Start</button>
      ) : (
        <button onClick={stopRecording}>Stop</button>
      )}

      <div style={{ marginTop: "20px" }}>
        {transcript.map((t, i) => (
          <p key={i}>
            <b>Speaker {t.speaker}:</b> {t.text}
          </p>
        ))}
      </div>
    </div>
  );
}
