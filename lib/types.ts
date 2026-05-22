export type PerformanceStatus = "open" | "closed" | "performed";

export type Performance = {
  id: string;
  title: string;
  slug: string;
  status: PerformanceStatus;
  seed: string | null;
  created_at: string;
  closed_at: string | null;
};

export type Fragment = {
  id: string;
  performance_id: string;
  text: string;
  display_order: number;
};

export type Submission = {
  id: string;
  performance_id: string;
  fragment_id: string;
  storage_path: string;
  duration_seconds: number | null;
  created_at: string;
  consent_confirmed: boolean;
  transcript: string | null;
  text_match_score: number | null;
  processing_notes: string | null;
  moderation_status: "pending" | "approved" | "rejected";
  moderation_flags: string[];
  moderation_notes: string | null;
};

export type CueTexture = "solo" | "sequence" | "cacophony" | "soundtrack";

export type CueTreatment = {
  name?: string;
  texture?: CueTexture;
  soundtrackLayer?: "windEflat" | "dNatural" | "bflatBnatural" | "windChimes" | "oceanWaves" | "lowDoubleBass";
  voiceCount?: number;
  staggerSeconds?: number;
  gain?: number;
  loopStart?: number;
  loopEnd?: number;
  filterType?: BiquadFilterType;
  filterFrequency?: number;
  distortion?: number;
  delay?: number;
  reverb?: number;
  playbackRate?: number;
  reverse?: boolean;
};

export type Cue = {
  id: string;
  performance_id: string;
  label: string;
  order_index: number;
  treatment: CueTreatment;
};

export type CueAssignment = {
  id: string;
  performance_id: string;
  cue_id: string;
  submission_id: string | null;
  assignment_index: number;
  start_offset_seconds: number;
  gain: number;
};

export type PerformerCue = Cue & {
  assignments: Array<
    CueAssignment & {
      submission: Submission | null;
      signedUrl: string | null;
      fragmentText: string | null;
    }
  >;
};
