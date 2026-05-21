import { NextRequest, NextResponse } from "next/server";
import { activeSlug, assertAdmin, getSupabaseAdmin } from "@/lib/supabase-server";
import type { Cue, CueAssignment, PerformerCue, Submission } from "@/lib/types";

type JoinedSubmission = Submission & {
  fragments?: { text: string } | null;
};

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

    const [{ data: cues, error: cuesError }, { data: assignments, error: assignmentsError }] =
      await Promise.all([
        supabase
          .from("cues")
          .select("*")
          .eq("performance_id", performance.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("cue_assignments")
          .select("*, submissions(*, fragments(text))")
          .eq("performance_id", performance.id)
          .order("assignment_index", { ascending: true }),
      ]);

    if (cuesError || assignmentsError) {
      return NextResponse.json(
        { error: "Could not load performer cues." },
        { status: 500 },
      );
    }

    const assignmentsByCue = new Map(
      (assignments ?? []).map((assignment) => [
        assignment.cue_id,
        assignment as CueAssignment & { submissions: JoinedSubmission | null },
      ]),
    );

    const performerCues: PerformerCue[] = await Promise.all(
      ((cues ?? []) as Cue[]).map(async (cue) => {
        const assignment = assignmentsByCue.get(cue.id) ?? null;
        const submission = assignment?.submissions ?? null;
        let signedUrl: string | null = null;

        if (submission?.storage_path) {
          const signed = await supabase.storage
            .from("whispers")
            .createSignedUrl(submission.storage_path, 60 * 60 * 4);
          signedUrl = signed.data?.signedUrl ?? null;
        }

        return {
          ...cue,
          assignment: assignment
            ? {
                id: assignment.id,
                performance_id: assignment.performance_id,
                cue_id: assignment.cue_id,
                submission_id: assignment.submission_id,
                assignment_index: assignment.assignment_index,
              }
            : null,
          submission,
          signedUrl,
          fragmentText: submission?.fragments?.text ?? null,
        };
      }),
    );

    return NextResponse.json({ performance, cues: performerCues });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
