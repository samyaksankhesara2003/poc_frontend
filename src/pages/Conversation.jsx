import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { PCMRecorder } from "@speechmatics/browser-audio-input";
import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";

const WORKLET_URL = workletUrl;
const RECORDING_SAMPLE_RATE = 16000;
const MIC_START_DELAY_MS = 1800;
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const WS_BASE =
  import.meta.env.VITE_WS_SESSION_URL || "ws://localhost:3000/session-backend";
const POC_USER_KEY = "poc_user";

function getSessionWsUrl() {
  try {
    const raw = localStorage.getItem(POC_USER_KEY);
    const user = raw ? JSON.parse(raw) : null;
    const email = user?.email;
    if (!email) return WS_BASE;
    const sep = WS_BASE.includes("?") ? "&" : "?";
    return `${WS_BASE}${sep}email=${encodeURIComponent(email)}`;
  } catch {
    return WS_BASE;
  }
}

function removeOverlap(prevText, newText) {
  const prev = prevText.trim().split(" ");
  const next = newText.trim().split(" ");
  let overlapLength = 0;
  const maxCheck = Math.min(prev.length, next.length);
  for (let i = 1; i <= maxCheck; i++) {
    const prevSlice = prev.slice(-i).join(" ");
    const nextSlice = next.slice(0, i).join(" ");
    if (prevSlice === nextSlice) overlapLength = i;
  }
  return next.slice(overlapLength).join(" ");
}

