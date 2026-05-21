import { NextResponse } from "next/server";
import { demoFragments, demoModeEnabled, demoPerformance } from "@/lib/demo-data";
import { activeSlug, getSupabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  if (demoModeEnabled()) {
    return NextResponse.json({
      performance: demoPerformance,
      fragments: demoFragments,
      demoMode: true,
    });
  }

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

  const { data: fragments, error: fragmentsError } = await supabase
    .from("fragments")
    .select("*")
    .eq("performance_id", performance.id)
    .order("display_order", { ascending: true });

  if (fragmentsError) {
    return NextResponse.json(
      { error: "Could not load fragments." },
      { status: 500 },
    );
  }

  return NextResponse.json({ performance, fragments });
}
