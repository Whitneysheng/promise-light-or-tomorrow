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
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  timers?: number[];
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

function noiseBuffer(context: AudioContext, seconds: number) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      brown = brown * 0.985 + (Math.random() * 2 - 1) * 0.08;
      data[i] = Math.max(-1, Math.min(1, brown + (Math.random() * 2 - 1) * 0.28));
    }
  }

  return buffer;
}

function fadeTo(
  context: AudioContext,
  gain: AudioParam,
  value: number,
  seconds: number,
  delay = 0,
) {
  const start = context.currentTime + delay;
  gain.cancelScheduledValues(start);
  gain.setValueAtTime(gain.value, start);
  gain.linearRampToValueAtTime(value, start + seconds);
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
  const activeSoundtrackLayers = useRef<Set<string>>(new Set());

  const stopAll = useCallback(() => {
    activeVoices.current.forEach((voice) => {
      voice.sources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Sources may already be stopped.
        }
      });
      voice.timers?.forEach((timer) => window.clearTimeout(timer));
      voice.nodes.forEach((node) => node.disconnect());
    });
    activeVoices.current = [];
    activeSoundtrackLayers.current.clear();
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

  const decodeAssignment = useCallback(async (cue: PerformerCue, assignmentId: string, signedUrl: string) => {
    const key = `${cue.id}:${assignmentId}`;
    const existing = decoded.current.get(key);
    if (existing) return existing;

    const audioContext = await ensureAudio();
    const response = await fetch(signedUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    const treated = cue.treatment.reverse
      ? reverseBuffer(audioContext, buffer)
      : buffer;
    decoded.current.set(key, treated);
    return treated;
  }, [ensureAudio]);

  const startSoundtrackLayer = useCallback(async (cue: PerformerCue) => {
    const layer = cue.treatment.soundtrackLayer;
    if (!layer) return false;
    if (activeSoundtrackLayers.current.has(layer)) return true;

    const audioContext = await ensureAudio();
    const master = audioContext.createGain();
    const convolver = audioContext.createConvolver();
    const wetGain = audioContext.createGain();
    const dryGain = audioContext.createGain();
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [master, convolver, wetGain, dryGain];
    const timers: number[] = [];

    master.gain.value = 0;
    convolver.buffer = impulse(audioContext, 2.6);
    wetGain.gain.value = 0.34;
    dryGain.gain.value = 0.82;
    master.connect(dryGain);
    dryGain.connect(audioContext.destination);
    master.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(audioContext.destination);

    function addNoiseWind() {
      const source = audioContext.createBufferSource();
      const highpass = audioContext.createBiquadFilter();
      const lowpass = audioContext.createBiquadFilter();
      const whoosh = audioContext.createBiquadFilter();
      const bodyGain = audioContext.createGain();
      const whooshGain = audioContext.createGain();
      const windGain = audioContext.createGain();
      const lfo = audioContext.createOscillator();
      const lfoDepth = audioContext.createGain();

      source.buffer = noiseBuffer(audioContext, 5);
      source.loop = true;
      highpass.type = "highpass";
      highpass.frequency.value = 90;
      lowpass.type = "lowpass";
      lowpass.frequency.value = 3200;
      whoosh.type = "bandpass";
      whoosh.frequency.value = 1450;
      whoosh.Q.value = 0.55;
      bodyGain.gain.value = 0.2;
      whooshGain.gain.value = 0.42;
      windGain.gain.value = 0.46;
      lfo.frequency.value = 0.08;
      lfoDepth.gain.value = 980;

      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(bodyGain);
      bodyGain.connect(windGain);
      lowpass.connect(whoosh);
      whoosh.connect(whooshGain);
      whooshGain.connect(windGain);
      windGain.connect(master);
      lfo.connect(lfoDepth);
      lfoDepth.connect(whoosh.frequency);
      source.start();
      lfo.start();

      sources.push(source, lfo);
      nodes.push(highpass, lowpass, whoosh, bodyGain, whooshGain, windGain, lfoDepth);
    }

    function addTone(
      frequencies: number[],
      gains: number[],
      delay: number,
      fadeSeconds: number,
      filterFrequency = 1800,
    ) {
      const toneGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      const pan = audioContext.createStereoPanner();
      toneGain.gain.value = 0;
      filter.type = "lowpass";
      filter.frequency.value = filterFrequency;
      pan.pan.value = Math.random() * 0.8 - 0.4;
      toneGain.connect(filter);
      filter.connect(pan);
      pan.connect(master);
      nodes.push(toneGain, filter, pan);

      frequencies.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const partialGain = audioContext.createGain();
        oscillator.type = index < 2 ? "triangle" : "sine";
        oscillator.frequency.value = frequency * (0.998 + Math.random() * 0.004);
        partialGain.gain.value = gains[index] ?? gains[gains.length - 1] ?? 0.01;
        oscillator.connect(partialGain);
        partialGain.connect(toneGain);
        oscillator.start(audioContext.currentTime + delay);
        sources.push(oscillator);
        nodes.push(partialGain);
      });

      fadeTo(audioContext, toneGain.gain, 1, fadeSeconds, delay);
    }

    function addSoftBell(frequencies: number[], delay: number) {
      const scheduleBell = () => {
        const bellGain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();
        const pan = audioContext.createStereoPanner();
        bellGain.gain.value = 0.16;
        filter.type = "highpass";
        filter.frequency.value = 430;
        pan.pan.value = Math.random() * 1.4 - 0.7;
        bellGain.connect(filter);
        filter.connect(pan);
        pan.connect(master);
        nodes.push(bellGain, filter, pan);

        frequencies.forEach((frequency, index) => {
          const oscillator = audioContext.createOscillator();
          const partialGain = audioContext.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = frequency;
          partialGain.gain.value = 0.045 / (index + 1);
          oscillator.connect(partialGain);
          partialGain.connect(bellGain);
          oscillator.start();
          oscillator.stop(audioContext.currentTime + 4.8);
          sources.push(oscillator);
          nodes.push(partialGain);
        });

        bellGain.gain.setValueAtTime(0, audioContext.currentTime);
        bellGain.gain.linearRampToValueAtTime(0.16, audioContext.currentTime + 0.18);
        bellGain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 4.8);
      };

      const firstTimer = window.setTimeout(scheduleBell, delay * 1000 + Math.random() * 2200);
      const intervalTimer = window.setInterval(scheduleBell, 28000 + Math.random() * 12000);
      timers.push(firstTimer, intervalTimer);
    }

    if (layer === "windEflat") {
      addNoiseWind();
      addTone(
        [77.782, 155.563, 311.127, 622.254, 1244.508, 1866.762, 2489.016],
        [0.032, 0.035, 0.026, 0.014, 0.018, 0.014, 0.01],
        0,
        8,
        2200,
      );
      addSoftBell([622.254, 1244.508, 2489.016, 3733.524], 5);
      fadeTo(audioContext, master.gain, 1, 4);
    }

    if (layer === "dNatural") {
      addTone(
        [73.416, 146.832, 293.665, 587.33, 1174.66, 1761.99, 2349.32],
        [0.022, 0.025, 0.02, 0.011, 0.012, 0.009, 0.006],
        0,
        5,
        1900,
      );
      addSoftBell([587.33, 1174.66, 2349.32, 3523.98], 3);
      fadeTo(audioContext, master.gain, 0.86, 4);
    }

    if (layer === "bflatBnatural") {
      addTone(
        [58.27, 116.541, 233.082, 466.164, 932.328, 1398.492, 2796.984],
        [0.016, 0.018, 0.014, 0.008, 0.008, 0.006, 0.004],
        0,
        5,
        1650,
      );
      addTone(
        [61.735, 123.471, 246.942, 493.883, 987.767, 1481.65, 2963.3],
        [0.012, 0.014, 0.011, 0.006, 0.006, 0.0045, 0.003],
        3,
        5,
        1700,
      );
      addSoftBell([466.164, 932.328, 1864.656, 2796.984], 4);
      addSoftBell([493.883, 987.767, 1975.533, 2963.3], 7);
      fadeTo(audioContext, master.gain, 0.82, 4);
    }

    activeSoundtrackLayers.current.add(layer);
    activeVoices.current.push({ sources, nodes, timers });
    return true;
  }, [ensureAudio]);

  const playCue = useCallback(async (index: number) => {
    if (!data?.cues[index]) return;
    const cue = data.cues[index];
    if (cue.treatment.soundtrackLayer) {
      await startSoundtrackLayer(cue);
      return;
    }

    const audioContext = await ensureAudio();
    const playableAssignments = cue.assignments.filter(
      (assignment) => assignment.signedUrl,
    );
    if (!playableAssignments.length) return;

    const treatment: CueTreatment = cue.treatment ?? {};

    await Promise.all(
      playableAssignments.map(async (assignment) => {
        const buffer = await decodeAssignment(cue, assignment.id, assignment.signedUrl ?? "");
        if (!buffer) return;

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
        source.loop = treatment.texture !== "sequence";
        source.loopStart = Math.min(treatment.loopStart ?? 0, buffer.duration - 0.05);
        source.loopEnd = Math.min(
          treatment.loopEnd ?? Math.min(buffer.duration, 3),
          buffer.duration,
        );
        source.playbackRate.value = treatment.playbackRate ?? 1;

        gain.gain.value = (treatment.gain ?? 0.65) * assignment.gain;
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

        source.start(audioContext.currentTime + assignment.start_offset_seconds);
        activeVoices.current.push({
          sources: [source],
          nodes: [gain, filter, shaper, delay, delayGain, convolver, wetGain, dryGain],
        });
      }),
    );
  }, [data, decodeAssignment, ensureAudio, startSoundtrackLayer]);

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
          <small>
            {currentCue?.treatment.texture === "soundtrack"
              ? "Built-in additive soundtrack layer."
              : currentCue?.assignments
              .map((assignment) => assignment.fragmentText)
              .filter(Boolean)
              .join(" / ") || "No voice assigned yet."}
          </small>
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
              <em>
                {cue.treatment.texture === "soundtrack"
                  ? "additive soundtrack layer"
                  : cue.assignments.length
                  ? `${cue.treatment.texture ?? "solo"} / ${cue.assignments.filter((assignment) => assignment.signedUrl).length} voices`
                  : "silent fallback"}
              </em>
              <ArrowRight size={16} />
            </button>
          ))}
        </section>
      )}
    </main>
  );
}
