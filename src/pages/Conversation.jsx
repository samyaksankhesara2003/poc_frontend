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

function getSessionWsUrl(language = "en") {
  try {
    const raw = localStorage.getItem(POC_USER_KEY);
    const user = raw ? JSON.parse(raw) : null;
    const email = user?.email;
    let url = WS_BASE;
    const params = [];
    
    if (email) params.push(`email=${encodeURIComponent(email)}`);
    if (language && ["en", "es"].includes(language)) params.push(`lang=${language}`);
    
    if (params.length > 0) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}${params.join("&")}`;
    }
    
    return url;
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

// ── Tone color/icon mapping (Updated 10-category system) ──
// Matches backend TONE_CATEGORIES structure
const TONE_CONFIG = {
  neutral_casual:        { color: "#78909c", bg: "#eceff1", icon: "😐", label: "Neutral / Casual", priority: "normal" },
  positive_friendly:     { color: "#43a047", bg: "#e8f5e9", icon: "😊", label: "Positive / Friendly", priority: "low" },
  polite_request:        { color: "#2196f3", bg: "#e3f2fd", icon: "🙋", label: "Polite Request", priority: "normal" },
  upsell_opportunity:    { color: "#00897b", bg: "#e0f2f1", icon: "🤩", label: "Upsell Opportunity", priority: "low" },
  neutral_complaint:     { color: "#ff9800", bg: "#fff3e0", icon: "😐", label: "Neutral Complaint", priority: "high" },
  polite_complaint:      { color: "#f57c00", bg: "#fff8e1", icon: "🙂", label: "Polite Complaint", priority: "high" },
  frustration_complaint: { color: "#e53935", bg: "#ffebee", icon: "😤", label: "Frustration / Complaint", priority: "high" },
  angry_escalation:      { color: "#b71c1c", bg: "#ffcdd2", icon: "😡", label: "Angry / Escalation", priority: "critical" },
  confusion_uncertain:   { color: "#7b1fa2", bg: "#f3e5f5", icon: "🤔", label: "Confusion / Uncertain", priority: "medium" },
  silent_or_no_speech:   { color: "#9e9e9e", bg: "#f5f5f5", icon: "🔇", label: "Silent / No Speech", priority: "none" },
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
  const businessAction = tone.businessAction || null;
  
  const priorityColors = {
    "low": "#43a047",
    "normal": "#78909c",
    "medium": "#7b1fa2",
    "medium-high": "#ef6c00",
    "high": "#e53935",
    "critical": "#b71c1c",
  };

  return (
    <div>
      {cfg ? (
        <div>
          <div style={{ ...toneBadgeLarge, background: cfg.bg, color: cfg.color, borderColor: cfg.color }}>
            <span style={{ fontSize: 22 }}>{cfg.icon}</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{cfg.label}</span>
            {(tone.tone_score != null || tone.confidence != null) && (
              <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>
                {((tone.confidence || tone.tone_score || 0) * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {/* Intent and Action Required */}
          {(tone.intent || tone.requires_action !== undefined) && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {tone.intent && (
                <Tag label="Intent" value={tone.intent} color="#2196f3" />
              )}
              {tone.requires_action !== undefined && (
                <Tag 
                  label="Action" 
                  value={tone.requires_action ? "Required" : "None"} 
                  color={tone.requires_action ? "#e53935" : "#43a047"} 
                />
              )}
            </div>
          )}
          
          {businessAction && (
            <div style={{ marginTop: 10, padding: 10, background: "#f8f9fa", borderRadius: 6, border: "1px solid #e0e0e0" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4, textTransform: "uppercase" }}>
                Business Action
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: priorityColors[businessAction.priority] || "#666", marginBottom: 4 }}>
                Priority: {businessAction.priority.toUpperCase()}
              </div>
              <div style={{ fontSize: 12, color: "#333", marginBottom: 6 }}>
                {businessAction.action}
              </div>
              {businessAction.nextSteps && businessAction.nextSteps.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4 }}>Next Steps:</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "#555" }}>
                    {businessAction.nextSteps.map((step, i) => (
                      <li key={i} style={{ marginBottom: 2 }}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
  const [language, setLanguage] = useState("en"); // "en" or "es"

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
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to load tables:", err);
          const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to load tables";
          setError(`API Error: ${errorMsg}`);
        }
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
      const { speaker, tone, score, confidence, intent, requires_action, businessAction } = data;

      // Skip silence
      if (tone === "silent_or_no_speech") return;

      // Update side panel with latest LLM tone
      setToneAnalysis((prev) => ({
        ...prev,
        tone,
        tone_score: confidence || score,
        confidence: confidence || score,
        intent: intent || null,
        requires_action: requires_action !== undefined ? requires_action : null,
        businessAction: businessAction || null,
      }));

      // Stamp on the last segment that belongs to this speaker
      setTranscript((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].speaker === speaker) {
            next[i] = { 
              ...next[i], 
              tone: { 
                tone, 
                score: confidence || score,
                confidence: confidence || score,
                intent: intent || null,
                requires_action: requires_action !== undefined ? requires_action : null,
              } 
            };
            break;
          }
        }
        return next;
      });

      // Stamp the corresponding payload segment too (so we can persist tone)
      setPayloadTranscribe((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i]?.speaker === speaker) {
            next[i] = {
              ...next[i],
              tone: {
                tone,
                score: confidence || score,
                confidence: confidence || score,
                intent: intent || null,
                requires_action: requires_action !== undefined ? requires_action : null,
              },
            };
            break;
          }
        }
        return next;
      });

      latestToneRef.current = { 
        tone, 
        score: confidence || score,
        confidence: confidence || score,
        intent: intent || null,
        requires_action: requires_action !== undefined ? requires_action : null,
      };
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

        // Mirror transcript segmentation: merge only when the SAME speaker continues
        if (last && last.speaker === seg.speaker) {
          const cleanPart = removeOverlap(last.text, seg.text);
          if (cleanPart) {
            last.text += isPunctuationOnly(cleanPart)
              ? ""
              : (last.text ? " " : "") + cleanPart;
          }
        } else {
          next.push({ role, speaker: seg.speaker, text: seg.text, tone: null });
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
      console.error("Failed to save analysis:", err);
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to save analysis";
      setError(`API Error: ${errorMsg}`);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!selectedTableId || activeSession || isRecording) return;
    const table = tables.find((t) => t.id === selectedTableId);
    if (!table) return;

    const existingStopped = sessions.find(
      (s) => s.tableId === selectedTableId && s.status === "stop"
    );
    const isNewSession = !existingStopped;
    const unique_session_id = isNewSession
      ? crypto.randomUUID()
      : existingStopped.unique_session_id;

    setError(null);

    // For a brand-new session, clear all previous state.
    // For a resumed session, keep previous transcript and analysis.
    if (isNewSession) {
      setTranscript([]);
      setPayloadTranscribe([]);
      setToneAnalysis(null);
      setContentAnalysis(null);
      toneHistoryRef.current = [];
      contentHistoryRef.current = null;
      latestToneRef.current = null;
      pcmChunksRef.current = [];
    }

    if (isNewSession) {
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
      const ws = new WebSocket(getSessionWsUrl(language));
      wsRef.current = ws;

      // Set connection timeout (10 seconds)
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          setError("WebSocket Error: Connection timeout. Please check your network connection and backend status.");
          setIsRecording(false);
          setConnectingAudio(false);
          reject(new Error("WebSocket connection timeout"));
        }
      }, 10000);

      ws.onopen = async () => {
        clearTimeout(connectionTimeout);
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
          console.error("Recording start error:", err);
          const errorMsg = err?.message || err?.name || "Failed to start recording";
          setError(`Recording Error: ${errorMsg}. Please check microphone permissions.`);
          setIsRecording(false);
          setConnectingAudio(false);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
          reject(err);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.message === "Error") {
            const errorMsg = data.reason || data.type || data.error || "Speechmatics error";
            setError(`WebSocket Error: ${errorMsg}`);
            setIsRecording(false);
            setConnectingAudio(false);
            return;
          }
          if (data.message === "PrimingStarted") setIsPriming(true);
          if (data.message === "PrimingComplete") setIsPriming(false);
          handleReceiveMessage(data);
        } catch (parseError) {
          // Handle JSON parsing errors
          console.error("Failed to parse WebSocket message:", parseError);
          setError(`WebSocket Error: Invalid message format - ${parseError.message}`);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error("WebSocket error:", error);
        setError("WebSocket Error: Connection failed. Please check if the backend is running and try again.");
        setIsRecording(false);
        setConnectingAudio(false);
        reject(error);
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        setConnectingAudio(false);
        // Handle different close codes
        if (event.code !== 1000 && event.code !== 1001) {
          // Not a normal closure
          let errorMessage = "WebSocket connection closed unexpectedly.";
          if (event.code === 1006) {
            errorMessage = "WebSocket Error: Connection closed abnormally. Backend may be unreachable or network issue occurred.";
          } else if (event.code === 1002) {
            errorMessage = "WebSocket Error: Protocol error occurred. Please check backend compatibility.";
          } else if (event.code === 1003) {
            errorMessage = "WebSocket Error: Invalid data received from backend.";
          } else if (event.code >= 1004 && event.code <= 1006) {
            errorMessage = `WebSocket Error: Connection closed (code: ${event.code}). Check backend status.`;
          } else if (event.code >= 1007 && event.code <= 1015) {
            errorMessage = `WebSocket Error: Connection terminated (code: ${event.code}). ${event.reason || 'Check backend logs for details.'}`;
          }
          setError(errorMessage);
          setIsRecording(false);
          if (event.code !== 1000) {
            reject(new Error(errorMessage));
          }
        }
      };
    });
  }, [
    selectedTableId,
    tables,
    sessions,
    activeSession,
    isRecording,
    handleReceiveMessage,
    language,
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
        console.error("Upload audio error (stop):", err);
        const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to upload audio";
        setError(`API Error: ${errorMsg}`);
        return;
      }
    }

    try {
      await axios.post(`${API_BASE}/poc/session`, {
        unique_session_id,
        waiter_id: user.id,
        table_id: selectedTableSession.tableId,
        transcriptions: payloadTranscribe.map(({ role, speaker, text, tone }) => ({
          role,
          speaker,
          text,
          tone,
        })),
        audio_path,
        status: "stop",
      });
      await saveAnalysis(unique_session_id);
    } catch (err) {
      console.error("Save session error:", err);
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to save session";
      setError(`API Error: ${errorMsg}`);
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
        console.error("Upload audio error (end):", err);
        const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to upload audio";
        setError(`API Error: ${errorMsg}`);
        return;
      }
    }

    try {
      await axios.post(`${API_BASE}/poc/session`, {
        unique_session_id,
        waiter_id: user.id,
        table_id: selectedTableSession.tableId,
        transcriptions: payloadTranscribe.map(({ role, speaker, text, tone }) => ({
          role,
          speaker,
          text,
          tone,
        })),
        audio_path,
        status: "end",
      });
      await saveAnalysis(unique_session_id);
    } catch (err) {
      console.error("End session error:", err);
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to end session";
      setError(`API Error: ${errorMsg}`);
      return;
    }

    setSessions((prev) => prev.filter((s) => s.unique_session_id !== unique_session_id));
    setTranscript([]);
    setToneAnalysis(null);
    setContentAnalysis(null);
  }, [user, selectedTableSession, payloadTranscribe, saveAnalysis]);

  const handleLogout = useCallback(() => {
    // Stop any active recording before logging out
    if (isRecording && recorderRef.current) {
      recorderRef.current.stopRecording();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    localStorage.removeItem(POC_USER_KEY);
    navigate("/", { replace: true });
  }, [navigate, isRecording]);

  const handleSelectTable = useCallback(
    async (tableId) => {
      if (!canSwitchTable) return;

      setSelectedTableId(tableId);
      setError(null);

      const sessionForTable = sessions.find((s) => s.tableId === tableId);

      // No previous session for this table – clear current view
      if (!sessionForTable) {
        setTranscript([]);
        setPayloadTranscribe([]);
        setToneAnalysis(null);
        setContentAnalysis(null);
        return;
      }

      try {
        const { data } = await axios.get(`${API_BASE}/poc/conversation`, {
          params: { unique_session_id: sessionForTable.unique_session_id },
        });

        const conv = data?.data;
        const transcriptions = conv?.transcriptions || [];
        const items = Array.isArray(transcriptions) ? transcriptions : [];

        // Map stored roles back to speakers for UI
        const restoredTranscript = items.map((seg) => ({
          speaker: seg.speaker || (seg.role === "WAITER" ? "S1" : "S2"),
          text: seg.text || "",
          tone: seg.tone || null,
        }));

        setTranscript(restoredTranscript);
        setPayloadTranscribe(
          items.map((seg) => ({
            role: seg.role,
            speaker: seg.speaker || (seg.role === "WAITER" ? "S1" : "S2"),
            text: seg.text || "",
            tone: seg.tone || null,
          }))
        );
      } catch (err) {
        console.error("Failed to load previous conversation:", err);
        const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to load previous conversation";
        setError(`API Error: ${errorMsg}`);
        setTranscript([]);
        setPayloadTranscribe([]);
      }
    },
    [canSwitchTable, sessions]
  );

  const displayTranscript = transcript;
  const btnDisabled = { opacity: 0.55, cursor: "not-allowed" };

  if (!user) return null;  
  return (
    <div style={pageContainer}>
      <style>{`
        @keyframes pulse { 
          0%, 100% { opacity: 1 } 
          50% { opacity: 0.4 } 
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 12px -2px rgba(0,0,0,0.2) !important;
        }
        button:active:not(:disabled) {
          transform: translateY(0);
        }
        .table-card:hover:not(.locked) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .toggle-btn:hover {
          background: #f1f5f9 !important;
          border-color: #cbd5e1 !important;
        }
        .logout-btn:hover {
          background: #f8fafc !important;
          border-color: #cbd5e1 !important;
          transform: translateY(-2px);
        }
        .error-dismiss-btn:hover {
          opacity: 1 !important;
          background: rgba(153, 27, 27, 0.1) !important;
        }
      `}</style>
      
      {/* ── Header Section ── */}
      <div style={headerSection}>
        <div>
          <h1 style={mainTitle}>Conversation Manager</h1>
          <p style={subtitle}>Real-time transcription and AI-powered analysis</p>
        </div>
        {user && (
          <div style={userInfoContainer}>
            <div style={userInfo}>
              <div style={userAvatar}>{user.email?.[0]?.toUpperCase() || "U"}</div>
              <span style={userEmail}>{user.email}</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="logout-btn"
              style={logoutButton}
              title="Logout"
            >
              <span>🚪</span>
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Main Content Grid ── */}
      <div style={contentGrid}>
        {/* ── Left column: Transcript ── */}
        <div style={mainColumn}>
        {/* Tables Section */}
        {error && (
          <div style={errorCard}>
            <span style={errorIcon}>⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="error-dismiss-btn"
              style={errorDismissButton}
              title="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {loadingTables ? (
          <div style={loadingCard}>
            <div style={loadingSpinner}></div>
            <span>Loading tables...</span>
          </div>
        ) : (
          <div style={tablesBox}>
            <div style={tablesTitle}>
              <span style={sectionIcon}>🍽️</span>
              <span>Select Table</span>
            </div>
            <div style={tablesGrid}>
              {tables.map((t) => {
                const session = sessions.find((s) => s.tableId === t.id);
                const isSelected = selectedTableId === t.id;
                const isLocked = !!activeSession && t.id !== activeSession?.tableId;
                return (
                  <div
                    key={t.id}
                    className={isLocked ? "table-card locked" : "table-card"}
                    style={{
                      ...tableCard,
                      ...(isSelected ? tableCardSelected : {}),
                      ...(isLocked ? tableCardLocked : {}),
                    }}
                    onClick={() => handleSelectTable(t.id)}
                    title={isLocked ? "Pause or end the active session to switch table" : undefined}
                  >
                    <div style={tableCardContent}>
                      <span style={tableIcon}>🪑</span>
                      <span style={tableNumber}>Table {t.table_number}</span>
                    </div>
                    {session && (
                      <span style={statusBadge(session.status)}>{session.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Controls Section */}
        {selectedTableId && (
          <div style={controlsCard}>
            <div style={controlsRow}>
              <button
                type="button"
                onClick={startRecording}
                disabled={!canStart}
                style={{ ...startButton, ...(!canStart ? btnDisabled : {}) }}
              >
                <span style={buttonIcon}>🎤</span>
                <span>Start Recording</span>
              </button>
              <button
                type="button"
                onClick={stopRecording}
                disabled={!canStop}
                style={{ ...stopButton, ...(!canStop ? btnDisabled : {}) }}
              >
                <span style={buttonIcon}>⏸️</span>
                <span>Pause</span>
              </button>
              <button
                type="button"
                onClick={endSession}
                disabled={!canEnd}
                style={{ ...endButton, ...(!canEnd ? btnDisabled : {}) }}
              >
                <span style={buttonIcon}>✓</span>
                <span>End Session</span>
              </button>
            </div>
            <div style={controlsRowSecondary}>
              <div style={languageSelector}>
                <span style={selectorLabel}>🌐 Language:</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={isRecording}
                  style={languageSelect}
                >
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowAnalysis((v) => !v)}
                className="toggle-btn"
                style={toggleAnalysisBtn}
              >
                <span>{showAnalysis ? "👁️" : "👁️‍🗨️"}</span>
                <span>{showAnalysis ? "Hide" : "Show"} Analysis</span>
              </button>
            </div>
          </div>
        )}

        {/* Transcript Section */}
        <div style={transcriptSection}>
          <div style={transcriptHeader}>
            <div style={transcriptHeaderLeft}>
              <span style={sectionIcon}>💬</span>
              <span style={transcriptTitle}>Live Conversation</span>
            </div>
            <div style={transcriptStats}>
              <span style={statBadge}>{displayTranscript.length}</span>
              <span style={statLabel}>segments</span>
            </div>
          </div>
          <div style={transcriptBox}>
            {selectedTableSession?.status === "active" && (
              <div style={recordingIndicator}>
                <span style={recordingDot}></span>
                <span>
                  {connectingAudio
                    ? "Connecting audio..."
                    : isPriming
                      ? "Identifying waiter voice..."
                      : "Recording in progress..."}
                </span>
              </div>
            )}
            {selectedTableSession?.status === "stop" && (
              <div style={pausedIndicator}>
                <span>⏸️</span>
                <span>Session paused. Start recording to continue.</span>
              </div>
            )}
            {!selectedTableSession && selectedTableId && (
              <div style={emptyState}>
                <span style={emptyStateIcon}>🎙️</span>
                <span style={emptyStateText}>Ready to record</span>
                <span style={emptyStateSubtext}>Select a table and start recording to begin</span>
              </div>
            )}
            {displayTranscript.length === 0 && selectedTableSession && (
              <div style={emptyTranscript}>
                <span style={emptyStateIcon}>📝</span>
                <span>No conversation yet. Start speaking to see the transcript here.</span>
              </div>
            )}
            {displayTranscript.length > 0 && (
              <div style={transcriptMessages}>
                {displayTranscript.map((t, i) => {
                  const speakerNum = t.speaker === "S1" ? "WAITER" : "CUSTOMER";
                  const isSpeaker1 = t.speaker === "S1";
                  const tone = t.tone;
                  const toneKey = tone?.tone;
                  const toneCfg = toneKey ? (TONE_CONFIG[toneKey] || TONE_CONFIG.neutral_casual) : null;
                  const isLast = i === displayTranscript.length - 1;
                  
                  // Use stable key based on content to help React optimize
                  const messageKey = `${t.speaker}-${i}-${t.text?.substring(0, 20) || ''}`;

                  return (
                    <div 
                      key={messageKey} 
                      style={{
                        ...transcriptMessage,
                        ...(isSpeaker1 ? messageWaiter : messageCustomer),
                        animation: isLast ? "slideIn 0.3s ease-out" : "none",
                      }}
                    >
                      <div style={messageHeader}>
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
                      <div style={messageText}>{t.text || "\u00a0"}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        </div>

        {/* ── Right column: Analysis Panel ── */}
        {showAnalysis && (
          <div style={analysisColumn} className="analysis-panel">
            <div style={analysisPanelCard}>
            <div style={analysisPanelHeader}>
              <div style={analysisHeaderLeft}>
                <span style={analysisIcon}>🎭</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>Tone Analysis</span>
              </div>
              <span style={analysisBadge}>AI + Audio</span>
            </div>
            <TonePanel tone={toneAnalysis} />
          </div>

          <div style={analysisPanelCard}>
            <div style={analysisPanelHeader}>
              <div style={analysisHeaderLeft}>
                <span style={analysisIcon}>📊</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>Content Analysis</span>
              </div>
              <span style={analysisBadge}>AI / NLP</span>
            </div>
            <ContentPanel content={contentAnalysis} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ──

function statusBadge(status) {
  const colors = { 
    active: { bg: "#10b981", color: "#fff" }, 
    stop: { bg: "#f59e0b", color: "#fff" } 
  };
  const style = colors[status] || { bg: "#6b7280", color: "#fff" };
  return {
    fontSize: 10,
    padding: "4px 10px",
    borderRadius: 12,
    background: style.bg,
    color: style.color,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };
}

const pageContainer = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
  padding: "24px",
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
  maxWidth: 1400,
  margin: "0 auto",
  minHeight: "100vh",
  background: "linear-gradient(to bottom, #f8fafc 0%, #f1f5f9 100%)",
};

const headerSection = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "20px 24px",
  background: "#ffffff",
  borderRadius: 16,
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  marginBottom: 8,
};

const mainTitle = {
  margin: 0,
  fontSize: 28,
  fontWeight: 700,
  color: "#1e293b",
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
};

const subtitle = {
  margin: "4px 0 0 0",
  fontSize: 14,
  color: "#64748b",
  fontWeight: 400,
};

const userInfoContainer = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const userInfo = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 16px",
  background: "#f1f5f9",
  borderRadius: 12,
};

const userAvatar = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 600,
  fontSize: 14,
};

const userEmail = {
  fontSize: 13,
  color: "#475569",
  fontWeight: 500,
};

const logoutButton = {
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
  fontFamily: "inherit",
};

const contentGrid = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 24,
  alignItems: "flex-start",
};

const mainColumn = { 
  minWidth: 0, 
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const analysisColumn = {
  width: 380,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  position: "sticky",
  top: 24,
  maxHeight: "calc(100vh - 48px)",
  overflowY: "auto",
  paddingRight: 4,
};

const analysisPanelCard = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)",
  transition: "all 0.2s ease",
  willChange: "contents",
  contain: "layout style paint",
};

const analysisPanelHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: "2px solid #f1f5f9",
};

const analysisHeaderLeft = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const analysisIcon = {
  fontSize: 18,
};

const analysisBadge = {
  fontSize: 10,
  padding: "4px 10px",
  borderRadius: 12,
  background: "#e0e7ff",
  color: "#4338ca",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const panelEmpty = { 
  color: "#94a3b8", 
  fontSize: 13, 
  fontStyle: "italic", 
  padding: "20px 0",
  textAlign: "center",
};

const toneBadgeLarge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 16px",
  borderRadius: 24,
  border: "2px solid",
  fontWeight: 600,
  fontSize: 14,
  marginBottom: 8,
  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
};

const summaryBox = {
  background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
  borderRadius: 12,
  padding: "12px 14px",
  marginBottom: 12,
  border: "1px solid #e2e8f0",
};

const sectionLabel = { 
  fontSize: 11, 
  fontWeight: 700, 
  color: "#64748b", 
  textTransform: "uppercase", 
  marginBottom: 6, 
  letterSpacing: 1,
};

const intentBadge = {
  display: "inline-block",
  padding: "6px 14px",
  borderRadius: 16,
  fontSize: 12,
  fontWeight: 600,
  background: "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)",
  color: "#1e40af",
  border: "1px solid #93c5fd",
};

const topicChip = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: 12,
  fontSize: 11,
  background: "linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)",
  color: "#5b21b6",
  fontWeight: 600,
  border: "1px solid #c4b5fd",
};

const phraseChip = {
  display: "inline-block",
  padding: "4px 12px",
  borderRadius: 12,
  fontSize: 11,
  background: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)",
  color: "#065f46",
  fontWeight: 600,
  border: "1px solid #6ee7b7",
};

const toxicityBadge = {
  display: "inline-block",
  padding: "6px 14px",
  borderRadius: 16,
  fontSize: 12,
  fontWeight: 600,
};

const errorCard = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 18px",
  background: "#fef2f2",
  border: "2px solid #fecaca",
  borderRadius: 12,
  color: "#991b1b",
  fontSize: 14,
  fontWeight: 500,
  marginBottom: 16,
  boxShadow: "0 2px 8px rgba(220, 38, 38, 0.15)",
  animation: "slideIn 0.3s ease-out",
};

const errorIcon = {
  fontSize: 20,
  flexShrink: 0,
};

const errorDismissButton = {
  background: "transparent",
  border: "none",
  color: "#991b1b",
  fontSize: 18,
  fontWeight: 700,
  cursor: "pointer",
  padding: "0 4px",
  borderRadius: 4,
  lineHeight: 1,
  opacity: 0.7,
  transition: "all 0.2s ease",
  flexShrink: 0,
};

const loadingCard = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "40px",
  background: "#ffffff",
  borderRadius: 12,
  border: "1px solid #e2e8f0",
  color: "#64748b",
  fontSize: 14,
};

const loadingSpinner = {
  width: 20,
  height: 20,
  border: "3px solid #e2e8f0",
  borderTopColor: "#667eea",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};

const tablesBox = {
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 20,
  marginBottom: 0,
  background: "#ffffff",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

const tablesTitle = { 
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 700, 
  marginBottom: 16, 
  fontSize: 16,
  color: "#1e293b",
};

const sectionIcon = {
  fontSize: 18,
};

const tablesGrid = { 
  display: "flex", 
  flexWrap: "wrap", 
  gap: 12,
};

const tableCard = {
  padding: "14px 18px",
  borderRadius: 12,
  border: "2px solid #e2e8f0",
  cursor: "pointer",
  minWidth: 120,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background: "#ffffff",
  transition: "all 0.2s ease",
  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
};

const tableCardSelected = { 
  background: "linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)", 
  borderColor: "#6366f1",
  transform: "translateY(-2px)",
  boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)",
};

const tableCardLocked = { 
  opacity: 0.5, 
  cursor: "not-allowed",
  background: "#f8fafc",
};

const tableCardContent = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const tableIcon = {
  fontSize: 18,
};

const tableNumber = { 
  fontWeight: 700, 
  fontSize: 15,
  color: "#1e293b",
};

const controlsCard = {
  padding: "20px",
  background: "#ffffff",
  borderRadius: 16,
  border: "1px solid #e2e8f0",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

const controlsRow = { 
  display: "flex", 
  gap: 10, 
  marginBottom: 12, 
  flexWrap: "wrap",
};

const controlsRowSecondary = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  justifyContent: "space-between",
  paddingTop: 12,
  borderTop: "1px solid #f1f5f9",
};

const buttonIcon = {
  fontSize: 16,
  marginRight: 6,
};

const startButton = {
  display: "flex",
  alignItems: "center",
  padding: "12px 24px",
  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  color: "white",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  boxShadow: "0 4px 6px -1px rgba(16, 185, 129, 0.3)",
  transition: "all 0.2s ease",
};

const stopButton = {
  display: "flex",
  alignItems: "center",
  padding: "12px 24px",
  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
  color: "white",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  boxShadow: "0 4px 6px -1px rgba(245, 158, 11, 0.3)",
  transition: "all 0.2s ease",
};

const endButton = {
  display: "flex",
  alignItems: "center",
  padding: "12px 24px",
  background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  color: "white",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  boxShadow: "0 4px 6px -1px rgba(99, 102, 241, 0.3)",
  transition: "all 0.2s ease",
};

const languageSelector = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const selectorLabel = {
  fontSize: 13,
  color: "#64748b",
  fontWeight: 500,
};

const languageSelect = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  fontSize: 13,
  fontWeight: 500,
  background: "#ffffff",
  cursor: "pointer",
  color: "#1e293b",
  transition: "all 0.2s ease",
};

const toggleAnalysisBtn = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 16px",
  background: "#f8fafc",
  color: "#475569",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  transition: "all 0.2s ease",
};

const transcriptSection = { 
  marginTop: 0,
};

const transcriptHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
  padding: "0 4px",
};

const transcriptHeaderLeft = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const transcriptTitle = {
  fontSize: 18,
  fontWeight: 700,
  color: "#1e293b",
};

const transcriptStats = {
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const statBadge = {
  padding: "4px 12px",
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  color: "#fff",
  borderRadius: 12,
  fontSize: 13,
  fontWeight: 700,
};

const statLabel = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 500,
};

const transcriptBox = {
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: "20px",
  minHeight: 400,
  maxHeight: 600,
  overflowY: "auto",
  background: "#ffffff",
  fontSize: 15,
  lineHeight: 1.6,
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

const recordingIndicator = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
  border: "1px solid #fecaca",
  borderRadius: 12,
  color: "#991b1b",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 16,
};

const recordingDot = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  background: "#ef4444",
  animation: "pulse 1.5s infinite",
};

const pausedIndicator = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  background: "#fef3c7",
  border: "1px solid #fde68a",
  borderRadius: 12,
  color: "#92400e",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 16,
};

const emptyState = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "60px 20px",
  textAlign: "center",
};

const emptyStateIcon = {
  fontSize: 48,
  marginBottom: 12,
  opacity: 0.5,
};

const emptyStateText = {
  fontSize: 16,
  fontWeight: 600,
  color: "#475569",
  marginBottom: 4,
};

const emptyStateSubtext = {
  fontSize: 13,
  color: "#94a3b8",
};

const emptyTranscript = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px 20px",
  color: "#94a3b8",
  fontStyle: "italic",
  fontSize: 14,
  gap: 12,
};

const transcriptMessages = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const transcriptMessage = {
  marginBottom: 0,
  padding: "16px 18px",
  borderRadius: 16,
  border: "1px solid #e2e8f0",
  transition: "all 0.2s ease",
};

const messageWaiter = {
  background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
  borderColor: "#a7f3d0",
  marginRight: "20%",
};

const messageCustomer = {
  background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
  borderColor: "#93c5fd",
  marginLeft: "20%",
};

const messageHeader = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
  flexWrap: "wrap",
};

function speakerPill(isSpeaker1) {
  return {
    display: "inline-block",
    padding: "5px 14px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
    background: isSpeaker1 
      ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
      : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
  };
}

const inlineToneBadge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  borderRadius: 14,
  border: "1px solid",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "capitalize",
};

const liveIndicator = {
  display: "inline-block",
  padding: "3px 8px",
  borderRadius: 10,
  fontSize: 9,
  fontWeight: 700,
  color: "#fff",
  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
  letterSpacing: 1,
  marginLeft: "auto",
  animation: "pulse 1.5s infinite",
  boxShadow: "0 2px 4px rgba(239, 68, 68, 0.4)",
};

const messageText = {
  fontSize: 15,
  lineHeight: 1.6,
  color: "#1e293b",
  paddingLeft: 2,
};