function isPunctuationOnly(s) {
  return /^[.,!?;:'"\s]+$/.test((s || "").trim());
}

function splitSentences(text) {
  if (!text || !String(text).trim()) return [];
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

function buildWavBlob(pcmChunks, sampleRate = 16000) {
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
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (const chunk of pcmChunks) {
    new Uint8Array(buffer).set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// ── Tone color/icon mapping (hospitality-specific) ──
const TONE_CONFIG = {
  positive_friendly:     { color: "#43a047", bg: "#e8f5e9", icon: "😊", label: "Positive / Friendly" },
  neutral_casual:        { color: "#78909c", bg: "#eceff1", icon: "😐", label: "Neutral / Casual" },
  confused_unsure:       { color: "#7b1fa2", bg: "#f3e5f5", icon: "🤔", label: "Confused / Unsure" },
  mild_dissatisfaction:  { color: "#ef6c00", bg: "#fff3e0", icon: "😕", label: "Mild Dissatisfaction" },
  frustration_complaint: { color: "#e53935", bg: "#ffebee", icon: "😤", label: "Frustration / Complaint" },
  strong_anger:          { color: "#b71c1c", bg: "#ffcdd2", icon: "😡", label: "Strong Anger" },
  upsell_opportunity:    { color: "#00897b", bg: "#e0f2f1", icon: "🤩", label: "Upsell Opportunity" },
  bored_disengaged:      { color: "#5c6bc0", bg: "#e8eaf6", icon: "😴", label: "Bored / Disengaged" },
  polite_complaint:      { color: "#f57c00", bg: "#fff8e1", icon: "🙂", label: "Polite Complaint" },
  light_humor:           { color: "#2e7d32", bg: "#e8f5e9", icon: "😄", label: "Light Humor / Friendly" },
};

function MeterBar({ value, max = 1, color = "#2196f3", label, suffix = "" }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>{typeof value === "number" ? value.toFixed(2) : value}{suffix}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "#e0e0e0", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function TonePanel({ tone }) {
  if (!tone) {
    return <div style={panelEmpty}>Waiting for audio analysis...</div>;
  }
  const toneKey = tone.tone || null;
  const cfg = toneKey ? (TONE_CONFIG[toneKey] || TONE_CONFIG.neutral_casual) : null;
  return (
    <div>
      {cfg ? (
        <div style={{ ...toneBadgeLarge, background: cfg.bg, color: cfg.color, borderColor: cfg.color }}>
          <span style={{ fontSize: 22 }}>{cfg.icon}</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{cfg.label}</span>
          {tone.tone_score != null && (
            <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>
              {(tone.tone_score * 100).toFixed(0)}%
            </span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#aaa", fontStyle: "italic", marginBottom: 8 }}>
          Analyzing tone...
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <MeterBar label="Stress Level" value={tone.stress_level || 0} color="#ef5350" />
        <MeterBar label="Confidence" value={tone.confidence_level || 0} color="#66bb6a" />
        <MeterBar label="Energy" value={tone.energy || 0} max={0.1} color="#42a5f5" />
        <MeterBar label="Speech Rate" value={tone.speech_rate || 0} max={300} color="#ab47bc" suffix=" bpm" />
        <MeterBar label="Pitch Variation" value={tone.pitch_variation || 0} max={0.5} color="#ff7043" />
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Tag label="Pitch" value={`${tone.pitch_mean_hz || 0} Hz`} />
        <Tag label="Voice" value={tone.voice_quality || "—"} />
        <Tag label="Energy dB" value={`${tone.energy_db || 0} dB`} />
      </div>
    </div>
  );
}

function Tag({ label, value, color = "#555" }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", background: "#f5f5f5", border: "1px solid #e0e0e0", borderRadius: 12, padding: "2px 8px", fontSize: 11 }}>
      <span style={{ color: "#999" }}>{label}:</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </span>
  );
}

function ContentPanel({ content }) {
  if (!content) {
    return <div style={panelEmpty}>Waiting for content analysis...</div>;
  }
  const ca = content.content_analysis || content;
  return (
    <div>
      {ca.summary && (
        <div style={summaryBox}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 2 }}>Summary</div>
          <div style={{ fontSize: 13, lineHeight: 1.4 }}>{ca.summary}</div>
        </div>
      )}

      {ca.intent && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Intent</div>
          <span style={{ ...intentBadge }}>{ca.intent.primary}</span>
          <span style={{ fontSize: 11, color: "#999", marginLeft: 6 }}>
            ({(ca.intent.confidence * 100).toFixed(0)}% confidence)
          </span>
        </div>
      )}

      {ca.topics?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Topics</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {ca.topics.map((t, i) => (
              <span key={i} style={topicChip}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {ca.key_phrases?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Key Phrases</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {ca.key_phrases.map((p, i) => (
              <span key={i} style={phraseChip}>{p}</span>
            ))}
          </div>
        </div>
      )}

      {ca.sentiment && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Sentiment</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tag label="Overall" value={ca.sentiment.overall} color={ca.sentiment.score > 0 ? "#43a047" : ca.sentiment.score < 0 ? "#e53935" : "#78909c"} />
            {ca.sentiment.per_speaker?.WAITER && (
              <Tag label="Waiter" value={ca.sentiment.per_speaker.WAITER.sentiment} />
            )}
            {ca.sentiment.per_speaker?.CUSTOMER && (
              <Tag label="Customer" value={ca.sentiment.per_speaker.CUSTOMER.sentiment} />
            )}
          </div>
        </div>
      )}

      {ca.toxicity && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Toxicity</div>
          <span style={{
            ...toxicityBadge,
            background: ca.toxicity.detected ? "#ffebee" : "#e8f5e9",
            color: ca.toxicity.detected ? "#c62828" : "#2e7d32",
          }}>
            {ca.toxicity.detected ? `Detected (${ca.toxicity.level})` : "None detected"}
          </span>
          {ca.toxicity.flags?.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#c62828" }}>
              Flags: {ca.toxicity.flags.join(", ")}
            </div>
          )}
        </div>
      )}

      {ca.risk_signals?.detected && (
        <div style={{ marginBottom: 10, padding: 8, background: "#fff3e0", borderRadius: 6, border: "1px solid #ffe0b2" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e65100" }}>Risk Signals</div>
          <div style={{ fontSize: 12, color: "#bf360c", marginTop: 2 }}>
            {ca.risk_signals.signals.join("; ")}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Conversation() {
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const pcmChunksRef = useRef([]);

  const [user, setUser] = useState(null);
  const [tables, setTables] = useState([]);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [payloadTranscribe, setPayloadTranscribe] = useState([]);

  const [isRecording, setIsRecording] = useState(false);
  const [connectingAudio, setConnectingAudio] = useState(false);
  const [isPriming, setIsPriming] = useState(false);
  const [error, setError] = useState(null);
  const [loadingTables, setLoadingTables] = useState(true);

  // ── Analysis state ──
  const [toneAnalysis, setToneAnalysis] = useState(null);
  const [contentAnalysis, setContentAnalysis] = useState(null);
  const toneHistoryRef = useRef([]);
  const contentHistoryRef = useRef(null);
  const latestToneRef = useRef(null);
  const [showAnalysis, setShowAnalysis] = useState(true);

  const activeSession = sessions.find((s) => s.status === "active");
  const selectedTableSession = selectedTableId
    ? sessions.find((s) => s.tableId === selectedTableId)
    : null;
  const canSwitchTable = !activeSession;
  const canStart =
    selectedTableId &&
    !activeSession &&
    !isRecording &&
    (!selectedTableSession || selectedTableSession.status === "stop");
  const canStop = isRecording && activeSession && selectedTableSession?.status === "active";
  const canEnd =
    selectedTableId &&
    activeSession &&
    selectedTableSession?.status === "active" &&
    activeSession.tableId === selectedTableId;

  useEffect(() => {
    const raw = localStorage.getItem(POC_USER_KEY);
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

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API_BASE}/poc/tables`)
      .then((res) => {
        if (!cancelled && res.data?.data) setTables(res.data.data);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load tables");
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });
    return () => { cancelled = true; };
  }, []);

  function resolveRole(speaker) {
    return speaker === "S1" ? "WAITER" : "CUSTOMER";
  }

  const handleReceiveMessage = useCallback((data) => {
    // Handle acoustic metrics from Python analyzer (side panel meters)
    if (data.message === "AudioMetrics" && data.audio_metrics) {
      const m = data.audio_metrics;
      if (m.voice_quality === "silence") return;
      setToneAnalysis((prev) => ({ ...prev, ...m }));
      toneHistoryRef.current.push(data);
      return;
    }

    // Handle LLM tone classification (per-speaker tone label)
    if (data.message === "ToneClassification") {
      const { speaker, tone, score } = data;

      // Update side panel with latest LLM tone
      setToneAnalysis((prev) => ({
        ...prev,
        tone,
        tone_score: score,
      }));

      // Stamp on the last segment that belongs to this speaker
      setTranscript((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].speaker === speaker) {
            next[i] = { ...next[i], tone: { tone, score } };
            break;
          }
        }
        return next;
      });

      latestToneRef.current = { tone, score };
      return;
    }

    // Handle content analysis from OpenAI
    if (data.message === "ContentAnalysis" && data.content_analysis) {
      setContentAnalysis(data);
      contentHistoryRef.current = data;
      return;
    }

    if (data.message !== "AddTranscript") return;
    const results = data.results;
    if (!results?.length) return;

    const segments = [];
    for (const r of results) {
      const content = r.alternatives?.[0]?.content;
      const speaker = r.alternatives?.[0]?.speaker || "S1";
      if (content == null) continue;
      if (segments.length > 0 && segments[segments.length - 1].speaker === speaker) {
        const last = segments[segments.length - 1];
        last.text += isPunctuationOnly(content) ? content : (last.text ? " " : "") + content;
      } else {
        segments.push({ speaker, text: content });
      }
    }
    if (segments.length === 0) return;

    setTranscript((prev) => {
      let next = [...prev];
      for (const seg of segments) {
        const last = next[next.length - 1];
        if (last && last.speaker === seg.speaker) {
          // Same speaker continues — keep their existing tone
          const cleanPart = removeOverlap(last.text, seg.text);
          if (cleanPart) {
            next[next.length - 1] = {
              ...last,
              text: last.text + (isPunctuationOnly(cleanPart) ? "" : " ") + cleanPart,
            };
          }
        } else {
          // Different speaker — start with NO tone; their own tone
          // will arrive from the analyzer once they've been speaking
          latestToneRef.current = null;
          next.push({ speaker: seg.speaker, text: seg.text, tone: null });
        }
      }
      return next;
    });
    setPayloadTranscribe((prev) => {
      const next = [...prev];
      for (const seg of segments) {
        const role = resolveRole(seg.speaker);
        const last = next[next.length - 1];
        if (last && last.role === role) {
          last.text += isPunctuationOnly(seg.text)
            ? seg.text
            : (last.text ? " " : "") + seg.text;
        } else {
          next.push({ role, text: seg.text });
        }
      }
      return next;
    });
  }, []);

  const saveAnalysis = useCallback(async (unique_session_id) => {
    try {
      await axios.post(`${API_BASE}/poc/save-analysis`, {
        unique_session_id,
        tone_snapshots: toneHistoryRef.current,
        content_analysis: contentHistoryRef.current,
      });
    } catch (err) {
      console.error("Failed to save analysis:", err.message);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!selectedTableId || activeSession || isRecording) return;
    const table = tables.find((t) => t.id === selectedTableId);
    if (!table) return;

    setError(null);
    setTranscript([]);
    setPayloadTranscribe([]);
    setToneAnalysis(null);
    setContentAnalysis(null);
    toneHistoryRef.current = [];
    contentHistoryRef.current = null;
    latestToneRef.current = null;
    pcmChunksRef.current = [];

    const existingStopped = sessions.find(
      (s) => s.tableId === selectedTableId && s.status === "stop"
    );
    const unique_session_id = existingStopped
      ? existingStopped.unique_session_id
      : crypto.randomUUID();

    if (!existingStopped) {
      setSessions((prev) => [
        ...prev,
        {
          tableId: selectedTableId,
          tableNumber: table.table_number,
          unique_session_id,
          status: "active",
        },
      ]);
    } else {
      setSessions((prev) =>
        prev.map((s) =>
          s.tableId === selectedTableId && s.status === "stop"
            ? { ...s, status: "active" }
            : s
        )
      );
    }

    setIsRecording(true);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(getSessionWsUrl());
      wsRef.current = ws;

      ws.onopen = async () => {
        try {
          setConnectingAudio(true);
          await new Promise((r) => setTimeout(r, MIC_START_DELAY_MS));
          setConnectingAudio(false);
          if (wsRef.current?.readyState !== WebSocket.OPEN) return;

          const audioContext = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
          audioContextRef.current = audioContext;
          const recorder = new PCMRecorder(WORKLET_URL);
          recorderRef.current = recorder;

          recorder.addEventListener("audio", (e) => {
            const pcm = convertFloatTo16BitPCM(e.data);
            pcmChunksRef.current.push(pcm);
            if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(pcm);
          });

          await recorder.startRecording({ audioContext });
          resolve();
        } catch (err) {
          setError(err?.message || "Failed to start recording");
          setIsRecording(false);
          setConnectingAudio(false);
          ws.close();
          reject(err);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.message === "Error") {
            setError(data.reason || data.type || "Speechmatics error");
            return;
          }
          if (data.message === "PrimingStarted") setIsPriming(true);
          if (data.message === "PrimingComplete") setIsPriming(false);
          handleReceiveMessage(data);
        } catch (_) { }
      };

      ws.onerror = () => setError("WebSocket error. Is the backend running?");
      ws.onclose = () => setConnectingAudio(false);
    });
  }, [
    selectedTableId,
    tables,
    sessions,
    activeSession,
    isRecording,
    handleReceiveMessage,
  ]);

  const stopRecording = useCallback(async () => {
    if (!user || !selectedTableSession || selectedTableSession.status !== "active") return;

    const unique_session_id = selectedTableSession.unique_session_id;

    if (recorderRef.current) {
      recorderRef.current.stopRecording();
      recorderRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsRecording(false);
    setConnectingAudio(false);
    setIsPriming(false);

    setSessions((prev) =>
      prev.map((s) =>
        s.unique_session_id === unique_session_id ? { ...s, status: "stop" } : s
      )
    );

    let audio_path = `${unique_session_id}.wav`;
    const chunks = pcmChunksRef.current;
    if (chunks.length > 0) {
      try {
        const wavBlob = buildWavBlob(chunks, RECORDING_SAMPLE_RATE);
        const file = new File([wavBlob], "recording.wav", { type: "audio/wav" });
        const form = new FormData();
        form.append("audio", file, file.name);
        form.append("unique_session_id", unique_session_id);
        const { data } = await axios.post(`${API_BASE}/poc/upload-conversation`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (data?.audio_path) audio_path = data.audio_path;
      } catch (err) {
        setError(err.response?.data?.error || err.message || "Failed to upload audio");
        return;
      }
    }

    try {
      await axios.post(`${API_BASE}/poc/session`, {
        unique_session_id,
        waiter_id: user.id,
        table_id: selectedTableSession.tableId,
        transcriptions: payloadTranscribe,
        audio_path,
        status: "stop",
      });
      await saveAnalysis(unique_session_id);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to save session");
    }
  }, [user, selectedTableSession, payloadTranscribe, saveAnalysis]);

  const endSession = useCallback(async () => {
    if (!user || !selectedTableSession || selectedTableSession.status !== "active") return;

    const unique_session_id = selectedTableSession.unique_session_id;

    if (recorderRef.current) {
      recorderRef.current.stopRecording();
      recorderRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsRecording(false);
    setConnectingAudio(false);
    setIsPriming(false);

    let audio_path = `${unique_session_id}.wav`;
    const chunks = pcmChunksRef.current;
    if (chunks.length > 0) {
      try {
        const wavBlob = buildWavBlob(chunks, RECORDING_SAMPLE_RATE);
        const file = new File([wavBlob], "recording.wav", { type: "audio/wav" });
        const form = new FormData();
        form.append("audio", file, file.name);
        form.append("unique_session_id", unique_session_id);
        const { data } = await axios.post(`${API_BASE}/poc/upload-conversation`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (data?.audio_path) audio_path = data.audio_path;
      } catch (err) {
        setError(err.response?.data?.error || err.message || "Failed to upload audio");
        return;
      }
    }

    try {
      await axios.post(`${API_BASE}/poc/session`, {
        unique_session_id,
        waiter_id: user.id,
        table_id: selectedTableSession.tableId,
        transcriptions: payloadTranscribe,
        audio_path,
        status: "end",
      });
      await saveAnalysis(unique_session_id);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to end session");
      return;
    }

    setSessions((prev) => prev.filter((s) => s.unique_session_id !== unique_session_id));
    setTranscript([]);
    setToneAnalysis(null);
    setContentAnalysis(null);
  }, [user, selectedTableSession, payloadTranscribe, saveAnalysis]);

  const handleSelectTable = (tableId) => {
    if (!canSwitchTable) return;
    setSelectedTableId(tableId);
    setError(null);
  };

  const displayTranscript = transcript;
  const btnDisabled = { opacity: 0.55, cursor: "not-allowed" };

  if (!user) return null;

  return (
    <div style={pageContainer}>
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }`}</style>
      {/* ── Left column: Transcript ── */}
      <div style={mainColumn}>
        <h2 style={{ margin: "0 0 4px 0" }}>Conversation by table</h2>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 14, marginTop: 0 }}>
          Select a table, then Start recording. Stop = pause, End = close session.
        </p>

        {error && <div style={errorStyle}>{error}</div>}

        {loadingTables ? (
          <p>Loading tables...</p>
        ) : (
          <div style={tablesBox}>
            <div style={tablesTitle}>Tables</div>
            <div style={tablesGrid}>
              {tables.map((t) => {
                const session = sessions.find((s) => s.tableId === t.id);
                const isSelected = selectedTableId === t.id;
                const isLocked = !!activeSession && t.id !== activeSession?.tableId;
                return (
                  <div
                    key={t.id}
                    style={{
                      ...tableCard,
                      ...(isSelected ? tableCardSelected : {}),
                      ...(isLocked ? tableCardLocked : {}),
                    }}
                    onClick={() => handleSelectTable(t.id)}
                    title={isLocked ? "Pause or end the active session to switch table" : undefined}
                  >
                    <span style={tableNumber}>Table {t.table_number}</span>
                    {session && (
                      <span style={statusBadge(session.status)}>{session.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {selectedTableId && (
          <div style={controlsRow}>
            <button
              type="button"
              onClick={startRecording}
              disabled={!canStart}
              style={{ ...startButton, ...(!canStart ? btnDisabled : {}) }}
            >
              Start recording
            </button>
            <button
              type="button"
              onClick={stopRecording}
              disabled={!canStop}
              style={{ ...stopButton, ...(!canStop ? btnDisabled : {}) }}
            >
              Stop recording
            </button>
            <button
              type="button"
              onClick={endSession}
              disabled={!canEnd}
              style={{ ...endButton, ...(!canEnd ? btnDisabled : {}) }}
            >
              End session
            </button>
            <button
              type="button"
              onClick={() => setShowAnalysis((v) => !v)}
              style={toggleAnalysisBtn}
            >
              {showAnalysis ? "Hide" : "Show"} Analysis
            </button>
          </div>
        )}

        <div style={transcriptSection}>
          <div style={transcriptHeader}>
            <span>Live Conversation</span>
            <span>{displayTranscript.length} segments</span>
          </div>
          <div style={transcriptBox}>
            <div style={transcriptHint}>
              {selectedTableSession?.status === "active" &&
                (connectingAudio
                  ? "Connecting..."
                  : isPriming
                    ? "Identifying waiter voice..."
                    : "Recording...")}
              {selectedTableSession?.status === "stop" && "Session paused. Start recording to continue."}
              {!selectedTableSession && selectedTableId && "Select a table and start recording."}
            </div>
            {displayTranscript.length === 0 ? (
              <div style={emptyTranscript}>No conversation yet.</div>
            ) : (
              displayTranscript.map((t, i) => {
                const speakerNum = t.speaker === "S1" ? "WAITER" : "CUSTOMER";
                const isSpeaker1 = t.speaker === "S1";
                const tone = t.tone;
                const toneKey = tone?.tone;
                const toneCfg = toneKey ? (TONE_CONFIG[toneKey] || TONE_CONFIG.neutral_casual) : null;
                const isLast = i === displayTranscript.length - 1;

                return (
                  <div key={i} style={transcriptSegment}>
                    <div style={segmentHeader}>
                      <span style={speakerPill(isSpeaker1)}>{speakerNum}</span>
                      {toneCfg && (
                        <span style={{ ...inlineToneBadge, background: toneCfg.bg, color: toneCfg.color, borderColor: toneCfg.color }}>
                          <span>{toneCfg.icon}</span>
                          <span>{toneCfg.label}</span>
                        </span>
                      )}
                      {isLast && isRecording && (
                        <span style={liveIndicator}>LIVE</span>
                      )}
                    </div>
                    <div style={segmentText}>{t.text || "\u00a0"}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Right column: Analysis Panel ── */}
      {showAnalysis && (
        <div style={analysisColumn}>
          <div style={analysisPanelCard}>
            <div style={analysisPanelHeader}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Tone Analysis</span>
              <span style={{ fontSize: 11, color: "#999" }}>AI + Audio</span>
            </div>
            <TonePanel tone={toneAnalysis} />
          </div>

          <div style={analysisPanelCard}>
            <div style={analysisPanelHeader}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Content Analysis</span>
              <span style={{ fontSize: 11, color: "#999" }}>AI / NLP</span>
            </div>
            <ContentPanel content={contentAnalysis} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──

function statusBadge(status) {
  const colors = { active: "#4caf50", stop: "#ff9800" };
  return {
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 8,
    background: colors[status] || "#9e9e9e",
    color: "#fff",
  };
}

const pageContainer = {
  display: "flex",
  gap: 20,
  padding: "20px 24px",
  fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
  maxWidth: 1280,
  margin: "auto",
  minHeight: "100vh",
  alignItems: "flex-start",
};
const mainColumn = { flex: "1 1 0", minWidth: 0, maxWidth: 700 };
const analysisColumn = {
  width: 340,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  position: "sticky",
  top: 20,
  maxHeight: "calc(100vh - 40px)",
  overflowY: "auto",
};
const analysisPanelCard = {
  background: "#fff",
  border: "1px solid #e0e0e0",
  borderRadius: 10,
  padding: 14,
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
};
const analysisPanelHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
  paddingBottom: 8,
  borderBottom: "1px solid #f0f0f0",
};
const panelEmpty = { color: "#aaa", fontSize: 13, fontStyle: "italic", padding: "10px 0" };
const toneBadgeLarge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 14px",
  borderRadius: 20,
  border: "1px solid",
  fontWeight: 600,
  fontSize: 14,
  marginBottom: 6,
};
const summaryBox = {
  background: "#f5f5f5",
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: 10,
};
const sectionLabel = { fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.5 };
const intentBadge = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
  background: "#e3f2fd",
  color: "#1565c0",
};
const topicChip = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  background: "#ede7f6",
  color: "#5e35b1",
  fontWeight: 500,
};
const phraseChip = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 11,
  background: "#e8f5e9",
  color: "#2e7d32",
  fontWeight: 500,
};
const toxicityBadge = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
};

const errorStyle = { color: "#c62828", marginBottom: 12, fontSize: 13 };
const tablesBox = {
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: 12,
  marginBottom: 14,
  background: "#fff",
};
const tablesTitle = { fontWeight: "bold", marginBottom: 8, fontSize: 14 };
const tablesGrid = { display: "flex", flexWrap: "wrap", gap: 8 };
const tableCard = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #ddd",
  cursor: "pointer",
  minWidth: 90,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  background: "#fff",
  transition: "all 0.15s",
};
const tableCardSelected = { background: "#e3f2fd", borderColor: "#2196f3" };
const tableCardLocked = { opacity: 0.5, cursor: "not-allowed" };
const tableNumber = { fontWeight: 600, fontSize: 13 };
const controlsRow = { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" };
const startButton = {
  padding: "8px 18px",
  background: "#1976d2",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const stopButton = {
  padding: "8px 18px",
  background: "#d32f2f",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const endButton = {
  padding: "8px 18px",
  background: "#546e7a",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const toggleAnalysisBtn = {
  padding: "8px 14px",
  background: "#f5f5f5",
  color: "#333",
  border: "1px solid #ddd",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  marginLeft: "auto",
};
const transcriptSection = { marginTop: 4 };
const transcriptHeader = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 6,
  fontSize: 13,
  color: "#777",
};
const transcriptBox = {
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: 14,
  minHeight: 300,
  maxHeight: 420,
  overflowY: "auto",
  background: "#fafafa",
  fontSize: 15,
  lineHeight: 1.6,
};
const transcriptHint = { fontSize: 12, color: "#888", marginBottom: 10 };
const emptyTranscript = { color: "#bbb", fontStyle: "italic", fontSize: 13 };
const transcriptSegment = {
  marginBottom: 12,
  padding: "8px 10px",
  background: "#fff",
  borderRadius: 8,
  border: "1px solid #eee",
};
const segmentHeader = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 4,
  flexWrap: "wrap",
};
function speakerPill(isSpeaker1) {
  return {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 16,
    fontSize: 12,
    fontWeight: 600,
    color: "#fff",
    flexShrink: 0,
    background: isSpeaker1 ? "#66bb6a" : "#42a5f5",
  };
}
const inlineToneBadge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "2px 8px",
  borderRadius: 12,
  border: "1px solid",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "capitalize",
};
const liveIndicator = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 8,
  fontSize: 9,
  fontWeight: 700,
  color: "#fff",
  background: "#e53935",
  letterSpacing: 1,
  marginLeft: "auto",
  animation: "pulse 1.5s infinite",
};
const segmentText = {
  fontSize: 14,
  lineHeight: 1.5,
  color: "#333",
  paddingLeft: 2,
};
