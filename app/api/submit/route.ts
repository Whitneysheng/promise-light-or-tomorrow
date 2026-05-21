import { NextRequest, NextResponse } from "next/server";
import { demoModeEnabled } from "@/lib/demo-data";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  if (demoModeEnabled()) {
    return NextResponse.json({
      submission: {
        id: crypto.randomUUID(),
        demo: true,
      },
    });
  }

  const supabase = getSupabaseAdmin();
  const formData = await request.formData();

  const performanceId = String(formData.get("performanceId") ?? "");
  const fragmentId = String(formData.get("fragmentId") ?? "");
  const durationSeconds = Number(formData.get("durationSeconds") ?? 0);
  const transcript = String(formData.get("transcript") ?? "").trim();
  const textMatchScore = Number(formData.get("textMatchScore") ?? NaN);
  const processingNotes = String(formData.get("processingNotes") ?? "").trim();
  const audio = formData.get("audio");

  if (!performanceId || !fragmentId || !(audio instanceof File)) {
    return NextResponse.json(
      { error: "Missing recording, performance, or fragment." },
      { status: 400 },
    );
  }

  const { data: performance, error: performanceError } = await supabase
    .from("performances")
    .select("id,status")
    .eq("id", performanceId)
    .single();

  if (performanceError || !performance || performance.status !== "open") {
    return NextResponse.json(
      { error: "Submissions are not open." },
      { status: 403 },
    );
  }

  const { data: fragment, error: fragmentError } = await supabase
    .from("fragments")
    .select("id")
    .eq("id", fragmentId)
    .eq("performance_id", performanceId)
    .single();

  if (fragmentError || !fragment) {
    return NextResponse.json({ error: "Invalid fragment." }, { status: 400 });
  }

  const submissionId = crypto.randomUUID();
  const extension = audio.type.includes("wav")
    ? "wav"
    : audio.type.includes("mp4")
      ? "mp4"
      : "webm";
  const storagePath = `performances/${performanceId}/submissions/${submissionId}.${extension}`;

  const upload = await supabase.storage
    .from("whispers")
    .upload(storagePath, audio, {
      contentType: audio.type || "audio/webm",
      upsert: false,
    });

  if (upload.error) {
    return NextResponse.json(
      {
        error: `Could not upload recording: ${upload.error.message}`,
      },
      { status: 500 },
    );
  }

  const { data: submission, error: insertError } = await supabase
    .from("submissions")
    .insert({
      id: submissionId,
      performance_id: performanceId,
      fragment_id: fragmentId,
      storage_path: storagePath,
      duration_seconds: Number.isFinite(durationSeconds)
        ? durationSeconds
        : null,
      consent_confirmed: false,
      transcript: transcript || null,
      text_match_score: Number.isFinite(textMatchScore) ? textMatchScore : null,
      processing_notes: processingNotes || null,
    })
    .select("*")
    .single();

  if (insertError) {
    await supabase.storage.from("whispers").remove([storagePath]);
    return NextResponse.json(
      { error: `Could not save submission: ${insertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ submission });
}
