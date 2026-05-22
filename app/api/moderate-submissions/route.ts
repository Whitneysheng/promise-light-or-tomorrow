import { NextRequest, NextResponse } from "next/server";
import { activeSlug, assertAdmin, getSupabaseAdmin } from "@/lib/supabase-server";
import type { Submission } from "@/lib/types";

const rejectFlags = new Set(["possible_mismatch", "possible_profanity"]);

function hasRejectFlag(submission: Submission) {
  return submission.moderation_flags?.some((flag) => rejectFlags.has(flag));
}

export async function POST(request: NextRequest) {
  try {
    const { passcode, action } = await request.json();
    assertAdmin(passcode);

    if (action !== "approve_clean_reject_flagged") {
      return NextResponse.json(
        { error: "Unsupported moderation action." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: performance, error: performanceError } = await supabase
      .from("performances")
      .select("id")
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
      .eq("performance_id", performance.id)
      .eq("moderation_status", "pending");

    if (submissionsError) {
      return NextResponse.json(
        { error: `Could not load submissions: ${submissionsError.message}` },
        { status: 500 },
      );
    }

    const pending = (submissions ?? []) as Submission[];
    const rejected = pending.filter(hasRejectFlag);
    const approved = pending.filter((submission) => !hasRejectFlag(submission));

    const rejectedIds = rejected.map((submission) => submission.id);
    const approvedIds = approved.map((submission) => submission.id);
    const rejectedPaths = rejected
      .map((submission) => submission.storage_path)
      .filter(Boolean);

    if (rejectedPaths.length) {
      const { error: storageError } = await supabase.storage
        .from("whispers")
        .remove(rejectedPaths);

      if (storageError) {
        return NextResponse.json(
          { error: `Could not delete rejected audio: ${storageError.message}` },
          { status: 500 },
        );
      }
    }

    if (rejectedIds.length) {
      const { error: deleteError } = await supabase
        .from("submissions")
        .delete()
        .in("id", rejectedIds);

      if (deleteError) {
        return NextResponse.json(
          { error: `Could not reject flagged submissions: ${deleteError.message}` },
          { status: 500 },
        );
      }
    }

    if (approvedIds.length) {
      const { error: approveError } = await supabase
        .from("submissions")
        .update({
          moderation_status: "approved",
          moderation_notes: "Approved by bulk review.",
        })
        .in("id", approvedIds);

      if (approveError) {
        return NextResponse.json(
          { error: `Could not approve clean submissions: ${approveError.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      approvedCount: approvedIds.length,
      rejectedCount: rejectedIds.length,
      pendingCount: pending.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
