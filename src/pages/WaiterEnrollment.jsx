import { useCallback, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/poc/";
const ENROLLMENT_URL = `${API_BASE.replace(/\/$/, "")}/waiter-enrollment`;

export default function WaiterEnrollment() {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | recording | sending | success | error
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { transcript, waiterId, filename }
  const [recordDuration, setRecordDuration] = useState(0);
  const timerRef = useRef(null);

  const sendAudioToBackend = useCallback(async (blob) => {
    setStatus("sending");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("audio", blob, "waiter-recording.webm");

      const res = await fetch(ENROLLMENT_URL, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Enrollment failed");
        setStatus("error");
        return;
      }

      setResult({
        waiterId: data.waiterId,
        filename: data.filename,
      });
      setStatus("success");
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to send audio to backend");
      setStatus("error");
    } finally {
      setIsRecording(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setResult(null);
    setStatus("recording");
    setRecordDuration(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];
        await sendAudioToBackend(blob);
      };

      recorder.start(1000);

      timerRef.current = setInterval(() => {
        setRecordDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not access microphone");
      setStatus("error");
    }
  }, [sendAudioToBackend]);

  const handleStopClick = useCallback(() => {
    setIsRecording(false);
    if (mediaRecorderRef.current?.state === "recording") {
      clearInterval(timerRef.current);
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, []);

  const formatDuration = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div style={containerStyle}>
      <h2>Waiter voice enrollment (POC 2 – Steps 1–4)</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
        Record the waiter&apos;s voice for 15–20 seconds. When you click Stop, the recording is
        sent to the backend, a voice-print embedding is extracted, and stored in Pinecone.
      </p>
      <p style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>
        Record in a quiet place. Speak clearly for best results.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={buttonRow}>
        <button
          type="button"
          onClick={startRecording}
          disabled={status === "recording" || status === "sending"}
          style={{
            ...primaryButton,
            ...(status === "recording" || status === "sending" ? buttonDisabled : {}),
          }}
        >
          Start recording
        </button>
        <button
          type="button"
          onClick={handleStopClick}
          disabled={status !== "recording"}
          style={{
            ...secondaryButton,
            ...(status !== "recording" ? buttonDisabled : {}),
          }}
        >
          Stop recording
        </button>
      </div>

      {status === "recording" && (
        <div style={timerStyle}>
          Recording: {formatDuration(recordDuration)} — aim for 15–20 seconds
        </div>
      )}
      {status === "sending" && <div style={statusStyle}>Extracting voice embedding and storing in Pinecone…</div>}
      {status === "success" && result && (
        <div style={successBox}>
          <strong>Voice print stored in Pinecone</strong>
          <div style={{ marginTop: 8 }}>
            <strong>Waiter ID:</strong> {result.waiterId}
          </div>
          {result.filename && (
            <div style={{ marginTop: 4, fontSize: 13, color: "#666" }}>
              Audio file: {result.filename}
            </div>
          )}
        </div>
      )}

      <div style={stepsBox}>
        <strong>Flow (Steps 1–4):</strong>
        <ol style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
          <li>Waiter starts enrollment (this page)</li>
          <li>Record voice 15–20 s → Stop</li>
          <li>Backend saves audio to <code>audio/</code> folder</li>
          <li>Backend: audio → speaker voice embedding → Pinecone</li>
        </ol>
      </div>
    </div>
  );
}

const containerStyle = {
  padding: 30,
  fontFamily: "Arial",
  maxWidth: 640,
  margin: "auto",
};

const errorStyle = {
  color: "#c62828",
  marginBottom: 12,
  padding: 10,
  background: "#ffebee",
  borderRadius: 6,
};

const buttonRow = { display: "flex", gap: 12, marginBottom: 20 };
const primaryButton = {
  padding: "12px 24px",
  background: "#2196f3",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};
const secondaryButton = {
  padding: "12px 24px",
  background: "#37474f",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
const buttonDisabled = { opacity: 0.6, cursor: "not-allowed" };

const timerStyle = { fontSize: 16, color: "#1565c0", marginBottom: 12 };
const statusStyle = { fontSize: 14, color: "#666", marginBottom: 12 };
const successBox = {
  padding: 16,
  background: "#e8f5e9",
  borderRadius: 8,
  marginBottom: 20,
  border: "1px solid #81c784",
};
const stepsBox = {
  marginTop: 24,
  padding: 12,
  background: "#f5f5f5",
  borderRadius: 6,
  fontSize: 14,
};
