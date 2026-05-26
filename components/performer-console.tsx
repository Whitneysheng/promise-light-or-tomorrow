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
import type { CueTreatment, PerformerCue, PerformerVoice } from "@/lib/types";

type PerformerData = {
  performance: {
    title: string;
    status: string;
    seed: string | null;
  };
  cues: PerformerCue[];
  voicePool: PerformerVoice[];
};

type ActiveVoice = {
  kind: "soundtrack" | "voice";
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  gains: GainNode[];
  levelGain?: GainNode;
  baseLevel?: number;
};

type VoiceProfile = "distant" | "static" | "swarm" | "mechanical" | "underwater" | "plain";
type VoiceProfileParams = {
  gain: number;
  filterType: BiquadFilterType;
  filterFrequency: number;
  distortion: number;
  reverb: number;
  delay: number;
  playbackRate: number;
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
const MAX_ACTIVE_VOICE_GRAINS = 64;
const CUE_ONE_REPEAT_SECONDS = 2;
const CUE_ONE_FIRST_ENTRY_SECONDS = 2;
const CUE_ONE_VOICE_FADE_SECONDS = 3.5;

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
  lowDoubleBass: 0.58,
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

function cueHasLiveVoiceBehavior(cue: PerformerCue | null | undefined) {
  return cue ? [1, 4, 5, 7, 8, 9, 10].includes(cue.order_index) : false;
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

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function voiceProfileParams(profile: VoiceProfile, clarity = 0): VoiceProfileParams {
  const clearAmount = Math.max(0, Math.min(1, clarity));

  if (profile === "distant") {
    return {
      gain: 0.28 + clearAmount * 0.24,
      filterType: "lowpass" as BiquadFilterType,
      filterFrequency: randomBetween(1200 + clearAmount * 1800, 2200 + clearAmount * 2600),
      distortion: 0.01,
      reverb: 0.72 - clearAmount * 0.48,
      delay: randomBetween(0.08, 0.14) * (1 - clearAmount * 0.75),
      playbackRate: randomBetween(0.94, 1.03),
    };
  }
  if (profile === "static") {
    return {
      gain: 0.62,
      filterType: "bandpass" as BiquadFilterType,
      filterFrequency: randomBetween(700, 2400),
      distortion: 0.22,
      reverb: 0.08,
      delay: 0,
      playbackRate: randomBetween(0.96, 1.04),
    };
  }
  if (profile === "mechanical") {
    return {
      gain: 0.32,
      filterType: "bandpass" as BiquadFilterType,
      filterFrequency: randomBetween(900, 3600),
      distortion: randomBetween(0.18, 0.34),
      reverb: 0.18,
      delay: randomBetween(0.018, 0.06),
      playbackRate: randomBetween(0.72, 1.28),
    };
  }
  if (profile === "underwater") {
    return {
      gain: 0.54,
      filterType: "lowpass" as BiquadFilterType,
      filterFrequency: randomBetween(420, 900),
      distortion: 0.015,
      reverb: 0.64,
      delay: randomBetween(0.05, 0.16),
      playbackRate: randomBetween(0.86, 0.98),
    };
  }
  if (profile === "swarm") {
    return {
      gain: 0.2,
      filterType: "lowpass" as BiquadFilterType,
      filterFrequency: randomBetween(2800, 5600),
      distortion: 0,
      reverb: 0.08,
      delay: 0,
      playbackRate: randomBetween(0.92, 1.08),
    };
  }
  return {
    gain: 0.82,
    filterType: "lowpass" as BiquadFilterType,
    filterFrequency: 3200,
    distortion: 0.02,
    reverb: 0.08,
    delay: 0,
    playbackRate: 1,
  };
}

function swarmDensity(elapsedSeconds: number) {
  const cycleSeconds = 28;
  const cyclePosition = elapsedSeconds % cycleSeconds;

  if (cyclePosition < 4) return { interval: randomBetween(0.9, 1.25), maxActive: 6, levelScale: 0.9 };
  if (cyclePosition < 8) return { interval: 0.55, maxActive: 9, levelScale: 0.72 };
  if (cyclePosition < 12) return { interval: 0.3, maxActive: 12, levelScale: 0.56 };
  if (cyclePosition < 14) return { interval: 0.18, maxActive: 14, levelScale: 0.42 };
  if (cyclePosition < 18) return { interval: 0.3, maxActive: 10, levelScale: 0.3 };
  if (cyclePosition < 22) return { interval: 0.55, maxActive: 7, levelScale: 0.22 };
  return { interval: randomBetween(0.9, 1.25), maxActive: 5, levelScale: 0.16 };
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
  const voiceTimers = useRef<number[]>([]);
  const voiceRunId = useRef(0);
  const voicePoolCursor = useRef(0);
  const voicePoolOrder = useRef<number[]>([]);

  const clearVoiceTimers = useCallback(() => {
    voiceTimers.current.forEach((timer) => window.clearTimeout(timer));
    voiceTimers.current = [];
  }, []);

  const stopActiveVoices = useCallback((voices: ActiveVoice[]) => {
    voices.forEach((voice) => {
      voice.sources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Sources may already be stopped.
        }
      });
      voice.nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Nodes may already be disconnected by an earlier cue change.
        }
      });
    });
  }, []);

  const stopAll = useCallback(() => {
    clearVoiceTimers();
    voiceRunId.current += 1;
    stopActiveVoices(activeVoices.current);
    activeVoices.current = [];
    activeSoundtrackLayers.current.clear();
  }, [clearVoiceTimers, stopActiveVoices]);

  const fadeAndStopActiveVoices = useCallback(async (
    seconds = SECTION_CUE_FADE_SECONDS,
    kind?: ActiveVoice["kind"],
  ) => {
    const audioContext = context.current;
    if (!audioContext) {
      stopAll();
      return;
    }

    const now = audioContext.currentTime;
    const firstStageEnd = now + seconds * 0.78;
    const stopAt = audioContext.currentTime + seconds;
    const voicesToFade = activeVoices.current.filter((voice) => !kind || voice.kind === kind);
    activeVoices.current = activeVoices.current.filter(
      (voice) => !voicesToFade.includes(voice),
    );
    if (!kind || kind === "soundtrack") activeSoundtrackLayers.current.clear();

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
      voice.nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Nodes may already be disconnected by an earlier cue change.
        }
      });
    });
  }, [stopAll]);

  const stopVoiceBehavior = useCallback((fadeSeconds = 0) => {
    clearVoiceTimers();
    voiceRunId.current += 1;
    if (fadeSeconds > 0) {
      void fadeAndStopActiveVoices(fadeSeconds, "voice");
      return;
    }
    stopActiveVoices(activeVoices.current.filter((voice) => voice.kind === "voice"));
    activeVoices.current = activeVoices.current.filter((voice) => voice.kind !== "voice");
  }, [clearVoiceTimers, fadeAndStopActiveVoices, stopActiveVoices]);

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

  const decodePooledVoice = useCallback(async (voice: PerformerVoice) => {
    const key = `voice:${voice.id}`;
    const existing = decoded.current.get(key);
    if (existing) return existing;

    const audioContext = await ensureAudio();
    const response = await fetch(voice.signedUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(arrayBuffer);
    const trimmed = trimLeadingSilence(audioContext, buffer, VOICE_SILENCE_THRESHOLD);
    decoded.current.set(key, trimmed);
    return trimmed;
  }, [ensureAudio]);

  const nextPooledVoice = useCallback(() => {
    const pool = data?.voicePool?.filter((voice) => voice.signedUrl) ?? [];
    if (!pool.length) return null;

    if (voicePoolOrder.current.length !== pool.length) {
      voicePoolOrder.current = pool.map((_, index) => index).sort(() => Math.random() - 0.5);
      voicePoolCursor.current = 0;
    }

    if (voicePoolCursor.current >= voicePoolOrder.current.length) {
      voicePoolOrder.current = pool.map((_, index) => index).sort(() => Math.random() - 0.5);
      voicePoolCursor.current = 0;
    }

    const index = voicePoolOrder.current[voicePoolCursor.current] ?? 0;
    voicePoolCursor.current += 1;
    return pool[index] ?? pool[0];
  }, [data]);

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
    activeVoices.current.push({ kind: "soundtrack", sources: [source], nodes: [gain], gains: [gain] });
    return true;
  }, [decodeSoundtrackLayer, ensureAudio]);

  const pruneVoiceGrains = useCallback((maxActive = MAX_ACTIVE_VOICE_GRAINS) => {
    const voiceNodes = activeVoices.current.filter((voice) => voice.kind === "voice");
    const overflow = voiceNodes.length - maxActive + 1;
    if (overflow <= 0) return;

    const audioContext = context.current;
    const stopAt = (audioContext?.currentTime ?? 0) + 0.08;
    voiceNodes.slice(0, overflow).forEach((voice) => {
      if (audioContext) {
        voice.gains.forEach((gain) => {
          gain.gain.cancelScheduledValues(audioContext.currentTime);
          gain.gain.setValueAtTime(gain.gain.value, audioContext.currentTime);
          gain.gain.linearRampToValueAtTime(0.0001, stopAt);
        });
      }
      voice.sources.forEach((source) => {
        try {
          audioContext ? source.stop(stopAt) : source.stop();
        } catch {
          // Sources may already be stopped.
        }
      });
      window.setTimeout(() => {
        voice.nodes.forEach((node) => {
          try {
            node.disconnect();
          } catch {
            // Nodes may already be disconnected by an earlier cue change.
          }
        });
      }, 120);
    });
    activeVoices.current = activeVoices.current.filter((voice) => !voiceNodes.slice(0, overflow).includes(voice));
  }, []);

  const playPooledVoice = useCallback(async ({
    profile,
    maxDuration,
    maxActive,
    startDelay = 0,
    clarity = 0,
    attenuateExisting = false,
    levelScale = 1,
  }: {
    profile: VoiceProfile;
    maxDuration?: number;
    maxActive?: number;
    startDelay?: number;
    clarity?: number;
    attenuateExisting?: boolean;
    levelScale?: number;
  }) => {
    const voice = nextPooledVoice();
    if (!voice) return 0;

    const audioContext = await ensureAudio();
    const buffer = await decodePooledVoice(voice);
    const params = voiceProfileParams(profile, clarity);
    const sliceDuration = Math.min(maxDuration ?? buffer.duration, buffer.duration);
    const startOffset = maxDuration && buffer.duration > sliceDuration + 0.05
      ? randomBetween(0, buffer.duration - sliceDuration)
      : 0;

    if (attenuateExisting && maxActive) {
      const voiceNodes = activeVoices.current.filter((active) => active.kind === "voice");
      const pressure = Math.max(1, voiceNodes.length + 1);
      const targetScale = Math.min(0.82, Math.max(0.08, Math.sqrt(maxActive / pressure) * levelScale));
      voiceNodes.forEach((active, index) => {
        if (!active.levelGain || !active.baseLevel) return;
        const ageScale = Math.max(0.12, Math.pow(0.86, voiceNodes.length - index));
        const targetGain = active.baseLevel * targetScale * ageScale;
        active.levelGain.gain.cancelScheduledValues(audioContext.currentTime);
        active.levelGain.gain.setTargetAtTime(targetGain, audioContext.currentTime, 0.45);
      });
    } else if (maxActive) {
      pruneVoiceGrains(maxActive);
    }

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const shaper = params.distortion > 0.005 ? audioContext.createWaveShaper() : null;
    const delay = audioContext.createDelay(1);
    const delayGain = audioContext.createGain();
    const convolver = audioContext.createConvolver();
    const wetGain = audioContext.createGain();
    const dryGain = audioContext.createGain();
    const now = audioContext.currentTime + startDelay;
    const duration = Math.max(0.025, sliceDuration / params.playbackRate);
    const rawVoiceGain = params.gain * loudnessGain(buffer);
    const voiceGain = rawVoiceGain * levelScale;
    const attackEnd = now + Math.min(0.015, duration * 0.35);
    const releaseStart = now + Math.max(
      Math.min(0.02, duration * 0.5),
      duration - Math.min(0.035, duration * 0.45),
    );

    source.buffer = buffer;
    source.loop = false;
    source.playbackRate.value = params.playbackRate;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(voiceGain, attackEnd);
    gain.gain.setValueAtTime(voiceGain, releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    filter.type = params.filterType;
    filter.frequency.value = params.filterFrequency;
    if (shaper) {
      shaper.curve = distortionCurve(params.distortion);
      shaper.oversample = "2x";
    }
    delay.delayTime.value = params.delay;
    delayGain.gain.value = params.delay ? 0.18 : 0;
    convolver.buffer = impulse(audioContext, profile === "distant" || profile === "underwater" ? 2.4 : 1.2);
    wetGain.gain.value = params.reverb;
    dryGain.gain.value = 1 - Math.min(params.reverb, 0.72);

    if (shaper) {
      source.connect(shaper);
      shaper.connect(filter);
    } else {
      source.connect(filter);
    }
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

    source.start(now, startOffset, sliceDuration);
    try {
      source.stop(now + duration + 0.02);
    } catch {
      // Source may already be stopped by a cue change.
    }

    activeVoices.current.push({
      kind: "voice",
      sources: [source],
      nodes: [gain, filter, delay, delayGain, convolver, wetGain, dryGain, ...(shaper ? [shaper] : [])],
      gains: [gain],
      levelGain: gain,
      baseLevel: rawVoiceGain,
    });

    window.setTimeout(() => {
      activeVoices.current = activeVoices.current.filter((active) => active.sources[0] !== source);
      [gain, filter, delay, delayGain, convolver, wetGain, dryGain, ...(shaper ? [shaper] : [])].forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Nodes may already be disconnected by an earlier cue change.
        }
      });
    }, (startDelay + duration + 0.2) * 1000);

    return duration;
  }, [decodePooledVoice, ensureAudio, nextPooledVoice, pruneVoiceGrains]);

  const scheduleVoiceTimer = useCallback((callback: () => void, seconds: number) => {
    const timer = window.setTimeout(callback, seconds * 1000);
    voiceTimers.current.push(timer);
    return timer;
  }, []);

  const startVoiceBehavior = useCallback((cue: PerformerCue) => {
    const runId = voiceRunId.current;
    const isCurrentRun = () => runId === voiceRunId.current;

    if (cue.order_index === 1) {
      const startedAt = performance.now();
      const playNext = () => {
        if (!isCurrentRun()) return;
        const elapsed = (performance.now() - startedAt) / 1000;
        void playPooledVoice({
          profile: "distant",
          maxDuration: 2.8,
          maxActive: 8,
          clarity: Math.min(0.9, elapsed / 30),
        });
        scheduleVoiceTimer(playNext, CUE_ONE_REPEAT_SECONDS);
      };
      scheduleVoiceTimer(playNext, CUE_ONE_FIRST_ENTRY_SECONDS);
      return true;
    }

    if (cue.order_index === 4) {
      void playPooledVoice({ profile: "static", maxDuration: 3.5, maxActive: 8 });
      return true;
    }

    if (cue.order_index === 6) return true;

    if (cue.order_index === 5 || cue.order_index === 7) {
      const startedAt = performance.now();
      const playNext = () => {
        if (!isCurrentRun()) return;
        const elapsed = (performance.now() - startedAt) / 1000;
        const density = swarmDensity(elapsed);
        void playPooledVoice({
          profile: "swarm",
          maxActive: Math.min(MAX_ACTIVE_VOICE_GRAINS, density.maxActive),
          attenuateExisting: true,
          levelScale: density.levelScale,
        });
        scheduleVoiceTimer(playNext, density.interval);
      };
      playNext();
      return true;
    }

    if (cue.order_index === 8) {
      const playNext = () => {
        if (!isCurrentRun()) return;
        void playPooledVoice({
          profile: "mechanical",
          maxDuration: randomBetween(0.08, 0.28),
          maxActive: 24,
        });
        scheduleVoiceTimer(playNext, randomBetween(0.08, 0.34));
      };
      playNext();
      return true;
    }

    if (cue.order_index === 9) {
      const playNext = () => {
        if (!isCurrentRun()) return;
        void (async () => {
          const duration = await playPooledVoice({
            profile: "underwater",
            maxDuration: randomBetween(2.4, 5.5),
            maxActive: 12,
          });
          if (isCurrentRun()) scheduleVoiceTimer(playNext, Math.max(1.2, duration + randomBetween(0.25, 0.8)));
        })();
      };
      playNext();
      return true;
    }

    if (cue.order_index === FINAL_VOICE_CUE_INDEX) {
      void (async () => {
        const duration = await playPooledVoice({ profile: "plain", maxDuration: 8, maxActive: 4 });
        if (!isCurrentRun() || duration <= 0) return;
        scheduleVoiceTimer(() => {
          if (isCurrentRun()) void fadeAndStopActiveVoices(FINAL_FADE_SECONDS);
        }, duration);
      })();
      return true;
    }

    return false;
  }, [fadeAndStopActiveVoices, playPooledVoice, scheduleVoiceTimer]);

  const playCue = useCallback(async (index: number) => {
    if (!data?.cues[index]) return;
    const cue = data.cues[index];
    const previousCue = currentIndex >= 0 ? data.cues[currentIndex] : null;
    const voiceFadeSeconds = previousCue?.order_index === 1 && cue.order_index === 2
      ? CUE_ONE_VOICE_FADE_SECONDS
      : SECTION_CUE_FADE_SECONDS;
    stopVoiceBehavior(voiceFadeSeconds);
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

    if (startVoiceBehavior(cue)) return;

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
          kind: "voice",
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
  }, [
    currentIndex,
    data,
    decodeAssignment,
    ensureAudio,
    fadeAndStopActiveVoices,
    startSoundtrackLayer,
    startVoiceBehavior,
    stopVoiceBehavior,
  ]);

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
  const liveVoiceCount = data?.voicePool?.length ?? 0;
  const liveVoiceStatus = data
    ? liveVoiceCount
      ? `${liveVoiceCount} approved recording${liveVoiceCount === 1 ? "" : "s"} loaded`
      : "No approved recordings loaded"
    : "Load cues to check recordings";

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
          <span className={liveVoiceCount ? "status-dot ready" : "status-dot"} />
          {liveVoiceStatus}
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
              (cueHasLiveVoiceBehavior(currentCue)
                ? `${currentCue?.treatment.soundtrackLayer ? "Soundtrack + " : ""}Live voice pool: ${liveVoiceStatus}.`
                : currentCue?.treatment.soundtrackLayer
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
                  : cueHasLiveVoiceBehavior(cue)
                    ? `${cue.treatment.soundtrackLayer ? "soundtrack + " : ""}live voice pool / ${liveVoiceCount} loaded`
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
