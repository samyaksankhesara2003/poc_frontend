import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PCMRecorder } from "@speechmatics/browser-audio-input";
import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";
import { STORAGE_KEY } from "./Login.jsx";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const WORKLET_URL = workletUrl;
const RECORDING_SAMPLE_RATE = 16000;

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

/** Build a WAV blob from 16-bit PCM chunks (mono, 16kHz) for Speechmatics. */
function buildWavBlob(pcmChunks) {
  const totalLength = pcmChunks.reduce((acc, buf) => acc + buf.byteLength, 0);
  const dataLength = totalLength;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, RECORDING_SAMPLE_RATE, true);
  view.setUint32(28, RECORDING_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const chunk of pcmChunks) {
    new Uint8Array(buffer).set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [uploadStatus, setUploadStatus] = useState({ type: null, message: "" });
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const pcmChunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      navigate("/", { replace: true });
      return;
    }
    try {
      setUser(JSON.parse(raw));
    } catch {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    navigate("/", { replace: true });
  };

  const uploadAudio = useCallback(
    async (file) => {
      if (!user || !file) return;
      setUploadStatus({ type: null, message: "" });
      setUploading(true);
      const form = new FormData();
      form.append("audio", file, file.name || "recording.wav");
      form.append("username", user.username);
      form.append("email", user.email);
      try {
        const { data } = await axios.post(`${API_BASE}/poc/upload`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setUploadStatus({ type: "success", message: data.message || "Audio saved." });
        if (data.user) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
          setUser(data.user);
        }
      } catch (err) {
        setUploadStatus({
          type: "error",
          message: err.response?.data?.error || err.message || "Upload failed",
        });
      } finally {
        setUploading(false);
      }
    },
    [user]
  );

  const startRecording = useCallback(async () => {
    setUploadStatus({ type: null, message: "" });
    setElapsed(0);
    pcmChunksRef.current = [];
    setIsConnecting(true);
    try {
      const audioContext = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      const recorder = new PCMRecorder(WORKLET_URL);
      recorderRef.current = recorder;

      recorder.addEventListener("audio", (e) => {
        pcmChunksRef.current.push(convertFloatTo16BitPCM(e.data));
      });

      await recorder.startRecording({ audioContext });
      setIsConnecting(false);
      setIsRecording(true);
      timerRef.current = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    } catch (err) {
      setUploadStatus({ type: "error", message: err?.message || "Failed to start recording." });
      setIsConnecting(false);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    clearInterval(timerRef.current);
    setIsRecording(false);
    if (recorderRef.current) {
      recorderRef.current.stopRecording();
      recorderRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const chunks = pcmChunksRef.current;
    if (chunks.length === 0) {
      setUploadStatus({ type: "error", message: "No audio recorded." });
      return;
    }
    const wavBlob = buildWavBlob(chunks);
    const file = new File([wavBlob], "recording.wav", { type: "audio/wav" });
    await uploadAudio(file);
  }, [uploadAudio]);

  const formatTime = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  if (!user) return null;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h2 style={styles.title}>Profile</h2>
          <button type="button" onClick={handleLogout} style={styles.logoutBtn}>
            Logout
          </button>
        </div>

        <div style={styles.section}>
          <div style={styles.label}>Name</div>
          <div style={styles.value}>{user.username}</div>
        </div>
        <div style={styles.section}>
          <div style={styles.label}>Email</div>
          <div style={styles.value}>{user.email}</div>
        </div>
        {user.audio_path && (
          <div style={styles.section}>
            <div style={styles.label}>Audio sample</div>
            <div style={styles.valueMuted}>{user.audio_path}</div>
          </div>
        )}

        <hr style={styles.hr} />

        <h3 style={styles.subtitle}>Record your audio sample</h3>
        <p style={styles.hint}>Start to record, Stop to save. Audio is stored for Speechmatics.</p>

        <div style={styles.recordRow}>
          <button
            type="button"
            onClick={startRecording}
            disabled={isRecording || isConnecting || uploading}
            style={{
              ...styles.recordBtn,
              ...(isRecording || isConnecting || uploading ? styles.btnDisabled : {}),
            }}
          >
            {isConnecting ? "Connecting…" : "▶ Start"}
          </button>
          <button
            type="button"
            onClick={stopRecording}
            disabled={!isRecording}
            style={{
              ...styles.stopBtn,
              ...(!isRecording ? styles.btnDisabled : {}),
            }}
          >
            ■ Stop
          </button>
          {(isRecording || isConnecting) && (
            <span style={styles.recLabel}>
              {isConnecting ? "Connecting…" : `REC ${formatTime(elapsed)}`}
            </span>
          )}
        </div>
        {uploading && <p style={styles.uploading}>Saving audio…</p>}

        {uploadStatus.message && (
          <p
            style={{
              ...styles.status,
              color: uploadStatus.type === "error" ? "#e94560" : "#4ecca3",
            }}
          >
            {uploadStatus.message}
          </p>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    padding: 24,
    background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
  },
  card: {
    maxWidth: 520,
    margin: "0 auto",
    background: "#0f3460",
    padding: 28,
    borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: { margin: 0, color: "#e94560", fontSize: 24, fontWeight: 600 },
  logoutBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #e94560",
    background: "transparent",
    color: "#e94560",
    cursor: "pointer",
    fontSize: 14,
  },
  section: { marginBottom: 16 },
  label: { color: "#a2a8d3", fontSize: 12, marginBottom: 4 },
  value: { color: "#eee", fontSize: 16 },
  valueMuted: { color: "#8892b0", fontSize: 14 },
  hr: { border: "none", borderTop: "1px solid #16213e", margin: "20px 0" },
  subtitle: { color: "#a2a8d3", fontSize: 16, margin: "0 0 8px" },
  hint: { color: "#8892b0", fontSize: 13, margin: "0 0 16px" },
  recordRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  btnDisabled: { opacity: 0.55, cursor: "not-allowed" },
  recordBtn: {
    padding: "12px 20px",
    borderRadius: 8,
    border: "none",
    background: "#16213e",
    color: "#e94560",
    cursor: "pointer",
    fontSize: 14,
  },
  stopBtn: {
    padding: "12px 20px",
    borderRadius: 8,
    border: "none",
    background: "#e94560",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  recLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#e94560",
    fontFamily: "monospace",
  },
  uploading: { color: "#4ecca3", fontSize: 14, marginTop: 8 },
  status: { marginTop: 16, fontSize: 14 },
};
