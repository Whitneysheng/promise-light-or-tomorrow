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

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function textMatchScore(expected: string, actual: string) {
  const expectedWords = new Set(words(expected));
  const actualWords = new Set(words(actual));
  if (!expectedWords.size || !actualWords.size) return 0;

  let matches = 0;
  expectedWords.forEach((word) => {
    if (actualWords.has(word)) matches += 1;
  });

  return matches / expectedWords.size;
}

function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = samples * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  function writeString(value: string) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < samples; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

async function cleanAndNormalizeAudio(blob: Blob) {
  const audioContext = new AudioContext();
  const input = await audioContext.decodeAudioData(await blob.arrayBuffer());
  const offline = new OfflineAudioContext(
    input.numberOfChannels,
    input.length,
    input.sampleRate,
  );
  const source = offline.createBufferSource();
  const highpass = offline.createBiquadFilter();
  const lowpass = offline.createBiquadFilter();
  const compressor = offline.createDynamicsCompressor();

  source.buffer = input;
  highpass.type = "highpass";
  highpass.frequency.value = 120;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 6200;
  compressor.threshold.value = -38;
  compressor.knee.value = 18;
  compressor.ratio.value = 4.5;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.16;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(compressor);
  compressor.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  await audioContext.close();

  const floorSamples = Math.min(rendered.length, Math.floor(rendered.sampleRate * 0.35));
  let noiseTotal = 0;
  let noiseCount = 0;
  let peak = 0;

  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let i = 0; i < floorSamples; i += 1) {
      noiseTotal += data[i] * data[i];
      noiseCount += 1;
    }
  }

  const noiseFloor = Math.sqrt(noiseTotal / Math.max(1, noiseCount));
  const gate = Math.max(0.008, noiseFloor * 2.4);

  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      if (Math.abs(data[i]) < gate) data[i] *= 0.06;
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }

  const targetPeak = 0.89;
  const gain = peak > 0 ? Math.min(8, targetPeak / peak) : 1;
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.max(-1, Math.min(1, data[i] * gain));
    }
  }

  return encodeWav(rendered);
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
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
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
    setTranscript("");
    setMatchScore(null);
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
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
        setProcessing(true);
        cleanAndNormalizeAudio(blob)
          .then((processed) => {
            setAudioBlob(processed);
            setAudioUrl(URL.createObjectURL(processed));
          })
          .catch(() => {
            setAudioBlob(blob);
            setAudioUrl(URL.createObjectURL(blob));
            setError("Audio cleanup was not available, so the raw recording is ready.");
          })
          .finally(() => setProcessing(false));
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
          let recognized = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            recognized += event.results[i][0].transcript;
          }
          setTranscript((current) => `${current} ${recognized}`.trim());
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
    const score = transcript ? textMatchScore(selectedText, transcript) : null;
    setMatchScore(score);

    setRecorderState("submitting");
    setError(null);

    const formData = new FormData();
    formData.append("performanceId", bootstrap.performance.id);
    formData.append("fragmentId", selectedFragment);
    formData.append("durationSeconds", String(duration));
    formData.append("transcript", transcript);
    formData.append("textMatchScore", score === null ? "" : String(score));
    formData.append("processingNotes", "browser voice-band filtering, noise gate, compression, peak normalization");
    formData.append("audio", audioBlob, audioBlob.type.includes("wav") ? "voice.wav" : "voice.webm");

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

        {processing && <p className="muted">Cleaning noise and leveling the recording.</p>}

        {transcript && recorderState !== "submitted" && (
          <p className="selected-line">
            Detected: <strong>&quot;{transcript}&quot;</strong>
          </p>
        )}

        {matchScore !== null && (
          <p className="selected-line">
            Text match: <strong>{Math.round(matchScore * 100)}%</strong>
          </p>
        )}

        {!transcript && audioUrl && recorderState === "review" && (
          <p className="selected-line">
            Speech check unavailable on this device. Listen back before submitting.
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

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
              <button onClick={submitRecording} disabled={processing}>
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
