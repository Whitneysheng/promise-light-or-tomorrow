# promise light or tomorrow

A participatory concert web app for audience whisper submissions and performer-triggered playback cues.

## What This App Does

- Audience members open `/`, choose a fragment, record a whisper, and submit it.
- The admin opens `/admin`, watches submissions arrive, then closes the performance to generate a random cue map.
- The performer opens `/perform`, loads the cue map, and advances cues with a keyboard-style foot pedal.
- The whisper assigned to a cue changes each performance. The cue treatment stays fixed.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from `.env.example`:

   ```bash
   cp .env.example .env.local
   ```

   For a no-database UI test, set:

   ```text
   NEXT_PUBLIC_DEMO_MODE=true
   ```

   Demo mode lets you test the recording interface, but it does not save
   recordings for the performer console.

3. Create a Supabase project.

4. In Supabase SQL Editor, run:

   ```sql
   -- paste supabase/schema.sql
   ```

5. In Supabase Storage, create a private bucket named:

   ```text
   whispers
   ```

6. Fill `.env.local`:

   ```text
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NEXT_PUBLIC_DEMO_MODE=false
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ADMIN_PASSCODE=choose-a-long-private-passcode
   ACTIVE_PERFORMANCE_SLUG=promise-light-or-tomorrow
   ```

7. Run:

   ```bash
   npm run dev
   ```

## Supabase Notes

The service role key is used only by server-side Next.js API routes. Do not expose it in browser code.

The `whispers` storage bucket should stay private. The performer page receives short-lived signed URLs only after the admin passcode is accepted.

## Vercel Hosting

Recommended production setup:

1. Push this project to GitHub.
2. Import the repo in Vercel.
3. Add the same environment variables in Vercel Project Settings.
4. Deploy.
5. Add `app.whitneysheng.com` as a Vercel custom domain.
6. In Cloudflare DNS for `whitneysheng.com`, add the CNAME record Vercel provides.

Use `app.whitneysheng.com` so your existing `whitneysheng.com` site can remain untouched.

## Performance Workflow

1. Open submissions before the concert.
2. Audience scans the QR code for `https://app.whitneysheng.com`.
3. A few minutes before the piece, go to `/admin`.
4. Enter the admin passcode.
5. Click **Close submissions**.
6. Go to `/perform`.
7. Enter the same passcode and click **Load cues**.
8. Click **Unlock audio** once.
9. Use a foot pedal that sends `Space`, `Enter`, or `ArrowRight`.

## Foot Pedal

Use a Bluetooth or USB pedal that emulates keyboard input. Configure it to send one of:

- `Space`
- `Enter`
- `ArrowRight`

The performer page also has on-screen backup controls.

## Venue Test Checklist

- Test iPhone Safari recording.
- Test Android Chrome recording.
- Confirm uploads work on venue Wi-Fi and cellular.
- Confirm the performance laptop can play through the house audio system.
- Test the exact foot pedal with the exact browser.
- Generate a cue map with at least 20 dummy submissions.
- Confirm **Stop all** immediately silences active cues.
