import { useCallback, useRef, useState } from "react";
import { RealtimeClient } from "@speechmatics/real-time-client";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { PCMRecorder } from "@speechmatics/browser-audio-input";

// Worklet for PCM capture – Vite resolves this at build time
import workletUrl from "@speechmatics/browser-audio-input/pcm-audio-worklet.min.js?url";
const WORKLET_URL = workletUrl;

const RECORDING_SAMPLE_RATE = 16000;

export default function DirectUiToSpeechSpeech() {
  const clientRef = useRef(null);
  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);

  const removeOverlap = (prevText, newText) => {
    const prev = prevText.trim().split(" ");
    const next = newText.trim().split(" ");

    let overlapLength = 0;
    const maxCheck = Math.min(prev.length, next.length);

    for (let i = 1; i <= maxCheck; i++) {
      const prevSlice = prev.slice(-i).join(" ");
      const nextSlice = next.slice(0, i).join(" ");
      if (prevSlice === nextSlice) {
        overlapLength = i;
      }
    }

    return next.slice(overlapLength).join(" ");
  };

  const convertFloatTo16BitPCM = (input) => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    let offset = 0;

    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return buffer;
  };

  // Punctuation-only content: attach without space
  const isPunctuationOnly = (s) => /^[.,!?;:'"\s]+$/.test((s || "").trim());

  const handleReceiveMessage = useCallback(({ data }) => {
    if (data.message !== "AddTranscript") return;

    const results = data.results;
    if (!results?.length) return;

    // Build segments from this message using per-word speaker (so "I" and "Don't" get correct speaker)
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
      let out = [...prev];
      for (const seg of segments) {
        const last = out[out.length - 1];
        if (last && last.speaker === seg.speaker) {
          const cleanPart = removeOverlap(last.text, seg.text);
          if (cleanPart) {
            out[out.length - 1].text += (isPunctuationOnly(cleanPart) ? "" : " ") + cleanPart;
          }
        } else {
          out.push({ speaker: seg.speaker, text: seg.text });
        }
      }
      return out;
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    const apiKey = "sSIy0r41ImnljaQ7v4Yn1RLCM5Jqd9tE";
    if (!apiKey) {
      setError(
        "Missing VITE_SPEECHMATICS_API_KEY. Add it to your .env file (see .env.example)."
      );
      return;
    }

    setError(null);
    setTranscript([]);
    setIsRecording(true);

    try {
      const jwt = await createSpeechmaticsJWT({
        type: "rt",
        apiKey,
        ttl: 60,
        region: "eu",
      });

      const client = new RealtimeClient({
        url: "wss://eu2.rt.speechmatics.com/v2",
      });
      clientRef.current = client;

      client.addEventListener("receiveMessage", handleReceiveMessage);

      await client.start(jwt, {
        audio_format: {
          type: "raw",
          encoding: "pcm_s16le",
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
          speaker_diarization_config: {
            max_speakers: 5,
          },
        },
      });

      const audioContext = new AudioContext({ sampleRate: RECORDING_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const recorder = new PCMRecorder(WORKLET_URL);
      recorderRef.current = recorder;

      recorder.addEventListener("audio", (e) => {
        if (clientRef.current?.socketState !== "open") return;
        const pcm = convertFloatTo16BitPCM(e.data);
        clientRef.current.sendAudio(pcm);
      });

      await recorder.startRecording({
        audioContext,
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to start transcription");
      setIsRecording(false);
    }
  }, [isRecording, handleReceiveMessage]);

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
      } catch (_) {
        // ignore timeout on stop
      }
      clientRef.current.removeEventListener("receiveMessage", handleReceiveMessage);
      clientRef.current = null;
    }
  }, [handleReceiveMessage]);

  return (
    <div style={containerStyle}>
      <h2>Realtime Speech To Text (Direct from browser)</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
        Uses Speechmatics API directly — no backend. Set{" "}
        <code>VITE_SPEECHMATICS_API_KEY</code> in <code>.env</code>.
      </p>

      {error && (
        <div style={{ color: "#c62828", marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ marginBottom: 20 }}>
        <button
          onClick={startRecording}
          disabled={isRecording}
          style={startButton}
        >
          Start
        </button>

        <button
          onClick={stopRecording}
          disabled={!isRecording}
          style={stopButton}
        >
          Stop
        </button>
      </div>

      <div style={transcriptBox}>
        {transcript.map((t, i) => (
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
        ))}
      </div>
    </div>
  );
}

const containerStyle = {
  padding: 30,
  fontFamily: "Arial",
  maxWidth: 700,
  margin: "auto",
};

const startButton = {
  padding: "10px 20px",
  background: "#007bff",
  color: "white",
  border: "none",
  borderRadius: 5,
  marginRight: 10,
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

const transcriptBox = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 15,
  height: 350,
  overflowY: "auto",
  background: "#f9f9f9",
  fontSize: 16,
  lineHeight: 1.6,
};
