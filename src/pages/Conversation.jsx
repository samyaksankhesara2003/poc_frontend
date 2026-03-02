import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import TranscriptWithPartial from "../components/TranscriptWithPartial.jsx";

const MIC_START_DELAY_MS = 1800;
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Which STT engine: "speechmatics" | "soniox". Backend routes by path.
const WS_ENGINE = import.meta.env.VITE_WS_ENGINE || "soniox";
const WS_HOST = import.meta.env.VITE_WS_HOST || "localhost:3000";
const WS_PROTOCOL = import.meta.env.VITE_WS_PROTOCOL || "ws";
const WS_BASE =
  import.meta.env.VITE_WS_SESSION_URL ||
  `${WS_PROTOCOL}://${WS_HOST}${WS_ENGINE === "soniox" ? "/session-soniox" : "/session-backend"}`;
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

// helper used to trim overlapping words between segments
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

// we no longer split sentences at render time; the raw segment text is shown as-is
function splitSentences(text) {
  // kept for compatibility but returns the whole text
  if (!text || !String(text).trim()) return [];
  return [String(text)];
}

/**
 * Determine the best supported MIME type for MediaRecorder.
 */
function getPreferredMime() {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", ext: ".webm" },
    { mimeType: "audio/webm", ext: ".webm" },
    { mimeType: "audio/ogg;codecs=opus", ext: ".ogg" },
    { mimeType: "audio/mp4", ext: ".mp4" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", ext: ".webm" };
}

export default function Conversation() {
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const mimeInfoRef = useRef(null);

  const [user, setUser] = useState(null);
  const [tables, setTables] = useState([]);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [sessions, setSessions] = useState([]);

  const [transcript, setTranscript] = useState([]);
  const [partialSegment, setPartialSegment] = useState(null); // { speaker, text } – provisional (lighter)
  const [payloadTranscribe, setPayloadTranscribe] = useState([]); // Backend-ready state

  const [isRecording, setIsRecording] = useState(false);
  const [connectingAudio, setConnectingAudio] = useState(false);
  const [isPriming, setIsPriming] = useState(false);
  const [error, setError] = useState(null);
  const [loadingTables, setLoadingTables] = useState(true);

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
    if (data.message === "PartialTranscript") {
      const results = data.results;
      if (!results?.length) return;
      const parts = [];
      let speaker = "S1";
      for (const r of results) {
        const content = r.alternatives?.[0]?.content;
        const sp = r.alternatives?.[0]?.speaker || "S1";
        if (content != null) {
          parts.push(content);
          speaker = sp;
        }
      }
      if (parts.length > 0) {
        setPartialSegment({ speaker, text: parts.join("").trim() });
      }
      return;
    }

    if (data.message !== "AddTranscript") return;
    const results = data.results;
    if (!results?.length) return;
    setPartialSegment(null);

    const segments = [];
    for (const r of results) {
      const content = r.alternatives?.[0]?.content;
      const speaker = r.alternatives?.[0]?.speaker || "S1";
      if (content == null) continue;
      if (segments.length > 0 && segments[segments.length - 1].speaker === speaker) {
        const last = segments[segments.length - 1];
        const clean = removeOverlap(last.text, content);
        if (clean) {
          last.text += (last.text ? " " : "") + clean;
        }
      } else {
        segments.push({ speaker, text: content });
      }
    }
    if (segments.length === 0) return;

    setTranscript((prev) => {
      const next = [...prev];
      for (const seg of segments) {
        const last = next[next.length - 1];
        if (last && last.speaker === seg.speaker) {
          const clean = removeOverlap(last.text, seg.text);
          if (clean) {
            last.text += (last.text ? " " : "") + clean;
          }
        } else {
          next.push({ speaker: seg.speaker, text: seg.text });
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
          const clean = removeOverlap(last.text, seg.text);
          if (clean) {
            last.text += (last.text ? " " : "") + clean;
          }
        } else {
          next.push({ role, text: seg.text });
        }
      }
      return next;
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (!selectedTableId || activeSession || isRecording) return;
    const table = tables.find((t) => t.id === selectedTableId);
    if (!table) return;

    setError(null);
    setTranscript([]);
    setPartialSegment(null);
    setPayloadTranscribe([]);
    recordedChunksRef.current = [];

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

          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = micStream;

          const mimeInfo = getPreferredMime();
          mimeInfoRef.current = mimeInfo;

          const options = mimeInfo.mimeType ? { mimeType: mimeInfo.mimeType } : {};
          const recorder = new MediaRecorder(micStream, options);
          recorderRef.current = recorder;

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              recordedChunksRef.current.push(e.data);
              // Stream chunk to WebSocket as binary
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                e.data.arrayBuffer().then((buf) => {
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(buf);
                  }
                });
              }
            }
          };

          // Use timeslice to get frequent chunks for real-time streaming
          recorder.start(250);
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
            setError(data.reason || data.type || "Soniox error");
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

  /** Stop the MediaRecorder and mic stream; close WebSocket. */
  const cleanupRecording = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      await new Promise((resolve) => {
        recorderRef.current.onstop = resolve;
        recorderRef.current.stop();
      });
    }
    recorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsRecording(false);
    setConnectingAudio(false);
    setIsPriming(false);
  }, []);

  /** Upload recorded chunks as a single audio file to the backend. */
  const uploadRecordedAudio = useCallback(async (unique_session_id) => {
    const chunks = recordedChunksRef.current;
    if (chunks.length === 0) return `${unique_session_id}.webm`;

    const mimeInfo = mimeInfoRef.current || { ext: ".webm" };
    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    const file = new File([blob], `recording${mimeInfo.ext}`, { type: blob.type });
    const form = new FormData();
    form.append("audio", file, file.name);
    form.append("unique_session_id", unique_session_id);
    const { data } = await axios.post(`${API_BASE}/poc/upload-conversation`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data?.audio_path || `${unique_session_id}${mimeInfo.ext}`;
  }, []);

  const stopRecording = useCallback(async () => {
    if (!user || !selectedTableSession || selectedTableSession.status !== "active") return;

    const unique_session_id = selectedTableSession.unique_session_id;

    await cleanupRecording();

    setSessions((prev) =>
      prev.map((s) =>
        s.unique_session_id === unique_session_id ? { ...s, status: "stop" } : s
      )
    );

    let audio_path = `${unique_session_id}.webm`;
    try {
      audio_path = await uploadRecordedAudio(unique_session_id);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to upload audio");
      return;
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
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to save session");
    }
  }, [user, selectedTableSession, payloadTranscribe, cleanupRecording, uploadRecordedAudio]);

  const endSession = useCallback(async () => {
    if (!user || !selectedTableSession || selectedTableSession.status !== "active") return;

    const unique_session_id = selectedTableSession.unique_session_id;

    await cleanupRecording();

    let audio_path = `${unique_session_id}.webm`;
    try {
      audio_path = await uploadRecordedAudio(unique_session_id);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to upload audio");
      return;
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
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to end session");
      return;
    }

    setSessions((prev) => prev.filter((s) => s.unique_session_id !== unique_session_id));
    setTranscript([]);
  }, [user, selectedTableSession, payloadTranscribe, cleanupRecording, uploadRecordedAudio]);

  const handleSelectTable = (tableId) => {
    if (!canSwitchTable) return;
    setSelectedTableId(tableId);
    setError(null);
  };

  const displayTranscript = transcript;
  const btnDisabled = { opacity: 0.55, cursor: "not-allowed" };

  if (!user) return null;

  return (
    <div style={containerStyle}>
      <h2>Conversation by table</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
        Select a table, then Start recording. Stop = pause session, End = close session (customer left).
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      {loadingTables ? (
        <p>Loading tables…</p>
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
            title={
              !canSwitchTable
                ? "Stop or end the active session first"
                : !selectedTableId
                  ? "Select a table first"
                  : "Start recording for this table"
            }
          >
            Start recording
          </button>
          <button
            type="button"
            onClick={stopRecording}
            disabled={!canStop}
            style={{ ...stopButton, ...(!canStop ? btnDisabled : {}) }}
            title="Pause session (customer still at table)"
          >
            Stop recording
          </button>
          <button
            type="button"
            onClick={endSession}
            disabled={!canEnd}
            style={{ ...endButton, ...(!canEnd ? btnDisabled : {}) }}
            title="End session (customer left)"
          >
            End session
          </button>
        </div>
      )}

      <div style={transcriptSection}>
        <div style={transcriptHeader}>
          <span>Speaker</span>
          <span>Conversation</span>
        </div>
        <TranscriptWithPartial
          transcript={displayTranscript}
          partial={partialSegment}
          hint={
            selectedTableSession?.status === "active"
              ? connectingAudio
                ? "Connecting…"
                : isPriming
                  ? "🎙 Identifying waiter voice…"
                  : "Recording…"
              : selectedTableSession?.status === "stop"
                ? "Session paused. Start recording to continue."
                : !selectedTableSession && selectedTableId
                  ? "Select a table and start recording."
                  : null
          }
          emptyMessage="No conversation yet."
        />
      </div>
    </div>
  );
}

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

