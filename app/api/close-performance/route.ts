import { NextRequest, NextResponse } from "next/server";
import { makeSeed, seededShuffle } from "@/lib/random";
import { activeSlug, assertAdmin, getSupabaseAdmin } from "@/lib/supabase-server";
import type { Cue, Submission } from "@/lib/types";

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

    await supabase
      .from("cue_assignments")
      .delete()
      .eq("performance_id", performance.id);

    const assignmentRows = (cues as Cue[]).map((cue, index) => ({
      performance_id: performance.id,
      cue_id: cue.id,
      submission_id: shuffled.length
        ? shuffled[index % shuffled.length].id
        : null,
      assignment_index: index + 1,
    }));

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
      submissionCount: shuffled.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
