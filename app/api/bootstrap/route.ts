import { NextResponse } from "next/server";
import { demoFragments, demoModeEnabled, demoPerformance } from "@/lib/demo-data";
import { randomShuffle } from "@/lib/random";
import { activeSlug, getSupabaseAdmin } from "@/lib/supabase-server";

const AUDIENCE_FRAGMENT_COUNT = 5;

export async function GET() {
  if (demoModeEnabled()) {
    return NextResponse.json({
      performance: demoPerformance,
      fragments: randomShuffle(demoFragments).slice(0, AUDIENCE_FRAGMENT_COUNT),
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

  return NextResponse.json({
    performance,
    fragments: randomShuffle(fragments ?? []).slice(0, AUDIENCE_FRAGMENT_COUNT),
  });
}
