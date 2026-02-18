import { useCallback, useRef, useState } from "react";
import { PCMRecorder } from "@speechmatics/browser-audio-input";
import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";

const WORKLET_URL = workletUrl;
const RECORDING_SAMPLE_RATE = 16000;
const MIC_START_DELAY_MS = 1800;

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/poc/";
const ENROLLMENT_URL = `${API_BASE.replace(/\/$/, "")}/waiter-enrollment`;
const WS_CONVERSATION_URL =
  import.meta.env.VITE_WS_CONVERSATION_URL || "ws://localhost:3000/conversation-waiter";

const SESSION_STATUS = { DRAFT: "draft", ACTIVE: "active", PAUSED: "paused", CLOSED: "closed" };

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

export default function WaiterConversation() {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);

  const [enrollmentStatus, setEnrollmentStatus] = useState("idle"); // idle | recording | sending | success | error
  const [enrollmentResult, setEnrollmentResult] = useState(null); // { transcript, waiterId, filename }
  const [enrollmentError, setEnrollmentError] = useState(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const timerRef = useRef(null);

  const [sessionStatus, setSessionStatus] = useState(SESSION_STATUS.DRAFT);
  const [conversationTranscript, setConversationTranscript] = useState([]); // { speaker: "waiter"|"customer", text }
  const [isRecording, setIsRecording] = useState(false);
  const [connectingAudio, setConnectingAudio] = useState(false);
  const [conversationError, setConversationError] = useState(null);

  const canStartSession = enrollmentResult && sessionStatus === SESSION_STATUS.DRAFT;
  const canPauseSession = sessionStatus === SESSION_STATUS.ACTIVE;
  const canCloseSession = sessionStatus === SESSION_STATUS.ACTIVE || sessionStatus === SESSION_STATUS.PAUSED;
  const canStartRecording = sessionStatus === SESSION_STATUS.ACTIVE && !isRecording && enrollmentResult;
  const canStopRecording = isRecording;

  const sendEnrollmentAudio = useCallback(async (blob) => {
    setEnrollmentStatus("sending");
    setEnrollmentError(null);
    try {
      const formData = new FormData();
      formData.append("audio", blob, "waiter-recording.webm");
      const res = await fetch(ENROLLMENT_URL, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setEnrollmentError(data?.error || "Enrollment failed");
        setEnrollmentStatus("error");
        return;
      }
      setEnrollmentResult({
        transcript: data.transcript,
        waiterId: data.waiterId,
        filename: data.filename,
      });
      setEnrollmentStatus("success");
    } catch (err) {
      console.error(err);
      setEnrollmentError(err?.message || "Failed to send audio");
      setEnrollmentStatus("error");
    }
  }, []);

  const startEnrollmentRecording = useCallback(async () => {
    setEnrollmentError(null);
    setEnrollmentResult(null);
    setEnrollmentStatus("recording");
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
        await sendEnrollmentAudio(blob);
      };
      recorder.start(1000);
      timerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000);
    } catch (err) {
      console.error(err);
      setEnrollmentError(err?.message || "Could not access microphone");
      setEnrollmentStatus("error");
    }
  }, [sendEnrollmentAudio]);

  const stopEnrollmentRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      clearInterval(timerRef.current);
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, []);

  const handleLabeledTranscript = useCallback((data) => {
    if (data.message !== "LabeledTranscript" || !data.results?.length) return;
    const segments = data.results;
    setConversationTranscript((prev) => {
      let transcript = [...prev];
      for (const seg of segments) {
        const last = transcript[transcript.length - 1];
        if (last && last.speaker === seg.speaker) {
          const cleanPart = removeOverlap(last.text, seg.text);
          if (cleanPart) {
            transcript[transcript.length - 1] = {
              ...last,
              text: last.text + (isPunctuationOnly(cleanPart) ? "" : " ") + cleanPart,
            };
          }
        } else {
          transcript.push({ speaker: seg.speaker, text: seg.text });
        }
      }
      return transcript;
    });
  }, []);

  const startConversationRecording = useCallback(async () => {
    if (!enrollmentResult?.waiterId || sessionStatus !== SESSION_STATUS.ACTIVE || isRecording) return;
    setConversationError(null);
    setIsRecording(true);

    const ws = new WebSocket(WS_CONVERSATION_URL);
    wsRef.current = ws;

    ws.onopen = async () => {
      try {
        ws.send(JSON.stringify({ type: "config", waiterId: enrollmentResult.waiterId }));
        setConnectingAudio(true);
        await new Promise((r) => setTimeout(r, MIC_START_DELAY_MS));
        setConnectingAudio(false);
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        const audioContext = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
        audioContextRef.current = audioContext;
        const recorder = new PCMRecorder(WORKLET_URL);
        recorderRef.current = recorder;
        recorder.addEventListener("audio", (e) => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) return;
          wsRef.current.send(convertFloatTo16BitPCM(e.data));
        });
        await recorder.startRecording({ audioContext });
      } catch (err) {
        console.error(err);
        setConversationError(err?.message || "Failed to start recording");
        setIsRecording(false);
        setConnectingAudio(false);
        ws.close();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.message === "Error") {
          setConversationError(data.reason || data.type || "Speechmatics error");
          return;
        }
        handleLabeledTranscript(data);
      } catch (_) {}
    };

    ws.onerror = () => setConversationError("WebSocket error. Is the backend running?");
    ws.onclose = () => {
      setConnectingAudio(false);
      wsRef.current = null;
    };
  }, [enrollmentResult, sessionStatus, isRecording, handleLabeledTranscript]);

  const stopConversationRecording = useCallback(async () => {
    setIsRecording(false);
    setConnectingAudio(false);
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
  }, []);

  const startSession = useCallback(() => {
    if (!canStartSession) return;
    setSessionStatus(SESSION_STATUS.ACTIVE);
    setConversationError(null);
  }, [canStartSession]);

  const pauseSession = useCallback(async () => {
    if (sessionStatus !== SESSION_STATUS.ACTIVE) return;
    if (isRecording) await stopConversationRecording();
    setSessionStatus(SESSION_STATUS.PAUSED);
  }, [sessionStatus, isRecording, stopConversationRecording]);

  const closeSession = useCallback(async () => {
    if (sessionStatus !== SESSION_STATUS.ACTIVE && sessionStatus !== SESSION_STATUS.PAUSED) return;
    if (isRecording) await stopConversationRecording();
    setSessionStatus(SESSION_STATUS.CLOSED);
  }, [sessionStatus, isRecording, stopConversationRecording]);

  const createNewSession = useCallback(() => {
    setEnrollmentStatus("idle");
    setEnrollmentResult(null);
    setEnrollmentError(null);
    setSessionStatus(SESSION_STATUS.DRAFT);
    setConversationTranscript([]);
    setConversationError(null);
  }, []);

  const formatDuration = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div style={containerStyle}>
      <h2>Waiter + customer conversation (POC 2)</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Enroll the waiter&apos;s voice, then start a conversation. Speechmatics transcribes in real time;
        speakers are labeled as waiter or customer by matching to the enrolled voice in Pinecone.
      </p>

      {/* ——— Phase 1: Create session + Waiter record voice ——— */}
      <section style={sectionStyle}>
        <div style={sectionTitle}>1. Create session & waiter voice</div>
        <div style={buttonRow}>
          <button
            type="button"
            onClick={createNewSession}
            disabled={sessionStatus === SESSION_STATUS.ACTIVE}
            style={{ ...primaryButton, ...(sessionStatus === SESSION_STATUS.ACTIVE ? buttonDisabled : {}) }}
          >
            + Create session
          </button>
          <button
            type="button"
            onClick={startEnrollmentRecording}
            disabled={enrollmentStatus === "recording" || enrollmentStatus === "sending"}
            style={{
              ...secondaryButton,
              ...(enrollmentStatus === "recording" || enrollmentStatus === "sending" ? buttonDisabled : {}),
            }}
          >
            Waiter record voice → Start
          </button>
          <button
            type="button"
            onClick={stopEnrollmentRecording}
            disabled={enrollmentStatus !== "recording"}
            style={{ ...secondaryButton, ...(enrollmentStatus !== "recording" ? buttonDisabled : {}) }}
          >
            Stop
          </button>
        </div>
        {enrollmentStatus === "recording" && (
          <div style={timerStyle}>Recording: {formatDuration(recordDuration)} — aim for 15–20 s</div>
        )}
        {enrollmentStatus === "sending" && <div style={statusStyle}>Storing voice in Pinecone…</div>}
        {enrollmentError && <div style={errorStyle}>{enrollmentError}</div>}
        {enrollmentStatus === "success" && enrollmentResult && (
          <div style={successBox}>
            Voice stored in Pinecone. <strong>Waiter ID:</strong> {enrollmentResult.waiterId}
          </div>
        )}
      </section>

      {/* ——— Phase 2: Session controls + Conversation record ——— */}
      {enrollmentResult && (
        <section style={sectionStyle}>
          <div style={sectionTitle}>2. Conversation with customer</div>
          <div style={buttonRow}>
            <button
              type="button"
              onClick={startSession}
              disabled={!canStartSession}
              style={{ ...ctrlButton, ...(!canStartSession ? buttonDisabled : {}) }}
            >
              Session start
            </button>
            <button
              type="button"
              onClick={pauseSession}
              disabled={!canPauseSession}
              style={{ ...ctrlButton, ...(!canPauseSession ? buttonDisabled : {}) }}
            >
              Stop session
            </button>
            <button
              type="button"
              onClick={closeSession}
              disabled={!canCloseSession}
              style={{ ...ctrlButton, ...(!canCloseSession ? buttonDisabled : {}) }}
            >
              Close session
            </button>
          </div>
          <div style={buttonRow}>
            <button
              type="button"
              onClick={startConversationRecording}
              disabled={!canStartRecording}
              style={{ ...startButton, ...(!canStartRecording ? buttonDisabled : {}) }}
            >
              Start record
            </button>
            <button
              type="button"
              onClick={stopConversationRecording}
              disabled={!canStopRecording}
              style={{ ...stopButton, ...(!canStopRecording ? buttonDisabled : {}) }}
            >
              Stop record
            </button>
          </div>
          {conversationError && <div style={errorStyle}>{conversationError}</div>}
          <div style={transcriptHint}>
            {sessionStatus === SESSION_STATUS.ACTIVE && !isRecording && "Click Start record to capture conversation."}
            {sessionStatus === SESSION_STATUS.ACTIVE && isRecording && (connectingAudio ? "Connecting…" : "Recording…")}
            {sessionStatus === SESSION_STATUS.PAUSED && "Session paused. Start session again to continue."}
            {sessionStatus === SESSION_STATUS.CLOSED && "Session closed."}
          </div>
        </section>
      )}

      {/* ——— Transcript: waiter: / customer: ——— */}
      <section style={sectionStyle}>
        <div style={transcriptHeader}>
          <span>Session</span>
          <span>Conversation (waiter / customer)</span>
        </div>
        <div style={transcriptBox}>
          {conversationTranscript.length === 0 ? (
            <div style={emptyTranscript}>
              {enrollmentResult
                ? "Start session, then Start record to see waiter/customer transcript here."
                : "Complete waiter voice enrollment first."}
            </div>
          ) : (
            conversationTranscript.map((t, i) => (
              <div key={i} style={transcriptLine}>
                <span style={speakerPill(t.speaker === "waiter")}>
                  {t.speaker === "waiter" ? "waiter" : "customer"}
                </span>
                <span style={transcriptLineText}>{t.text || "\u00a0"}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

const containerStyle = {
  padding: 30,
  fontFamily: "Arial",
  maxWidth: 700,
  margin: "auto",
};

const sectionStyle = { marginBottom: 24 };
const sectionTitle = { fontWeight: "bold", marginBottom: 10, fontSize: 15 };
const buttonRow = { display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" };
const primaryButton = {
  padding: "10px 20px",
  background: "#2196f3",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};
const secondaryButton = {
  padding: "10px 18px",
  background: "#37474f",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
const ctrlButton = {
  padding: "8px 16px",
  background: "#37474f",
  color: "white",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
};
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
const buttonDisabled = { opacity: 0.6, cursor: "not-allowed" };
const timerStyle = { fontSize: 14, color: "#1565c0", marginBottom: 8 };
const statusStyle = { fontSize: 14, color: "#666", marginBottom: 8 };
const errorStyle = { color: "#c62828", marginBottom: 12, padding: 10, background: "#ffebee", borderRadius: 6 };
const successBox = { padding: 12, background: "#e8f5e9", borderRadius: 8, marginBottom: 12, fontSize: 14 };
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
  minHeight: 280,
  maxHeight: 400,
  overflowY: "auto",
  background: "#f9f9f9",
  fontSize: 16,
  lineHeight: 1.6,
};
const transcriptHint = { fontSize: 13, color: "#666", marginBottom: 10 };
const emptyTranscript = { color: "#999", fontStyle: "italic" };
const transcriptLine = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  marginBottom: 10,
  flexWrap: "wrap",
};
function speakerPill(isWaiter) {
  return {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    flexShrink: 0,
    background: isWaiter ? "#66bb6a" : "#42a5f5",
  };
}
const transcriptLineText = { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 1.5 };
