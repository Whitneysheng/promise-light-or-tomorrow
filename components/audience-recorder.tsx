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

export function AudienceRecorder() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<string>("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
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

  const selectedText = useMemo(
    () =>
      bootstrap?.fragments.find((fragment) => fragment.id === selectedFragment)
        ?.text ?? "",
    [bootstrap?.fragments, selectedFragment],
  );

  async function startRecording() {
    setError(null);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setError(
          "This browser cannot record audio here. On phones, use the deployed HTTPS site for microphone access.",
        );
        return;
      }

      const userStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      stream.current = userStream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(
        userStream,
        mimeType ? { mimeType } : undefined,
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
      startedAt.current = performance.now();
      recorder.start();
      setRecorderState("recording");
    } catch {
      setError("Microphone permission is needed to record your whisper.");
    }
  }

  function stopRecording() {
    mediaRecorder.current?.stop();
    setRecorderState("idle");
  }

  async function submitRecording() {
    if (!bootstrap || !audioBlob || !selectedFragment) return;
    setRecorderState("submitting");
    setError(null);

    const formData = new FormData();
    formData.append("performanceId", bootstrap.performance.id);
    formData.append("fragmentId", selectedFragment);
    formData.append("durationSeconds", String(duration));
    formData.append("audio", audioBlob, "whisper.webm");

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
        <p className="eyebrow">participatory whisper</p>
        <h1>promise light or tomorrow</h1>
        <p className="intro">
          Choose one line that resonates with you. Whisper it once into this
          page. Your recording becomes part of tonight&apos;s electronic texture.
        </p>

        <div className="workflow-strip" aria-label="Recording workflow">
          <span>1. Choose a line</span>
          <span>2. Record a whisper</span>
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
          <legend>Choose one line to whisper</legend>
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

        {error && <p className="error-text">{error}</p>}

        <div className="button-row">
          {recorderState === "idle" && (
            <button disabled={!isOpen} onClick={startRecording}>
              <Mic size={18} />
              Record whisper
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
