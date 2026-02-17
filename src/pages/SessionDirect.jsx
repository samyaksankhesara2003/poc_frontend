import { useCallback, useRef, useState } from "react";
import { RealtimeClient } from "@speechmatics/real-time-client";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { PCMRecorder } from "@speechmatics/browser-audio-input";

import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";
const WORKLET_URL = workletUrl;

const RECORDING_SAMPLE_RATE = 16000;

const STATUS = { DRAFT: "draft", ACTIVE: "active", PAUSED: "paused", CLOSED: "closed" };

function newSession(name) {
  return {
    id: crypto.randomUUID(),
    name,
    status: STATUS.DRAFT,
    transcript: [],
    createdAt: Date.now(),
  };
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

export default function SessionDirect() {
  const clientRef = useRef(null);
  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);

  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);

  const activeSessionId = sessions.find((s) => s.status === STATUS.ACTIVE)?.id ?? null;
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const selectedSession = selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) : null;
  const canStartAnother = !activeSessionId;
  const canStartRecording = activeSessionId && selectedSessionId === activeSessionId && !isRecording;
  const canStopRecording = isRecording;
  const canPause = activeSessionId && selectedSessionId === activeSessionId;
  const canClose = selectedSession && (selectedSession.status === STATUS.ACTIVE || selectedSession.status === STATUS.PAUSED);

  const handleReceiveMessage = useCallback((sessionId) => ({ data }) => {
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

    setSessions((prev) => {
      const session = prev.find((s) => s.id === sessionId);
      if (!session) return prev;

      let transcript = [...session.transcript];
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

      return prev.map((s) =>
        s.id === sessionId ? { ...s, transcript } : s
      );
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (!activeSessionId || isRecording) return;

    const apiKey = "ohGijCvsSd5RkR2YKpfWVAUSszsQKkvN";
    if (!apiKey) {
      setError("Missing VITE_SPEECHMATICS_API_KEY in .env");
      return;
    }

    setError(null);
    setIsRecording(true);

    try {
      const jwt = await createSpeechmaticsJWT({
        type: "rt",
        apiKey,
        ttl: 60,
        region: "eu",
      });

      const client = new RealtimeClient({ url: "wss://eu2.rt.speechmatics.com/v2" });
      clientRef.current = client;

      const onMessage = handleReceiveMessage(activeSessionId);
      client.addEventListener("receiveMessage", onMessage);
      client._sessionMessageHandler = onMessage;

      await client.start(jwt, {
        audio_format: {
          type: "raw",
          encoding: "pcm_f32le",
          sample_rate: RECORDING_SAMPLE_RATE,
        },
        transcription_config: {
          language: "en",
          diarization: "speaker",
          operating_point: "enhanced",
          max_delay_mode: "flexible",
          max_delay: 1,
          enable_partials: true,
          enable_entities: true,
          speaker_diarization_config: { max_speakers: 10 },
        },
      });

      const audioContext = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const recorder = new PCMRecorder(WORKLET_URL);
      recorderRef.current = recorder;

      recorder.addEventListener("audio", (e) => {
        if (clientRef.current?.socketState !== "open") return;
        clientRef.current.sendAudio(e.data.buffer);
      });

      await recorder.startRecording({ audioContext });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to start transcription");
      setIsRecording(false);
    }
  }, [activeSessionId, isRecording, handleReceiveMessage]);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);

    if (recorderRef.current) {
      recorderRef.current.stopRecording();
      recorderRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (clientRef.current) {
      try {
        await clientRef.current.stopRecognition();
      } catch (_) { }
      const onMessage = clientRef.current._sessionMessageHandler;
      if (onMessage) clientRef.current.removeEventListener("receiveMessage", onMessage);
      clientRef.current = null;
    }
  }, []);

  const createSession = useCallback(() => {
    const name = `Session ${sessions.length + 1}`;
    const session = newSession(name);
    setSessions((prev) => [...prev, session]);
    setSelectedSessionId(session.id);
  }, [sessions.length]);

  const startSession = useCallback(() => {
    if (!selectedSession || !canStartAnother) return;
    if (selectedSession.status !== STATUS.DRAFT && selectedSession.status !== STATUS.PAUSED) return;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === selectedSession.id ? { ...s, status: STATUS.ACTIVE } : s
      )
    );
    setError(null);
  }, [selectedSession, canStartAnother]);

  const pauseSession = useCallback(async () => {
    if (!selectedSession || selectedSession.status !== STATUS.ACTIVE) return;
    if (isRecording) await stopRecording();

    setSessions((prev) =>
      prev.map((s) =>
        s.id === selectedSession.id ? { ...s, status: STATUS.PAUSED } : s
      )
    );
  }, [selectedSession, isRecording, stopRecording]);

  const closeSession = useCallback(async () => {
    if (!selectedSession) return;
    if (selectedSession.status !== STATUS.ACTIVE && selectedSession.status !== STATUS.PAUSED) return;
    if (isRecording) await stopRecording();

    setSessions((prev) =>
      prev.map((s) =>
        s.id === selectedSession.id ? { ...s, status: STATUS.CLOSED } : s
      )
    );
    if (selectedSessionId === selectedSession.id) setSelectedSessionId(null);
  }, [selectedSession, selectedSessionId, isRecording, stopRecording]);

  const displayTranscript = selectedSession?.transcript ?? [];
  const blockStartBecauseActive = activeSessionId && selectedSessionId !== activeSessionId;

  const startSessionDisabled =
    !selectedSession ||
    (selectedSession?.status !== STATUS.DRAFT && selectedSession?.status !== STATUS.PAUSED) ||
    !canStartAnother;

  const startSessionTitle = !selectedSession
    ? "Select a session from the list above first"
    : selectedSession?.status === STATUS.ACTIVE
      ? "This session is already active"
      : selectedSession?.status === STATUS.CLOSED
        ? "Cannot start a closed session"
        : !canStartAnother
          ? "Pause or close the active session first, then start this one"
          : "Start this session so you can record";

  const pauseSessionTitle = !canPause
    ? activeSessionId && selectedSessionId !== activeSessionId
      ? "Select the active session (green badge) to pause it"
      : !activeSessionId
        ? "No session is active to pause"
        : "Select the active session to pause it"
    : "Pause this session (recording will stop, transcript is kept)";

  const closeSessionTitle = !canClose
    ? !selectedSession
      ? "Select a session first"
      : selectedSession?.status === STATUS.DRAFT
        ? "Start the session first, or select an active/paused session to close"
        : selectedSession?.status === STATUS.CLOSED
          ? "This session is already closed"
          : "Select an active or paused session to close it"
    : "Close this session (transcript is kept)";

  const startRecordingTitle = !canStartRecording
    ? !activeSessionId
      ? "Start a session first, then you can record"
      : selectedSessionId !== activeSessionId
        ? "Select the active session (green badge) to start recording"
        : "Recording is already in progress"
    : "Start recording; speech will be added to this session";

  const stopRecordingTitle = !canStopRecording
    ? "Click this only when you are recording and want to stop"
    : "Stop recording (session stays active; you can start recording again later)";

  const lockHint = activeSessionId
    ? " You cannot create a new session or switch to another until you pause or close the active one."
    : "";

  const nextStepHint =
    sessions.length === 0
      ? "Click « + Create new session » to begin."
      : !selectedSession
        ? "Select a session from the list above."
        : selectedSession.status === STATUS.DRAFT && canStartAnother
          ? "Click « Start session » to make this session active."
          : selectedSession.status === STATUS.DRAFT && !canStartAnother
            ? "Another session is active. Pause or close it first, then start this one."
            : selectedSession.status === STATUS.ACTIVE && !isRecording
              ? "Click « Start recording » to capture speech." + lockHint
              : selectedSession.status === STATUS.ACTIVE && isRecording
                ? "Speak now. Click « Stop recording » when done (session continues)." + lockHint
                : selectedSession.status === STATUS.PAUSED
                  ? "Click « Start session » to resume, then « Start recording » to continue."
                  : "Session closed. Select another or create a new session.";

  return (
    <div style={containerStyle}>
      <h2>Session-wise discussion</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
        Create a session → Start session → Start/Stop recording. Transcript is kept per session until you close it.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={createRow}>
        <button
          type="button"
          onClick={createSession}
          disabled={!!activeSessionId}
          style={{
            ...createButton,
            ...(activeSessionId ? buttonDisabled : {}),
          }}
          title={
            activeSessionId
              ? "Pause or close the active session first to create a new one"
              : "Add a new session to the list"
          }
        >
          + Create new session
        </button>
      </div>

      {sessions.length > 0 && (
        <>
          <div style={nextStepBox}>
            <strong>What to do now:</strong> {nextStepHint}
          </div>

          <div style={sessionListBox}>
            <div style={sessionListTitle}>Sessions</div>
            {sessions.map((s) => {
              const isActiveSession = s.id === activeSessionId;
              const isLockedByActive =
                activeSessionId && !isActiveSession;
              return (
                <div
                  key={s.id}
                  style={{
                    ...sessionRow,
                    ...(selectedSessionId === s.id ? sessionRowSelected : {}),
                    ...(isLockedByActive ? sessionRowLocked : {}),
                  }}
                  onClick={() => {
                    if (isLockedByActive) return;
                    setSelectedSessionId(s.id);
                  }}
                  title={
                    isLockedByActive
                      ? "Pause or close the active session to switch to another"
                      : undefined
                  }
                >
                  <span style={sessionName}>{s.name}</span>
                  <span style={statusBadge(s.status)}>{s.status}</span>
                </div>
              );
            })}
          </div>

          <div style={controlsRow}>
            <button
              type="button"
              onClick={startSession}
              disabled={startSessionDisabled}
              style={{
                ...ctrlButton,
                ...(startSessionDisabled ? buttonDisabled : {}),
              }}
              title={startSessionTitle}
            >
              Start session
            </button>
            <button
              type="button"
              onClick={pauseSession}
              disabled={!canPause}
              style={{
                ...ctrlButton,
                ...(!canPause ? buttonDisabled : {}),
              }}
              title={pauseSessionTitle}
            >
              Pause session
            </button>
            <button
              type="button"
              onClick={closeSession}
              disabled={!canClose}
              style={{
                ...ctrlButton,
                ...(!canClose ? buttonDisabled : {}),
              }}
              title={closeSessionTitle}
            >
              Close session
            </button>
          </div>

          <div style={recordRow}>
            <button
              type="button"
              onClick={startRecording}
              disabled={!canStartRecording}
              style={{
                ...startButton,
                ...(!canStartRecording ? buttonDisabled : {}),
              }}
              title={startRecordingTitle}
            >
              Start recording
            </button>
            <button
              type="button"
              onClick={stopRecording}
              disabled={!canStopRecording}
              style={{
                ...stopButton,
                ...(!canStopRecording ? buttonDisabled : {}),
              }}
              title={stopRecordingTitle}
            >
              Stop recording
            </button>
          </div>
        </>
      )}

      <div style={transcriptSection}>
        <div style={transcriptHeader}>
          <span>Session</span>
          <span>Conversation</span>
        </div>
        <div style={transcriptBox}>
          {selectedSession ? (
            <>
              <div style={transcriptHint}>
                {selectedSession.status === STATUS.DRAFT && "Start this session to begin recording."}
                {selectedSession.status === STATUS.ACTIVE && !isRecording && "Click Start recording to add to this session."}
                {selectedSession.status === STATUS.ACTIVE && isRecording && "Recording…"}
                {selectedSession.status === STATUS.PAUSED && "Session paused. Start session again and then Start recording to continue."}
                {selectedSession.status === STATUS.CLOSED && "Session closed."}
              </div>
              {displayTranscript.length === 0 ? (
                <div style={emptyTranscript}>No conversation yet for this session.</div>
              ) : (
                displayTranscript.map((t, i) => (
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
                ))
              )}
            </>
          ) : (
            <div style={emptyTranscript}>
              Create a session and select it to see the conversation here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusBadge(status) {
  const colors = {
    draft: "#9e9e9e",
    active: "#4caf50",
    paused: "#ff9800",
    closed: "#607d8b",
  };
  return {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 10,
    background: colors[status] || "#eee",
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

const buttonDisabled = {
  opacity: 0.55,
  cursor: "not-allowed",
};

const nextStepBox = {
  marginBottom: 14,
  padding: "10px 12px",
  background: "#e8f4fd",
  borderRadius: 6,
  fontSize: 14,
  color: "#1565c0",
};

const createRow = { marginBottom: 16 };
const createButton = {
  padding: "10px 20px",
  background: "#2196f3",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: "bold",
};

const sessionListBox = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 12,
  marginBottom: 16,
  maxHeight: 160,
  overflowY: "auto",
};
const sessionListTitle = { fontWeight: "bold", marginBottom: 8 };
const sessionRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 10px",
  borderRadius: 6,
  cursor: "pointer",
  marginBottom: 4,
};
const sessionRowSelected = { background: "#e3f2fd" };
const sessionRowLocked = {
  opacity: 0.65,
  cursor: "not-allowed",
  pointerEvents: "auto",
};
const sessionName = { fontWeight: 500 };

const controlsRow = {
  display: "flex",
  gap: 10,
  marginBottom: 12,
  flexWrap: "wrap",
};
const ctrlButton = {
  padding: "8px 16px",
  background: "#37474f",
  color: "white",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
};

const recordRow = { display: "flex", gap: 10, marginBottom: 20 };
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
