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
  gains: GainNode[];
};

const TARGET_VOICE_RMS = 0.105;
const MIN_VOICE_GAIN = 0.35;
const MAX_VOICE_GAIN = 2.8;
const SECTION_CUE_FADE_SECONDS = 1;
const OVERLAP_FADE_SECONDS_BY_LAYER: Partial<
  Record<NonNullable<CueTreatment["soundtrackLayer"]>, number>
> = {
  oceanWaves: 2,
  lowDoubleBass: 3,
  oceanWavesCDbEbG: 3,
  innerPressure: 3,
};
const VOICE_SILENCE_THRESHOLD = 0.00008;
const SOUNDTRACK_SILENCE_THRESHOLD = 0.003;
const FINAL_VOICE_CUE_INDEX = 10;
const FINAL_FADE_SECONDS = 2;

const soundtrackAssets = {
  windEflat: "/soundtrack/01_wind_eflat_stem.wav",
  dNatural: "/soundtrack/02_d_natural_only_stem.wav",
  bflatBnatural: "/soundtrack/03_bflat_bnatural_stem.wav",
  windChimes: "/soundtrack/04_wind_chimes_stem.wav",
  oceanWaves: "/soundtrack/05_gentle_ocean_waves_stem.wav",
  lowDoubleBass: "/soundtrack/06_low_double_bass_vibration_stem.wav",
  oceanWavesCDbEbG: "/soundtrack/07_gentle_ocean_waves_c_db_eb_g_stem.wav",
  whimsicalIce: "/soundtrack/08_whimsical_ice_percussion_stem.wav",
  innerPressure: "/soundtrack/09_foreshadowing_inner_pressure_stem.wav",
} satisfies Record<NonNullable<CueTreatment["soundtrackLayer"]>, string>;

const soundtrackGains = {
  windEflat: 0.48,
  dNatural: 0.72,
  bflatBnatural: 0.72,
  windChimes: 0.78,
  oceanWaves: 0.7,
  lowDoubleBass: 0.72,
  oceanWavesCDbEbG: 0.7,
  whimsicalIce: 0.78,
  innerPressure: 0.72,
} satisfies Record<NonNullable<CueTreatment["soundtrackLayer"]>, number>;

const soundtrackNames = {
  windEflat: "Wind + E-flat",
  dNatural: "D natural layer",
  bflatBnatural: "B-flat + B natural",
  windChimes: "Small wind chimes",
  oceanWaves: "Ocean waves + bowed vibraphone",
  lowDoubleBass: "Low double bass sul ponticello",
  oceanWavesCDbEbG: "Ocean waves C / D-flat / E-flat / G",
  whimsicalIce: "Whimsical ice percussion",
  innerPressure: "Foreshadowing inner pressure",
} satisfies Record<NonNullable<CueTreatment["soundtrackLayer"]>, string>;

function cueNumberLabel(index: number | null | undefined) {
  return index == null || index < 0 ? "before first cue" : `Cue ${index + 1}`;
}

function cueDisplayName(cue: PerformerCue | null | undefined) {
  if (!cue) return "";
  const soundtrackName = cue.treatment.soundtrackLayer
    ? soundtrackNames[cue.treatment.soundtrackLayer]
    : null;
  return soundtrackName ?? cue.treatment.name ?? "treatment";
}

function wait(seconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
}

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function voiceRms(buffer: AudioBuffer) {
  const windowSize = Math.max(256, Math.floor(buffer.sampleRate * 0.05));
  const windowScores: number[] = [];

  for (let start = 0; start < buffer.length; start += windowSize) {
    const end = Math.min(buffer.length, start + windowSize);
    let total = 0;
    let count = 0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = start; i < end; i += 1) {
        total += data[i] * data[i];
        count += 1;
      }
    }

    windowScores.push(Math.sqrt(total / Math.max(1, count)));
  }

  const sorted = windowScores
    .filter((score) => Number.isFinite(score) && score > 0.001)
    .sort((a, b) => b - a);

  if (!sorted.length) return 0;

  const voicedWindowCount = Math.max(1, Math.ceil(sorted.length * 0.35));
  const voicedTotal = sorted
    .slice(0, voicedWindowCount)
    .reduce((sum, score) => sum + score, 0);

  return voicedTotal / voicedWindowCount;
}

