import { NextRequest, NextResponse } from "next/server";
import { demoModeEnabled } from "@/lib/demo-data";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type VerificationResult = {
  ok: boolean;
  reason?: string;
};

const blockedWords = new Set([
  "asshole",
  "bitch",
  "cunt",
  "dick",
  "fuck",
  "fucked",
  "fucker",
  "fucking",
  "pussy",
  "shit",
  "slut",
  "whore",
]);

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function verifyTranscript(expected: string, actual: string): VerificationResult {
  const expectedWords = normalizedWords(expected);
  const actualWords = normalizedWords(actual);

  if (!actualWords.length) {
    return {
      ok: false,
      reason:
        "No verified speech was detected. Please record the selected line again.",
    };
  }

  if (actualWords.some((word) => blockedWords.has(word))) {
    return {
      ok: false,
      reason:
        "The recording includes words outside the selected text. Please record only the selected line.",
    };
  }

  const expectedSet = new Set(expectedWords);
  const matchingWords = actualWords.filter((word) => expectedSet.has(word));
  const extraWords = actualWords.filter((word) => !expectedSet.has(word));
  const coverage = matchingWords.length / Math.max(1, expectedWords.length);
  const lengthDelta = Math.abs(actualWords.length - expectedWords.length);

  if (coverage < 0.8 || lengthDelta > 2 || extraWords.length > 2) {
    return {
      ok: false,
      reason:
        "The detected words do not match the selected line. Please record only the selected line.",
    };
  }

  return { ok: true };
}

async function transcribeAudio(audio: File) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for server-side transcription.");
  }

  const body = new FormData();
  body.append("model", "gpt-4o-mini-transcribe");
  body.append("response_format", "json");
  body.append("language", "en");
  body.append("file", audio);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.message ??
      `Transcription failed with status ${response.status}`;
    throw new Error(message);
  }

  return String(payload?.text ?? "").trim();
}

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
    .select("id,text")
    .eq("id", fragmentId)
    .eq("performance_id", performanceId)
    .single();

  if (fragmentError || !fragment) {
    return NextResponse.json({ error: "Invalid fragment." }, { status: 400 });
  }

  let transcript = "";
  try {
    transcript = await transcribeAudio(audio);
  } catch (transcriptionError) {
    return NextResponse.json(
      {
        error:
          transcriptionError instanceof Error
            ? `Could not verify recording: ${transcriptionError.message}`
            : "Could not verify recording.",
      },
      { status: 500 },
    );
  }

  const verification = verifyTranscript(fragment.text, transcript);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.reason ?? "Please record the selected line again." },
      { status: 400 },
    );
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
