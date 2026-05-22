# promise light or tomorrow

A participatory concert web app for audience voice submissions and performer-triggered playback cues.

## What This App Does

- Audience members open `/`, receive five random fragments from a larger pool, choose one, speak it normally, and submit it.
- The browser levels the recording, reduces steady background noise, and compares detected speech against the selected text before submission.
- The admin opens `/admin`, watches submissions arrive, then closes the performance to generate a random cue map.
- The performer opens `/perform`, loads the cue map, and advances cues with a keyboard-style foot pedal.
- The voice material assigned to a cue changes each performance. Cue treatments stay fixed and can be solo, sequential, cacophonous, or a prepared SuperCollider soundtrack cue.

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
   VERIFY_WITH_OPENAI_TRANSCRIPTION=false
   OPENAI_API_KEY=your-openai-api-key
   ```

7. Run:

   ```bash
   npm run dev
   ```

## Supabase Notes

The service role key is used only by server-side Next.js API routes. Do not expose it in browser code.

The `whispers` storage bucket should stay private. The performer page receives short-lived signed URLs only after the admin passcode is accepted.

## Artistic / Technical Design

- The fragment pool is larger than what each audience member sees. `/api/bootstrap` shuffles the full pool per visitor and returns five fragments, so people are not all drawn to whatever sits next to the record button.
- The audience page asks listeners to speak into the phone microphone held close, like a voice memo. This gives the performer more usable signal and leaves intimacy to the musical treatment instead of relying on quiet recordings.
- Each recording is uploaded as the browser captures it, without client-side denoising or normalization. This keeps the source voice cleaner and avoids crunchy artifacts; any transformation belongs in the performer cue engine.
- The performer console analyzes each decoded voice and applies bounded loudness compensation at playback. Quiet voices get lifted, loud voices get reduced, and the original uploaded files remain untouched.
- Optional high-stakes verification can be enabled with `VERIFY_WITH_OPENAI_TRANSCRIPTION=true`. When enabled, the API transcribes uploaded audio with OpenAI, checks that the transcript contains the selected line, rejects profanity, and then saves the audio to Supabase for admin review. Leave it `false` to avoid paid API usage.
- Browser speech recognition is treated as a best-effort review aid, not a hard gate. When a browser transcript is available, the server stores simple flags for possible mismatch or possible profanity. It does not show a match percentage, because browser transcripts can repeat interim phrases and create misleading scores.
- The admin page has a bulk review button: **Reject flagged, approve clean**. It approves pending recordings with no flags and permanently deletes pending recordings flagged for possible mismatch or profanity.
- Closing submissions maps only approved audience material into cue textures: solo cues use one clear recording, sequence cues stagger several recordings one after another, cacophony cues layer many voices with small offsets, and soundtrack cues reserve space for prepared SuperCollider material.
- Empty fragments are allowed. Crowded fragments are allowed. The cue map works from whatever submissions exist at closing time.

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
5. Click **Reject flagged, approve clean**.
6. Click **Close submissions**.
7. Go to `/perform`.
8. Enter the same passcode and click **Load cues**.
9. Click **Unlock audio** once.
10. Use a foot pedal that sends `Space`, `Enter`, or `ArrowRight`.

To reopen submissions for another test or performance, use **Reset and
reopen** on `/admin`. This deletes the old audio files, submission rows, and
cue assignments from Supabase before setting the performance back to `open`.

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
