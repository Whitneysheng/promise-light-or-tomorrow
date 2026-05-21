import { NextRequest, NextResponse } from "next/server";
import { activeSlug, assertAdmin, getSupabaseAdmin } from "@/lib/supabase-server";

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

    const [fragments, cues, submissions, assignments] = await Promise.all([
      supabase
        .from("fragments")
        .select("*")
        .eq("performance_id", performance.id)
        .order("display_order", { ascending: true }),
      supabase
        .from("cues")
        .select("*")
        .eq("performance_id", performance.id)
        .order("order_index", { ascending: true }),
      supabase
        .from("submissions")
        .select("*, fragments(text)")
        .eq("performance_id", performance.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("cue_assignments")
        .select("*, cues(label), submissions(id, fragments(text))")
        .eq("performance_id", performance.id)
        .order("assignment_index", { ascending: true }),
    ]);

    if (fragments.error || cues.error || submissions.error || assignments.error) {
      return NextResponse.json(
        { error: "Could not load admin data." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      performance,
      fragments: fragments.data,
      cues: cues.data,
      submissions: submissions.data,
      assignments: assignments.data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized." },
      { status: 401 },
    );
  }
}