const containerStyle = {
  padding: 30,
  fontFamily: "Arial",
  maxWidth: 700,
  margin: "auto",
};
const errorStyle = { color: "#c62828", marginBottom: 12 };
const tablesBox = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 12,
  marginBottom: 16,
};
const tablesTitle = { fontWeight: "bold", marginBottom: 8 };
const tablesGrid = { display: "flex", flexWrap: "wrap", gap: 10 };
const tableCard = {
  padding: "12px 16px",
  borderRadius: 8,
  border: "1px solid #ccc",
  cursor: "pointer",
  minWidth: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};
const tableCardSelected = { background: "#e3f2fd", borderColor: "#2196f3" };
const tableCardLocked = { opacity: 0.6, cursor: "not-allowed" };
const tableNumber = { fontWeight: 600 };
const controlsRow = { display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" };
const startButton = {
  padding: "10px 20px",
  background: "#007bff",
  color: "white",
  border: "none",
  borderRadius: 5,
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
const endButton = {
  padding: "10px 20px",
  background: "#5a6268",
  color: "white",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
};
const transcriptSection = { marginTop: 8 };
const transcriptHeader = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 6,
  fontSize: 14,
  color: "#555",
};
const transcriptBox = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 15,
  minHeight: 320,
  maxHeight: 400,
  overflowY: "auto",
  background: "#f9f9f9",
  fontSize: 16,
  lineHeight: 1.6,
};
const transcriptHint = { fontSize: 13, color: "#666", marginBottom: 12 };
const emptyTranscript = { color: "#999", fontStyle: "italic" };
const transcriptLine = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  marginBottom: 10,
  flexWrap: "wrap",
};
function speakerPill(isSpeaker1) {
  return {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    flexShrink: 0,
    background: isSpeaker1 ? "#66bb6a" : "#42a5f5",
  };
}
const transcriptLineText = { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 1.5 };
