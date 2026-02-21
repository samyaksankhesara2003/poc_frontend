import { useCallback, useRef, useState } from "react";
import { PCMRecorder } from "@speechmatics/browser-audio-input";

import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";
const WORKLET_URL = workletUrl;

const RECORDING_SAMPLE_RATE = 16000;

const AUDIO_SAVE_WS_URL =
  import.meta.env.VITE_WS_AUDIO_SAVE_URL || "ws://localhost:3000/save-audio";


const buttonDisabled = {
  opacity: 0.55,
  cursor: "not-allowed",
};

function convertFloatTo16BitPCM(input) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// ─── Audio File Recorder Section ────────────────────────────────────────────

export default function AudioFileRecorder() {
  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [savedFile, setSavedFile] = useState(null); // filename returned by backend
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  const startAudioRecording = useCallback(async () => {
    setError(null);
    setSavedFile(null);
    setElapsed(0);
    setIsConnecting(true);

    const ws = new WebSocket(AUDIO_SAVE_WS_URL);
    wsRef.current = ws;

    ws.onopen = async () => {
      try {
        const audioContext = new AudioContext({
          sampleRate: RECORDING_SAMPLE_RATE,
        });
        audioContextRef.current = audioContext;

        const recorder = new PCMRecorder(WORKLET_URL);
        recorderRef.current = recorder;

        recorder.addEventListener("audio", (e) => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) return;
          const pcm = convertFloatTo16BitPCM(e.data);
          wsRef.current.send(pcm);
        });

        await recorder.startRecording({ audioContext });

        setIsConnecting(false);
        setIsRecording(true);

        timerRef.current = setInterval(() => {
          setElapsed((prev) => prev + 1);
        }, 1000);
      } catch (err) {
        setError(err?.message || "Failed to start audio capture");
        setIsConnecting(false);
        ws.close();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.filename) setSavedFile(data.filename);
        if (data.error) setError(data.error);
      } catch (_) {}
    };

    ws.onerror = () => {
      setError("WebSocket error. Is the backend running?");
      setIsConnecting(false);
      setIsRecording(false);
      clearInterval(timerRef.current);
    };

    ws.onclose = () => {
      setIsConnecting(false);
    };
  }, []);

  const stopAudioRecording = useCallback(async () => {
    clearInterval(timerRef.current);
    setIsRecording(false);
    setIsConnecting(false);

    if (recorderRef.current) {
      recorderRef.current.stopRecording();
      recorderRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (wsRef.current) {
      // Signal backend to flush and save
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: "stop" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
      .toString()
      .padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  return (
    <div style={audioRecorderCard}>
      <div style={audioRecorderHeader}>
        <span style={audioRecorderIcon}>🎙</span>
        <div>
          <div style={audioRecorderTitle}>Waiter audio input</div>
          <div style={audioRecorderSubtitle}>
            To identify waiter in session.
          </div>
        </div>
      </div>

      {error && <div style={audioErrorStyle}>{error}</div>}

      <div style={audioControlsRow}>
        <button
          type="button"
          onClick={startAudioRecording}
          disabled={isRecording || isConnecting}
          style={{
            ...audioStartBtn,
            ...(isRecording || isConnecting ? buttonDisabled : {}),
          }}
          title={
            isRecording
              ? "Already recording"
              : "Start streaming audio to backend for saving"
          }
        >
          {isConnecting ? "Connecting…" : "▶ Start"}
        </button>

        <button
          type="button"
          onClick={stopAudioRecording}
          disabled={!isRecording}
          style={{
            ...audioStopBtn,
            ...(!isRecording ? buttonDisabled : {}),
          }}
          title={
            !isRecording
              ? "Not recording"
              : "Stop recording and signal backend to save the file"
          }
        >
          ■ Stop
        </button>

        {(isRecording || isConnecting) && (
          <div style={recIndicator}>
            <span style={recDot} />
            <span style={recLabel}>
              {isConnecting ? "Connecting…" : `REC ${formatTime(elapsed)}`}
            </span>
          </div>
        )}
      </div>

      {savedFile && (
        <div style={savedFileBanner}>
          ✅ File saved by backend: <strong>{savedFile}</strong>
        </div>
      )}
    </div>
  );
}

// ─── Styles for AudioFileRecorder ───────────────────────────────────────────

const audioRecorderCard = {
  border: "1.5px solid #b0bec5",
  borderRadius: 10,
  padding: "18px 20px",
  marginBottom: 28,
  background: "#f4f8fb",
};

const audioRecorderHeader = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  marginBottom: 16,
};

const audioRecorderIcon = { fontSize: 28, lineHeight: 1 };

const audioRecorderTitle = {
  fontWeight: 700,
  fontSize: 16,
  marginBottom: 3,
  color: "#1a237e",
};

const audioRecorderSubtitle = {
  fontSize: 13,
  color: "#546e7a",
};

const codeTag = {
  background: "#e3eaf0",
  borderRadius: 4,
  padding: "1px 5px",
  fontFamily: "monospace",
  fontSize: 12,
  color: "#1565c0",
};

const audioControlsRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const audioStartBtn = {
  padding: "9px 22px",
  background: "#2e7d32",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: 0.3,
};

const audioStopBtn = {
  padding: "9px 22px",
  background: "#c62828",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: 0.3,
};

const recIndicator = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginLeft: 6,
};

const recDot = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  background: "#e53935",
  display: "inline-block",
  animation: "blink 1s step-start infinite",
};

const recLabel = {
  fontSize: 13,
  fontWeight: 600,
  color: "#c62828",
  fontFamily: "monospace",
};

const savedFileBanner = {
  marginTop: 14,
  padding: "10px 14px",
  background: "#e8f5e9",
  border: "1px solid #a5d6a7",
  borderRadius: 6,
  fontSize: 13,
  color: "#2e7d32",
};

const audioErrorStyle = {
  color: "#c62828",
  marginBottom: 10,
  fontSize: 13,
};
