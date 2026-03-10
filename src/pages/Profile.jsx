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

/** Build a raw 16-bit PCM blob from chunks (mono, 16kHz) for upload and priming. */
function buildRawPcmBlob(pcmChunks) {
  const totalLength = pcmChunks.reduce((acc, buf) => acc + buf.byteLength, 0);
  const buffer = new ArrayBuffer(totalLength);
  const view = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of pcmChunks) {
    view.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return new Blob([buffer], { type: "application/octet-stream" });
}

/** Play raw 16-bit LE PCM (mono, 16kHz) from a URL via Web Audio API. */
function PcmAudioPlayer({ url }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const sourceRef = useRef(null);

  const play = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load audio");
      const arrayBuffer = await res.arrayBuffer();
      const pcm = new Int16Array(arrayBuffer);
      const ctx = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
      const numSamples = pcm.length;
      const audioBuffer = ctx.createBuffer(1, numSamples, RECORDING_SAMPLE_RATE);
      const channel = audioBuffer.getChannelData(0);
      for (let i = 0; i < numSamples; i++) {
        channel[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff);
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(0);
      sourceRef.current = { source, ctx };
      setPlaying(true);
      source.onended = () => {
        setPlaying(false);
        ctx.close();
      };
    } catch (err) {
      setError(err?.message || "Playback failed");
      setPlaying(false);
    }
  }, [url]);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.source.stop();
        sourceRef.current.ctx.close();
      } catch (_) { }
      sourceRef.current = null;
      setPlaying(false);
    }
  }, []);

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={playing ? stop : play}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          background: playing ? "#fef2f2" : "#f0fdf4",
          color: playing ? "#991b1b" : "#166534",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        {playing ? "⏹ Stop" : "▶ Play"}
      </button>
      {error && <span style={{ marginLeft: 8, color: "#991b1b", fontSize: 12 }}>{error}</span>}
    </div>
  );
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
      form.append("audio", file, file.name || "recording.pcm");
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
    const pcmBlob = buildRawPcmBlob(chunks);
    const file = new File([pcmBlob], "recording.pcm", { type: "application/octet-stream" });
    await uploadAudio(file);
  }, [uploadAudio]);

  const formatTime = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  if (!user) return null;

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .profile-card {
          animation: fadeIn 0.5s ease-out;
        }
        button:hover:not(:disabled) {
          transform: translateY(-2px);
        }
        button:active:not(:disabled) {
          transform: translateY(0);
        }
        .recording-dot {
          animation: pulse 1.5s infinite;
        }
        .logout-btn:hover {
          background: #f8fafc !important;
          border-color: #cbd5e1 !important;
          transform: translateY(-2px);
        }
        .record-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px -4px rgba(16, 185, 129, 0.4) !important;
        }
        .stop-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px -4px rgba(239, 68, 68, 0.4) !important;
        }
        .start-session-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px -4px rgba(102, 126, 234, 0.5) !important;
        }
      `}</style>

      <div className="profile-card" style={styles.card}>
        {/* Header Section */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.avatar}>
              {user.email?.[0]?.toUpperCase() || user.username?.[0]?.toUpperCase() || "U"}
            </div>
            <div>
              <h1 style={styles.title}>Profile</h1>
              <p style={styles.subtitle}>Manage your account settings</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="logout-btn"
            style={styles.logoutBtn}
          >
            <span>🚪</span>
            <span>Logout</span>
          </button>
        </div>

        {/* User Info Section */}
        <div style={styles.infoSection}>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>👤</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Name</div>
              <div style={styles.infoValue}>{user.username}</div>
            </div>
          </div>

          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>📧</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Email</div>
              <div style={styles.infoValue}>{user.email}</div>
            </div>
          </div>

          {user.audio_path && (
            <div style={styles.infoCard}>
              <div style={styles.infoIcon}>🎵</div>
              <div style={styles.infoContent}>
                <div style={styles.infoLabel}>Audio Sample</div>
                <div style={styles.infoValueMuted}>{user.audio_path}</div>
                {user.audio_path.toLowerCase().endsWith(".pcm") ? (
                  <PcmAudioPlayer
                    url={`${API_BASE}/poc/audio-sample?audio_path=${encodeURIComponent(
                      user.audio_path
                    )}`}
                  />
                ) : (
                  <audio
                    controls
                    style={{ marginTop: 8, width: "100%" }}
                    src={`${API_BASE}/poc/audio-sample?audio_path=${encodeURIComponent(
                      user.audio_path
                    )}`}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Start Session Section - Only visible if audio sample exists */}
        {user.audio_path && (
          <div style={styles.sessionSection}>
            <div style={styles.sessionCard}>
              <div style={styles.sessionIcon}>💬</div>
              <div style={styles.sessionContent}>
                <h3 style={styles.sessionTitle}>Ready to Start?</h3>
                <p style={styles.sessionDescription}>
                  Begin a new conversation session to record and analyze customer interactions
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/conversation")}
                  className="start-session-btn"
                  style={styles.startSessionBtn}
                >
                  <span>🚀</span>
                  <span>Start Session</span>
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Recording Section */}
        <div style={styles.recordingSection}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionIcon}>🎙️</span>
            <div>
              <h3 style={styles.sectionTitle}>Record Audio Sample</h3>
              <p style={styles.sectionHint}>
                Record your voice to enable Speechmatics voice recognition
              </p>
            </div>
          </div>

          <div style={styles.recordControls}>
            <button
              type="button"
              onClick={startRecording}
              disabled={isRecording || isConnecting || uploading}
              className="record-btn"
              style={{
                ...styles.recordBtn,
                ...(isRecording || isConnecting || uploading ? styles.btnDisabled : {}),
              }}
            >
              {isConnecting ? (
                <>
                  <span style={styles.spinner}></span>
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <span>🎤</span>
                  <span>Start Recording</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={stopRecording}
              disabled={!isRecording}
              className="stop-btn"
              style={{
                ...styles.stopBtn,
                ...(!isRecording ? styles.btnDisabled : {}),
              }}
            >
              <span>⏹️</span>
              <span>Stop</span>
            </button>
          </div>

          {(isRecording || isConnecting) && (
            <div style={styles.recordingIndicator}>
              <span className="recording-dot" style={styles.recordingDot}></span>
              <span style={styles.recLabel}>
                {isConnecting ? "Connecting..." : `Recording: ${formatTime(elapsed)}`}
              </span>
            </div>
          )}

          {uploading && (
            <div style={styles.uploadingCard}>
              <span style={styles.spinnerGreen}></span>
              <span>Saving audio...</span>
            </div>
          )}

          {uploadStatus.message && (
            <div style={{
              ...styles.statusCard,
              ...(uploadStatus.type === "error" ? styles.statusError : styles.statusSuccess),
            }}>
              <span style={styles.statusIcon}>
                {uploadStatus.type === "error" ? "❌" : "✅"}
              </span>
              <span>{uploadStatus.message}</span>
            </div>
          )}
        </div>

        <div style={styles.infoCard}>
          <div style={styles.infoIcon}>💬</div>
          <div style={styles.infoContent}>
            <div style={styles.infoLabel}>I am a waiter at this restaurant. I am recording my voice to help improve our service quality and better diarization.</div>
          </div>
        </div>

      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    padding: "32px 24px",
    background: "linear-gradient(to bottom, #f8fafc 0%, #f1f5f9 100%)",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
  },
  card: {
    maxWidth: 680,
    margin: "0 auto",
    background: "#ffffff",
    padding: "40px",
    borderRadius: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
    paddingBottom: 24,
    borderBottom: "2px solid #f1f5f9",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 24,
    boxShadow: "0 4px 12px rgba(102, 126, 234, 0.3)",
  },
  title: {
    margin: 0,
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: -0.5,
  },
  subtitle: {
    margin: "4px 0 0 0",
    color: "#64748b",
    fontSize: 14,
    fontWeight: 400,
  },
  logoutBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 18px",
    borderRadius: 12,
    border: "2px solid #e2e8f0",
    background: "#ffffff",
    color: "#475569",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    transition: "all 0.2s ease",
  },
  infoSection: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginBottom: 32,
  },
  infoCard: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "16px 20px",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
  },
  infoIcon: {
    fontSize: 24,
    width: 48,
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#ffffff",
    borderRadius: 12,
    boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoValue: {
    color: "#1e293b",
    fontSize: 16,
    fontWeight: 600,
  },
  infoValueMuted: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: 500,
  },
  sessionSection: {
    marginBottom: 32,
  },
  sessionCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 20,
    padding: "24px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    borderRadius: 20,
    boxShadow: "0 8px 24px rgba(102, 126, 234, 0.3)",
  },
  sessionIcon: {
    fontSize: 40,
    flexShrink: 0,
  },
  sessionContent: {
    flex: 1,
  },
  sessionTitle: {
    margin: "0 0 8px 0",
    color: "#ffffff",
    fontSize: 22,
    fontWeight: 700,
  },
  sessionDescription: {
    margin: "0 0 20px 0",
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.5,
  },
  startSessionBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 28px",
    borderRadius: 12,
    border: "none",
    background: "#ffffff",
    color: "#667eea",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 700,
    transition: "all 0.2s ease",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
  },
  recordingSection: {
    padding: "24px",
    background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    borderRadius: 20,
    border: "1px solid #e2e8f0",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 24,
  },
  sectionIcon: {
    fontSize: 28,
    marginTop: 2,
  },
  sectionTitle: {
    margin: "0 0 4px 0",
    color: "#1e293b",
    fontSize: 20,
    fontWeight: 700,
  },
  sectionHint: {
    margin: 0,
    color: "#64748b",
    fontSize: 14,
    fontWeight: 400,
  },
  recordControls: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 16,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  recordBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 24px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
    transition: "all 0.2s ease",
    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
  },
  stopBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 24px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
    transition: "all 0.2s ease",
    boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)",
  },
  recordingIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
    border: "1px solid #fecaca",
    borderRadius: 12,
    marginBottom: 12,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#ef4444",
  },
  recLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "#991b1b",
    fontFamily: "monospace",
  },
  uploadingCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 12,
    color: "#166534",
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 12,
  },
  spinner: {
    width: 18,
    height: 18,
    border: "3px solid rgba(255,255,255,0.3)",
    borderTopColor: "#ffffff",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    display: "inline-block",
  },
  spinnerGreen: {
    width: 18,
    height: 18,
    border: "3px solid rgba(34, 197, 94, 0.3)",
    borderTopColor: "#22c55e",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    display: "inline-block",
  },
  statusCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 18px",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    marginTop: 8,
  },
  statusError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
  },
  statusSuccess: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#166534",
  },
  statusIcon: {
    fontSize: 18,
  },
};
