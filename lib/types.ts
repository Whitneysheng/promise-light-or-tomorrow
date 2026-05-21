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
};

export type CueTreatment = {
  name?: string;
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
};

export type PerformerCue = Cue & {
  assignment: CueAssignment | null;
  submission: Submission | null;
  signedUrl: string | null;
  fragmentText: string | null;
};
