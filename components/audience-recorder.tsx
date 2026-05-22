"use client";

import { Mic, Pause, Play, RotateCcw, Send, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Fragment, Performance } from "@/lib/types";

type Bootstrap = {
  performance: Performance;
  fragments: Fragment[];
  demoMode?: boolean;
};

type RecorderState = "idle" | "recording" | "review" | "submitting" | "submitted";
type MicPermissionState = "unknown" | "ready" | "blocked";
type VerificationResult = {
  ok: boolean;
  reason?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

function getSpeechRecognition() {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

const audioConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

async function getVoiceStream() {
  return navigator.mediaDevices.getUserMedia(audioConstraints);
}

function stopStream(input: MediaStream) {
  input.getTracks().forEach((track) => track.stop());
}

const blockedWords = new Set([
  "asshole",
  "bitch",
  "cunt",
  "dick",
  "fuck",
  "fucked",
  "fucker",
  "fucking",
  "pussy",
  "shit",
  "slut",
  "whore",
]);

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function verifyTranscript(expected: string, actual: string): VerificationResult {
  const expectedWords = normalizedWords(expected);
  const actualWords = normalizedWords(actual);

  if (!actualWords.length) {
    return {
      ok: false,
      reason:
        "No verified speech was detected. Please record the selected line again.",
    };
  }

  if (actualWords.some((word) => blockedWords.has(word))) {
    return {
      ok: false,
      reason:
        "The recording includes words outside the selected text. Please record only the selected line.",
    };
  }

  const expectedSet = new Set(expectedWords);
  const matchingWords = actualWords.filter((word) => expectedSet.has(word));
  const extraWords = actualWords.filter((word) => !expectedSet.has(word));
  const coverage = matchingWords.length / Math.max(1, expectedWords.length);
  const lengthDelta = Math.abs(actualWords.length - expectedWords.length);

  if (coverage < 0.8 || lengthDelta > 2 || extraWords.length > 2) {
    return {
      ok: false,
      reason:
        "The detected words do not match the selected line. Please record only the selected line.",
    };
  }

  return { ok: true };
}

export function AudienceRecorder() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<string>("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [micPermission, setMicPermission] =
    useState<MicPermissionState>("unknown");
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscript = useRef<string>("");
  const startedAt = useRef<number>(0);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    fetch("/api/bootstrap", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            data?.error ??
              "Could not load the performance. Check Supabase env vars or enable demo mode.",
          );
        }

        return data;
      })
      .then((data) => {
        setBootstrap(data);
        setSelectedFragment(data.fragments?.[0]?.id ?? "");
      })
      .catch((bootstrapError) =>
        setError(
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Could not load the performance.",
        ),
      );

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!bootstrap || micPermission !== "unknown") return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;

    let cancelled = false;
    getVoiceStream()
      .then((permissionStream) => {
        stopStream(permissionStream);
        if (!cancelled) setMicPermission("ready");
      })
      .catch(() => {
        if (!cancelled) setMicPermission("blocked");
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap, micPermission]);

  const selectedText = useMemo(
    () =>
      bootstrap?.fragments.find((fragment) => fragment.id === selectedFragment)
        ?.text ?? "",
    [bootstrap?.fragments, selectedFragment],
  );

  async function startRecording() {
    setError(null);
    setAudioBlob(null);
    setTranscript("");
    finalTranscript.current = "";
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setError(
          "This browser cannot record audio here. On phones, use the deployed HTTPS site for microphone access.",
        );
        return;
      }

      const userStream = await getVoiceStream();
      setMicPermission("ready");
      stream.current = userStream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(
        userStream,
        mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined,
      );
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setDuration((performance.now() - startedAt.current) / 1000);
        setRecorderState("review");
        userStream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.current = recorder;
      const Recognition = getSpeechRecognition();
      if (Recognition) {
        const speech = new Recognition();
        speech.continuous = true;
        speech.interimResults = true;
        speech.lang = "en-US";
        speech.onresult = (event) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const phrase = event.results[i][0].transcript.trim();
            if (!phrase) continue;
            if (event.results[i].isFinal) {
              finalTranscript.current = `${finalTranscript.current} ${phrase}`.trim();
            } else {
              interim = `${interim} ${phrase}`.trim();
            }
          }
          setTranscript(`${finalTranscript.current} ${interim}`.trim());
        };
        speech.onend = () => {
          recognition.current = null;
        };
        try {
          speech.start();
          recognition.current = speech;
        } catch {
          recognition.current = null;
        }
      }
      startedAt.current = performance.now();
      recorder.start();
      setRecorderState("recording");
    } catch {
      setError("Microphone permission is needed to record your voice.");
    }
  }

  function stopRecording() {
    recognition.current?.stop();
    recognition.current = null;
    mediaRecorder.current?.stop();
    setRecorderState("idle");
  }

  async function submitRecording() {
    if (!bootstrap || !audioBlob || !selectedFragment) return;
    const verification = verifyTranscript(selectedText, transcript);
    if (!verification.ok) {
      setError(verification.reason ?? "Please record the selected line again.");
      return;
    }

    setRecorderState("submitting");
    setError(null);

    const formData = new FormData();
    formData.append("performanceId", bootstrap.performance.id);
    formData.append("fragmentId", selectedFragment);
    formData.append("durationSeconds", String(duration));
    formData.append("transcript", transcript);
    formData.append("processingNotes", "raw browser recording");
    formData.append("audio", audioBlob, audioBlob.type.includes("mp4") ? "voice.mp4" : "voice.webm");

    const response = await fetch("/api/submit", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      setRecorderState("review");
      setError(payload.error ?? "The recording could not be submitted.");
      return;
    }

    setRecorderState("submitted");
  }

  if (!bootstrap) {
    return (
      <main className="audience-shell">
        <section className="audience-panel">
          <p className="eyebrow">loading</p>
          <h1>promise light or tomorrow</h1>
          <p className="muted">{error ?? "Preparing the fragments."}</p>
        </section>
      </main>
    );
  }

  const isOpen = bootstrap.performance.status === "open";

  return (
    <main className="audience-shell">
      <section className="audience-panel">
        <p className="eyebrow">participatory voice</p>
        <h1>promise light or tomorrow</h1>
        <p className="intro">
          Choose one line that resonates with you. Speak it once into the
          phone&apos;s microphone, held close like a voice memo. Your recording
          becomes part of the performance&apos;s
          electronic texture.
        </p>

        <div className="workflow-strip" aria-label="Recording workflow">
          <span>1. Choose a line</span>
          <span>2. Speak into the mic</span>
          <span>3. Review and submit</span>
        </div>

        {bootstrap.demoMode && (
          <div className="notice demo">
            Demo mode is on. You can test recording and submission UI, but
            recordings are not saved until Supabase is configured.
          </div>
        )}

        {!isOpen && (
          <div className="notice closed">
            Submissions are now closed for this performance.
          </div>
        )}

        <fieldset className="fragment-grid" disabled={!isOpen || recorderState === "submitted"}>
          <legend>Choose one line to speak</legend>
          {bootstrap.fragments.map((fragment) => (
            <label
              className={
                fragment.id === selectedFragment
                  ? "fragment-choice selected"
                  : "fragment-choice"
              }
              key={fragment.id}
            >
              <input
                type="radio"
                name="fragment"
                value={fragment.id}
                checked={fragment.id === selectedFragment}
                onChange={() => setSelectedFragment(fragment.id)}
              />
              <span>&quot;{fragment.text}&quot;</span>
            </label>
          ))}
        </fieldset>

        {selectedText && (
          <p className="selected-line">
            Selected: <strong>&quot;{selectedText}&quot;</strong>
          </p>
        )}

        {audioUrl && recorderState !== "submitted" && (
          <audio className="review-player" controls src={audioUrl} />
        )}

        {transcript && recorderState !== "submitted" && (
          <p className="selected-line">
            Detected: <strong>&quot;{transcript}&quot;</strong>
          </p>
        )}

        {!transcript && audioUrl && recorderState === "review" && (
          <p className="selected-line">
            Speech check unavailable on this device. Listen back before submitting.
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        {micPermission === "blocked" && (
          <p className="selected-line">
            Microphone permission is not active yet. Tap Record and allow access.
          </p>
        )}

        {recorderState !== "submitted" && (
          <p className="recording-tip">
            Hold the bottom microphone close to your mouth, like recording a
            voice memo. Speak the selected line clearly into the mic.
          </p>
        )}

        <div className="button-row">
          {recorderState === "idle" && (
            <button disabled={!isOpen} onClick={startRecording}>
              <Mic size={18} />
              Record close voice
            </button>
          )}
          {recorderState === "recording" && (
            <button className="danger" onClick={stopRecording}>
              <Square size={18} />
              Stop
            </button>
          )}
          {recorderState === "review" && (
            <>
              <button className="secondary" onClick={startRecording}>
                <RotateCcw size={18} />
                Record again
              </button>
              <button onClick={submitRecording}>
                <Send size={18} />
                Submit
              </button>
            </>
          )}
          {recorderState === "submitting" && (
            <button disabled>
              <Pause size={18} />
              Sending
            </button>
          )}
          {recorderState === "submitted" && (
            <button disabled>
              <Play size={18} />
              Received
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
