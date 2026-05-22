import type { SupabaseClient } from "@supabase/supabase-js";
import type { CueTreatment } from "@/lib/types";

type DefaultCue = {
  label: string;
  order_index: number;
  treatment: CueTreatment;
};

export const defaultCues: DefaultCue[] = [
  {
    label: "bar 10",
    order_index: 1,
    treatment: {
      name: "single witness",
      texture: "solo",
      voiceCount: 1,
      gain: 0.72,
      loopStart: 0,
      loopEnd: 2.6,
      filterType: "lowpass",
      filterFrequency: 2600,
      distortion: 0.04,
      reverb: 0.05,
      playbackRate: 1,
    },
  },
  {
    label: "bar 12",
    order_index: 2,
    treatment: {
      name: "three-line handoff",
      texture: "sequence",
      voiceCount: 3,
      staggerSeconds: 1.6,
      gain: 0.74,
      loopStart: 0,
      loopEnd: 2.8,
      filterType: "bandpass",
      filterFrequency: 1450,
      distortion: 0.18,
      delay: 0.04,
      reverb: 0.12,
      playbackRate: 1.03,
    },
  },
  {
    label: "bar 18",
    order_index: 3,
    treatment: {
      name: "room of almost words",
      texture: "cacophony",
      voiceCount: 7,
      staggerSeconds: 0.32,
      gain: 0.42,
      loopStart: 0,
      loopEnd: 4.2,
      filterType: "highpass",
      filterFrequency: 420,
      distortion: 0.09,
      reverb: 0.68,
      playbackRate: 0.82,
      reverse: true,
    },
  },
  {
    label: "bar 24",
    order_index: 4,
    treatment: {
      name: "stuttered pulse",
      texture: "solo",
      voiceCount: 1,
      gain: 0.6,
      loopStart: 0.25,
      loopEnd: 1.15,
      filterType: "bandpass",
      filterFrequency: 880,
      distortion: 0.22,
      delay: 0.18,
      reverb: 0.2,
      playbackRate: 1.18,
    },
  },
  {
    label: "bar 31",
    order_index: 5,
    treatment: {
      name: "almost intelligible braid",
      texture: "sequence",
      voiceCount: 5,
      staggerSeconds: 1.1,
      gain: 0.62,
      loopStart: 0,
      loopEnd: 3.3,
      filterType: "lowpass",
      filterFrequency: 1900,
      distortion: 0.12,
      reverb: 0.34,
      playbackRate: 0.94,
    },
  },
  {
    label: "bar 38",
    order_index: 6,
    treatment: {
      name: "public cloud",
      texture: "cacophony",
      voiceCount: 11,
      staggerSeconds: 0.18,
      gain: 0.34,
      loopStart: 0,
      loopEnd: 3.8,
      filterType: "bandpass",
      filterFrequency: 1200,
      distortion: 0.2,
      delay: 0.11,
      reverb: 0.55,
      playbackRate: 1.08,
    },
  },
  {
    label: "bar 44",
    order_index: 7,
    treatment: {
      name: "one clear return",
      texture: "solo",
      voiceCount: 1,
      gain: 0.8,
      loopStart: 0,
      loopEnd: 3,
      filterType: "lowpass",
      filterFrequency: 3200,
      distortion: 0.02,
      reverb: 0.1,
      playbackRate: 1,
    },
  },
  {
    label: "bar 52",
    order_index: 8,
    treatment: {
      name: "supercollider bed cue",
      texture: "soundtrack",
      voiceCount: 0,
      gain: 0,
      reverb: 0,
    },
  },
];

export async function ensureDefaultCues(
  supabase: SupabaseClient,
  performanceId: string,
) {
  const { data: existing, error: existingError } = await supabase
    .from("cues")
    .select("order_index")
    .eq("performance_id", performanceId);

  if (existingError) {
    throw new Error(`Could not inspect cues: ${existingError.message}`);
  }

  const existingIndexes = new Set(
    (existing ?? []).map((cue) => Number(cue.order_index)),
  );
  const missingCues = defaultCues.filter(
    (cue) => !existingIndexes.has(cue.order_index),
  );

  if (!missingCues.length) return;

  const rows = missingCues.map((cue) => ({
    performance_id: performanceId,
    label: cue.label,
    order_index: cue.order_index,
    treatment: cue.treatment,
  }));

  const { error } = await supabase
    .from("cues")
    .upsert(rows, { onConflict: "performance_id,order_index" });

  if (error) throw new Error(`Could not ensure default cues: ${error.message}`);
}