function loudnessGain(buffer: AudioBuffer) {
  const rms = voiceRms(buffer);
  if (!rms) return 1;
  return clamp(TARGET_VOICE_RMS / rms, MIN_VOICE_GAIN, MAX_VOICE_GAIN);
}

function leadingSoundOffset(buffer: AudioBuffer, silenceThreshold = VOICE_SILENCE_THRESHOLD) {
  const windowSize = Math.max(128, Math.floor(buffer.sampleRate * 0.025));
  const prerollFrames = Math.floor(buffer.sampleRate * 0.02);

  for (let start = 0; start < buffer.length; start += windowSize) {
    const end = Math.min(buffer.length, start + windowSize);
    let peak = 0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = start; i < end; i += 1) {
        peak = Math.max(peak, Math.abs(data[i]));
      }
    }

    if (peak >= silenceThreshold) {
      return Math.max(0, start - prerollFrames) / buffer.sampleRate;
    }
  }

  return 0;
}

function trimLeadingSilence(
  context: AudioContext,
  buffer: AudioBuffer,
  silenceThreshold = VOICE_SILENCE_THRESHOLD,
) {
  const offsetFrames = Math.floor(
    leadingSoundOffset(buffer, silenceThreshold) * buffer.sampleRate,
  );
  if (offsetFrames <= 0) return buffer;

  const length = Math.max(1, buffer.length - offsetFrames);
  const trimmed = context.createBuffer(
    buffer.numberOfChannels,
    length,
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    trimmed.copyToChannel(input.subarray(offsetFrames), channel);
  }

  return trimmed;
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
      voice.nodes.forEach((node) => node.disconnect());
    });
    activeVoices.current = [];
    activeSoundtrackLayers.current.clear();
  }, []);

  const fadeAndStopActiveVoices = useCallback(async (seconds = SECTION_CUE_FADE_SECONDS) => {
    const audioContext = context.current;
    if (!audioContext) {
      stopAll();
      return;
    }

    const now = audioContext.currentTime;
    const firstStageEnd = now + seconds * 0.78;
    const stopAt = audioContext.currentTime + seconds;
    const voicesToFade = [...activeVoices.current];
    activeVoices.current = activeVoices.current.filter(
      (voice) => !voicesToFade.includes(voice),
    );
    activeSoundtrackLayers.current.clear();

    voicesToFade.forEach((voice) => {
      voice.gains.forEach((gain) => {
        const currentGain = gain.gain.value;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(currentGain, now);
        gain.gain.linearRampToValueAtTime(Math.max(currentGain * 0.22, 0.0001), firstStageEnd);
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      });
      voice.sources.forEach((source) => {
        try {
          source.stop(stopAt);
        } catch {
          // Sources may already be stopped.
        }
      });
    });

    await wait(seconds);
    voicesToFade.forEach((voice) => {
      voice.nodes.forEach((node) => node.disconnect());
    });
  }, [stopAll]);

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
    const trimmed = trimLeadingSilence(audioContext, buffer, VOICE_SILENCE_THRESHOLD);
    const treated = cue.treatment.reverse
      ? reverseBuffer(audioContext, trimmed)
      : trimmed;
    decoded.current.set(key, treated);
    return treated;
  }, [ensureAudio]);

  const decodeSoundtrackLayer = useCallback(async (
    layer: NonNullable<CueTreatment["soundtrackLayer"]>,
  ) => {
    const key = `soundtrack:${layer}`;
    const existing = decoded.current.get(key);
    if (existing) return existing;

    const audioContext = await ensureAudio();
    const response = await fetch(soundtrackAssets[layer], { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `Missing rendered SC stem: ${soundtrackAssets[layer]}. No browser-rendered fallback will play.`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    const trimmed = trimLeadingSilence(audioContext, buffer, SOUNDTRACK_SILENCE_THRESHOLD);
    decoded.current.set(key, trimmed);
    return trimmed;
  }, [ensureAudio]);

  const startSoundtrackLayer = useCallback(async (cue: PerformerCue) => {
    const layer = cue.treatment.soundtrackLayer;
    if (!layer) return false;
    if (activeSoundtrackLayers.current.has(layer)) return true;

    const audioContext = await ensureAudio();
    const buffer = await decodeSoundtrackLayer(layer);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();

    source.buffer = buffer;
    source.loop = false;
    gain.gain.value = soundtrackGains[layer];
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start(audioContext.currentTime);

    activeSoundtrackLayers.current.add(layer);
    activeVoices.current.push({ sources: [source], nodes: [gain], gains: [gain] });
    return true;
  }, [decodeSoundtrackLayer, ensureAudio]);

  const playCue = useCallback(async (index: number) => {
    if (!data?.cues[index]) return;
    const cue = data.cues[index];
    const overlapFadeSeconds = cue.treatment.soundtrackLayer
      ? OVERLAP_FADE_SECONDS_BY_LAYER[cue.treatment.soundtrackLayer]
      : undefined;

    if (overlapFadeSeconds && activeVoices.current.length) {
      void fadeAndStopActiveVoices(overlapFadeSeconds);
    }

    if (cue.treatment.soundtrackLayer) {
      try {
        await startSoundtrackLayer(cue);
      } catch (soundtrackError) {
        setError(
          soundtrackError instanceof Error
            ? soundtrackError.message
            : "Could not play soundtrack layer.",
        );
      }
    }

    const audioContext = await ensureAudio();
    const playableAssignments = cue.assignments.filter(
      (assignment) => assignment.signedUrl,
    );
    if (!playableAssignments.length) return;

    const treatment: CueTreatment = cue.treatment ?? {};
    let latestVoiceEndSeconds = 0;

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
        const requestedLoopStart = treatment.loopStart ?? 0;
        const requestedLoopEnd = treatment.loopEnd ?? Math.min(buffer.duration, 3);
        const effectiveLoopStart = source.loop ? requestedLoopStart : 0;
        const effectiveLoopEnd = Math.min(
          buffer.duration,
          Math.max(requestedLoopEnd, effectiveLoopStart + 0.05),
        );
        const playbackOffset = Math.min(
          effectiveLoopStart,
          Math.max(0, effectiveLoopEnd - 0.05),
        );

        source.loopStart = playbackOffset;
        source.loopEnd = effectiveLoopEnd;
        source.playbackRate.value = treatment.playbackRate ?? 1;

        gain.gain.value =
          (treatment.gain ?? 0.65) * assignment.gain * loudnessGain(buffer);
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

        source.start(
          audioContext.currentTime + assignment.start_offset_seconds,
          source.loop ? playbackOffset : 0,
        );
        if (!source.loop) {
          const playbackRate = treatment.playbackRate ?? 1;
          latestVoiceEndSeconds = Math.max(
            latestVoiceEndSeconds,
            assignment.start_offset_seconds + (buffer.duration - playbackOffset) / playbackRate,
          );
        }
        activeVoices.current.push({
          sources: [source],
          nodes: [gain, filter, shaper, delay, delayGain, convolver, wetGain, dryGain],
          gains: [gain, delayGain, wetGain, dryGain],
        });
      }),
    );

    if (cue.order_index === FINAL_VOICE_CUE_INDEX && latestVoiceEndSeconds > 0) {
      window.setTimeout(() => {
        void fadeAndStopActiveVoices(FINAL_FADE_SECONDS);
      }, latestVoiceEndSeconds * 1000);
    }
  }, [data, decodeAssignment, ensureAudio, fadeAndStopActiveVoices, startSoundtrackLayer]);

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
          <strong>{cueNumberLabel(currentIndex)}</strong>
          <p>{currentCue ? cueDisplayName(currentCue) : "waiting"}</p>
          <small>
            {currentCue?.assignments
              .map((assignment) => assignment.fragmentText)
              .filter(Boolean)
              .join(" / ") ||
              (currentCue?.treatment.soundtrackLayer
                ? "Soundtrack plays even without an assigned voice."
                : "No voice assigned yet.")}
          </small>
        </div>
        <div className="cue-next">
          <span>Next</span>
          <strong>{nextCue ? cueNumberLabel(currentIndex + 1) : "end"}</strong>
          <p>{nextCue ? cueDisplayName(nextCue) : "no next cue"}</p>
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
              <span>{cueNumberLabel(index)}</span>
              <strong>{cueDisplayName(cue)}</strong>
              <em>
                {cue.assignments.length
                  ? `${cue.treatment.texture ?? "solo"} / ${cue.assignments.filter((assignment) => assignment.signedUrl).length} voices${cue.treatment.soundtrackLayer ? " + soundtrack" : ""}`
                  : cue.treatment.soundtrackLayer
                    ? "soundtrack cue"
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
