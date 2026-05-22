import { NextRequest, NextResponse } from "next/server";
import { ensureDefaultCues } from "@/lib/default-cues";
import { makeSeed, seededShuffle } from "@/lib/random";
import { activeSlug, assertAdmin, getSupabaseAdmin } from "@/lib/supabase-server";
import type { Cue, CueTexture, Submission } from "@/lib/types";

type AssignmentRow = {
  performance_id: string;
  cue_id: string;
  submission_id: string | null;
  assignment_index: number;
  start_offset_seconds: number;
  gain: number;
};

function defaultVoiceCount(texture: CueTexture | undefined) {
  if (texture === "sequence") return 4;
  if (texture === "cacophony") return 7;
  if (texture === "soundtrack") return 0;
  return 1;
}

function startOffset(texture: CueTexture | undefined, index: number, stagger = 0.42) {
  if (texture === "sequence") return index * Math.max(0.15, stagger);
  if (texture === "cacophony") return index * Math.max(0.05, stagger);
  return 0;
}

function voiceGain(texture: CueTexture | undefined, index: number) {
  if (texture === "cacophony") return Math.max(0.18, 0.58 - index * 0.035);
  if (texture === "sequence") return 0.78;
  return 1;
}

export async function POST(request: NextRequest) {
  try {
    const { passcode } = await request.json();
    assertAdmin(passcode);

    const supabase = getSupabaseAdmin();
    const { data: performance, error: performanceError } = await supabase
      .from("performances")
      .select("*")
      .eq("slug", activeSlug())
      .single();

    if (performanceError || !performance) {
      return NextResponse.json(
        { error: "Performance not found." },
        { status: 404 },
      );
    }

    await ensureDefaultCues(supabase, performance.id);

    const [{ data: cues, error: cuesError }, { data: submissions, error: submissionsError }] =
      await Promise.all([
        supabase
          .from("cues")
          .select("*")
          .eq("performance_id", performance.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("submissions")
          .select("*")
          .eq("performance_id", performance.id)
          .eq("moderation_status", "approved")
          .order("created_at", { ascending: true }),
      ]);

    if (cuesError || submissionsError || !cues?.length) {
      return NextResponse.json(
        { error: "Could not load cues or submissions." },
        { status: 500 },
      );
    }

    const seed = makeSeed();
    const shuffled = seededShuffle(submissions as Submission[], seed);
    let cursor = 0;

    await supabase
      .from("cue_assignments")
      .delete()
      .eq("performance_id", performance.id);

    const assignmentRows = (cues as Cue[]).flatMap<AssignmentRow>((cue, cueIndex) => {
      const texture = cue.treatment.texture;
      const count = Math.min(
        shuffled.length,
        Math.max(0, cue.treatment.voiceCount ?? defaultVoiceCount(texture)),
      );

      if (!count) {
        return [
          {
            performance_id: performance.id,
            cue_id: cue.id,
            submission_id: null,
            assignment_index: cueIndex * 100,
            start_offset_seconds: 0,
            gain: 1,
          },
        ];
      }

      return Array.from({ length: count }, (_, voiceIndex) => {
        const submission = shuffled[(cursor + voiceIndex) % shuffled.length];
        return {
          performance_id: performance.id,
          cue_id: cue.id,
          submission_id: submission.id,
          assignment_index: cueIndex * 100 + voiceIndex,
          start_offset_seconds: startOffset(
            texture,
            voiceIndex,
            cue.treatment.staggerSeconds,
          ),
          gain: voiceGain(texture, voiceIndex),
        };
      }).map((row, index, rows) => {
        if (index === rows.length - 1) cursor = (cursor + rows.length) % shuffled.length;
        return row;
      });
    });

    const { error: insertError } = await supabase
      .from("cue_assignments")
      .insert(assignmentRows);

    if (insertError) {
      return NextResponse.json(
        { error: "Could not save cue assignments." },
        { status: 500 },
      );
    }

    const { data: updatedPerformance, error: updateError } = await supabase
      .from("performances")
      .update({
        status: "closed",
        seed,
        closed_at: new Date().toISOString(),
      })
      .eq("id", performance.id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Could not close performance." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      performance: updatedPerformance,
      assignmentCount: assignmentRows.length,
      approvedSubmissionCount: shuffled.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
