import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function assertAdmin(passcode: string | null) {
  const expected = process.env.ADMIN_PASSCODE;

  if (!expected) {
    throw new Error("Missing ADMIN_PASSCODE");
  }

  if (!passcode || passcode !== expected) {
    throw new Error("Invalid admin passcode");
  }
}

export function activeSlug() {
  return process.env.ACTIVE_PERFORMANCE_SLUG ?? "promise-light-or-tomorrow";
}
