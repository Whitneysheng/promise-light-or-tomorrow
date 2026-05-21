import { NextRequest, NextResponse } from "next/server";
import { activeSlug, assertAdmin, getSupabaseAdmin } from "@/lib/supabase-server";
import type { Submission } from "@/lib/types";

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

    const { data: submissions, error: submissionsError } = await supabase
      .from("submissions")
      .select("*")
      .eq("performance_id", performance.id);

    if (submissionsError) {
      return NextResponse.json(
        { error: `Could not load submissions: ${submissionsError.message}` },
        { status: 500 },
      );
    }

    const storagePaths = ((submissions ?? []) as Submission[])
      .map((submission) => submission.storage_path)
      .filter(Boolean);

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("whispers")
        .remove(storagePaths);

      if (storageError) {
        return NextResponse.json(
          { error: `Could not delete recordings: ${storageError.message}` },
          { status: 500 },
        );
      }
    }

    const { error: assignmentsError } = await supabase
      .from("cue_assignments")
      .delete()
      .eq("performance_id", performance.id);

    if (assignmentsError) {
      return NextResponse.json(
        { error: `Could not clear cue map: ${assignmentsError.message}` },
        { status: 500 },
      );
    }

    const { error: deleteSubmissionsError } = await supabase
      .from("submissions")
      .delete()
      .eq("performance_id", performance.id);

    if (deleteSubmissionsError) {
      return NextResponse.json(
        {
          error: `Could not delete submissions: ${deleteSubmissionsError.message}`,
        },
        { status: 500 },
      );
    }

    const { data: updatedPerformance, error: updateError } = await supabase
      .from("performances")
      .update({
        status: "open",
        seed: null,
        closed_at: null,
      })
      .eq("id", performance.id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: `Could not reopen performance: ${updateError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      performance: updatedPerformance,
      deletedRecordings: storagePaths.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
