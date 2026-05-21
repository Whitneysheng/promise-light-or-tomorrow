"use client";

import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Octagon,
  Play,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CueTreatment, PerformerCue } from "@/lib/types";

type PerformerData = {
  performance: {
    title: string;
    status: string;
    seed: string | null;
  };
  cues: PerformerCue[];
};

type ActiveVoice = {
  source: AudioBufferSourceNode;
  nodes: AudioNode[];
};

function distortionCurve(amount: number) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const drive = Math.max(0.001, amount) * 80;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + drive) * x * 20 * (Math.PI / 180)) / (Math.PI + drive * Math.abs(x));
  }
  return curve;
}

function reverseBuffer(context: AudioContext, buffer: AudioBuffer) {
  const reversed = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    const output = reversed.getChannelData(channel);
    for (let i = 0; i < input.length; i += 1) {
      output[i] = input[input.length - 1 - i];
    }
  }

  return reversed;
}

function impulse(context: AudioContext, seconds: number) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
  }

  return buffer;
}

export function PerformerConsole() {
  const [passcode, setPasscode] = useState("");
  const [data, setData] = useState<PerformerData | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useRef<AudioContext | null>(null);
  const decoded = useRef<Map<string, AudioBuffer>>(new Map());
  const activeVoices = useRef<ActiveVoice[]>([]);

  const stopAll = useCallback(() => {
    activeVoices.current.forEach((voice) => {
      try {
        voice.source.stop();
      } catch {
        // Sources may already be stopped.
      }
      voice.nodes.forEach((node) => node.disconnect());
    });
    activeVoices.current = [];
  }, []);

  const ensureAudio = useCallback(async () => {
    if (!context.current) {
      context.current = new AudioContext();
    }
    if (context.current.state === "suspended") {
      await context.current.resume();
    }
    setAudioReady(true);
    return context.current;
  }, []);

  async function loadCues() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/performer-cues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "Could not load performer cues.");
      return;
    }

    setData(payload);
    setCurrentIndex(-1);
    decoded.current.clear();
  }

  const decodeCue = useCallback(async (cue: PerformerCue) => {
    if (!cue.signedUrl) return null;
    const existing = decoded.current.get(cue.id);
    if (existing) return existing;

    const audioContext = await ensureAudio();
    const response = await fetch(cue.signedUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    const treated = cue.treatment.reverse
      ? reverseBuffer(audioContext, buffer)
      : buffer;
    decoded.current.set(cue.id, treated);
    return treated;
  }, [ensureAudio]);

  const playCue = useCallback(async (index: number) => {
    if (!data?.cues[index]) return;
    const cue = data.cues[index];
    const audioContext = await ensureAudio();
    const buffer = await decodeCue(cue);
    if (!buffer) return;

    const treatment: CueTreatment = cue.treatment ?? {};
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const shaper = audioContext.createWaveShaper();
    const delay = audioContext.createDelay(1);
    const delayGain = audioContext.createGain();
    const convolver = audioContext.createConvolver();
    const wetGain = audioContext.createGain();
    const dryGain = audioContext.createGain();

    source.buffer = buffer;
    source.loop = true;
    source.loopStart = Math.min(treatment.loopStart ?? 0, buffer.duration - 0.05);
    source.loopEnd = Math.min(
      treatment.loopEnd ?? Math.min(buffer.duration, 3),
      buffer.duration,
    );
    source.playbackRate.value = treatment.playbackRate ?? 1;

    gain.gain.value = treatment.gain ?? 0.65;
    filter.type = treatment.filterType ?? "lowpass";
    filter.frequency.value = treatment.filterFrequency ?? 2400;
    shaper.curve = distortionCurve(treatment.distortion ?? 0.02);
    shaper.oversample = "2x";
    delay.delayTime.value = treatment.delay ?? 0;
    delayGain.gain.value = treatment.delay ? 0.24 : 0;
    convolver.buffer = impulse(audioContext, 1.8);
    wetGain.gain.value = treatment.reverb ?? 0;
    dryGain.gain.value = 1 - Math.min(treatment.reverb ?? 0, 0.72);

    source.connect(shaper);
    shaper.connect(filter);
    filter.connect(gain);
    gain.connect(dryGain);
    dryGain.connect(audioContext.destination);
    gain.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(delay);
    delayGain.connect(audioContext.destination);
    gain.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(audioContext.destination);

    source.start();
    activeVoices.current.push({
      source,
      nodes: [gain, filter, shaper, delay, delayGain, convolver, wetGain, dryGain],
    });
  }, [data, decodeCue, ensureAudio]);

  const advance = useCallback(async () => {
    if (!data?.cues.length) {
      await ensureAudio();
      return;
    }
    const nextIndex = Math.min(currentIndex + 1, data.cues.length - 1);
    setCurrentIndex(nextIndex);
    await playCue(nextIndex);
  }, [currentIndex, data, ensureAudio, playCue]);

  const replay = useCallback(async () => {
    if (currentIndex >= 0) await playCue(currentIndex);
  }, [currentIndex, playCue]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (["Space", "Enter", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
        void advance();
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        setCurrentIndex((index) => Math.max(-1, index - 1));
      }
      if (event.code === "Escape") {
        event.preventDefault();
        stopAll();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, stopAll]);

  const currentCue = currentIndex >= 0 ? data?.cues[currentIndex] : null;
  const nextCue = data?.cues[currentIndex + 1] ?? null;

  return (
    <main className="console-shell performer">
      <section className="console-header">
        <div>
          <p className="eyebrow">performer console</p>
          <h1>promise light or tomorrow</h1>
        </div>
        <a className="text-link" href="/admin">
          Admin
        </a>
      </section>

      <section className="toolbar">
        <label>
          <span>Admin passcode</span>
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadCues();
            }}
          />
        </label>
        <button onClick={loadCues} disabled={loading || !passcode}>
          {loading ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
          Load cues
        </button>
        <button className="secondary" onClick={() => void ensureAudio()}>
          <Volume2 size={18} />
          Unlock audio
        </button>
      </section>

      {error && <p className="error-text">{error}</p>}

      <section className="pedal-panel">
        <div>
          <span className={audioReady ? "status-dot ready" : "status-dot"} />
          {audioReady ? "Audio ready" : "Press Unlock Audio or pedal once"}
        </div>
        <div>
          Foot pedal keys: <strong>Space</strong>, <strong>Enter</strong>, or{" "}
          <strong>ArrowRight</strong>
        </div>
      </section>

      <section className="cue-display">
        <div className="cue-now">
          <span>Current</span>
          <strong>{currentCue?.label ?? "before first cue"}</strong>
          <p>{currentCue?.treatment.name ?? "waiting"}</p>
          <small>{currentCue?.fragmentText ?? "No whisper assigned yet."}</small>
        </div>
        <div className="cue-next">
          <span>Next</span>
          <strong>{nextCue?.label ?? "end"}</strong>
          <p>{nextCue?.treatment.name ?? "no next cue"}</p>
        </div>
      </section>

      <section className="transport">
        <button className="secondary" onClick={() => setCurrentIndex((index) => Math.max(-1, index - 1))}>
          <ArrowLeft size={20} />
          Previous
        </button>
        <button className="primary-large" onClick={() => void advance()}>
          <Play size={24} />
          Advance cue
        </button>
        <button className="secondary" onClick={() => void replay()}>
          <RotateCcw size={20} />
          Replay
        </button>
        <button className="secondary" onClick={() => void advance()}>
          <SkipForward size={20} />
          Skip
        </button>
        <button className="danger" onClick={stopAll}>
          <Octagon size={20} />
          Stop all
        </button>
      </section>

      {data && (
        <section className="cue-list">
          {data.cues.map((cue, index) => (
            <button
              className={index === currentIndex ? "cue-row active" : "cue-row"}
              key={cue.id}
              onClick={() => {
                setCurrentIndex(index);
                void playCue(index);
              }}
            >
              <span>{cue.label}</span>
              <strong>{cue.treatment.name ?? "treatment"}</strong>
              <em>{cue.fragmentText ?? "silent fallback"}</em>
              <ArrowRight size={16} />
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
