import { NextRequest, NextResponse } from "next/server";
import { activeSlug, assertAdmin, getSupabaseAdmin } from "@/lib/supabase-server";
import type { Cue, CueAssignment, PerformerCue, Submission } from "@/lib/types";

type JoinedSubmission = Submission & {
  fragments?: { text: string } | null;
};

function soundtrackCues(performanceId: string): PerformerCue[] {
  return [
    {
      id: "soundtrack-wind-eflat",
      performance_id: performanceId,
      label: "Soundtrack 1",
      order_index: -30,
      treatment: {
        name: "wind + E-flat",
        texture: "soundtrack",
        soundtrackLayer: "windEflat",
      },
      assignments: [],
    },
    {
      id: "soundtrack-d-natural",
      performance_id: performanceId,
      label: "Soundtrack 2",
      order_index: -20,
      treatment: {
        name: "add D natural",
        texture: "soundtrack",
        soundtrackLayer: "dNatural",
      },
      assignments: [],
    },
    {
      id: "soundtrack-bflat-bnatural",
      performance_id: performanceId,
      label: "Soundtrack 3",
      order_index: -10,
      treatment: {
        name: "add B-flat, then B natural",
        texture: "soundtrack",
        soundtrackLayer: "bflatBnatural",
      },
      assignments: [],
    },
  ];
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

    const assignmentsByCue = new Map<
      string,
      Array<CueAssignment & { submissions: JoinedSubmission | null }>
    >();

    (assignments ?? []).forEach((assignment) => {
      const joined = assignment as CueAssignment & {
        submissions: JoinedSubmission | null;
      };
      const cueAssignments = assignmentsByCue.get(joined.cue_id) ?? [];
      cueAssignments.push(joined);
      assignmentsByCue.set(joined.cue_id, cueAssignments);
    });

    const performerCues: PerformerCue[] = await Promise.all(
      ((cues ?? []) as Cue[]).map(async (cue) => {
        const cueAssignments = assignmentsByCue.get(cue.id) ?? [];
        const performerAssignments = await Promise.all(
          cueAssignments.map(async (assignment) => {
            const submission = assignment.submissions ?? null;
            let signedUrl: string | null = null;

            if (submission?.storage_path) {
              const signed = await supabase.storage
                .from("whispers")
                .createSignedUrl(submission.storage_path, 60 * 60 * 4);
              signedUrl = signed.data?.signedUrl ?? null;
            }

            return {
              id: assignment.id,
              performance_id: assignment.performance_id,
              cue_id: assignment.cue_id,
              submission_id: assignment.submission_id,
              assignment_index: assignment.assignment_index,
              start_offset_seconds: assignment.start_offset_seconds,
              gain: assignment.gain,
              submission,
              signedUrl,
              fragmentText: submission?.fragments?.text ?? null,
            };
          }),
        );

        return {
          ...cue,
          assignments: performerAssignments,
        };
      }),
    );

    return NextResponse.json({
      performance,
      cues: [...soundtrackCues(performance.id), ...performerCues],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
