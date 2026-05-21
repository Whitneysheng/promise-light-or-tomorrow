create extension if not exists pgcrypto;

create type performance_status as enum ('open', 'closed', 'performed');

create table if not exists performances (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  status performance_status not null default 'open',
  seed text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists fragments (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  text text not null,
  display_order integer not null default 0,
  unique (performance_id, display_order)
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  fragment_id uuid not null references fragments(id) on delete restrict,
  storage_path text not null,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  consent_confirmed boolean not null default false,
  transcript text,
  text_match_score numeric,
  processing_notes text
);

create table if not exists cues (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  label text not null,
  order_index integer not null,
  treatment jsonb not null default '{}'::jsonb,
  unique (performance_id, order_index)
);

create table if not exists cue_assignments (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references performances(id) on delete cascade,
  cue_id uuid not null references cues(id) on delete cascade,
  submission_id uuid references submissions(id) on delete set null,
  assignment_index integer not null,
  start_offset_seconds numeric not null default 0,
  gain numeric not null default 1,
  unique (performance_id, assignment_index)
);

alter table submissions add column if not exists transcript text;
alter table submissions add column if not exists text_match_score numeric;
alter table submissions add column if not exists processing_notes text;
alter table cue_assignments add column if not exists start_offset_seconds numeric not null default 0;
alter table cue_assignments add column if not exists gain numeric not null default 1;
alter table cue_assignments drop constraint if exists cue_assignments_performance_id_cue_id_key;

alter table performances enable row level security;
alter table fragments enable row level security;
alter table submissions enable row level security;
alter table cues enable row level security;
alter table cue_assignments enable row level security;

create policy "Public can read open performance titles"
  on performances for select
  using (true);

create policy "Public can read fragments"
  on fragments for select
  using (true);

create policy "Public can read cues"
  on cues for select
  using (true);

-- All writes and private audio reads are performed by Next.js API routes using
-- the Supabase service role key. Do not expose the service role key in clients.

insert into performances (title, slug, status)
values ('promise light or tomorrow', 'promise-light-or-tomorrow', 'open')
on conflict (slug) do nothing;

with perf as (
  select id from performances where slug = 'promise-light-or-tomorrow'
)
insert into fragments (performance_id, text, display_order)
select perf.id, fragment_text, display_order
from perf,
  (values
    ('Promise light or tomorrow', 1),
    ('No one promised light or tomorrow', 2),
    ('Memory can collapse time', 3),
    ('Debt is its own reward', 4),
    ('Just a length of rope, baby', 5),
    ('Other homes are possible', 6),
    ('The violets', 7),
    ('Piano dust', 8),
    ('You might not be able to tell but this is a love poem', 9),
    ('All speech is a presumption, to answer tomorrow', 10),
    ('Perhaps every time I said Love, I meant History', 11),
    ('Love is my first choice, but', 12),
    ('The better things can only be gathered by a pen', 13),
    ('It''s spring now', 14),
    ('A door remembers every hand', 15),
    ('The room was listening before us', 16),
    ('I kept the future in my mouth', 17),
    ('Your name arrived as weather', 18),
    ('History sits beside the cup', 19),
    ('The lamp keeps choosing us', 20),
    ('Some promises are made of air', 21),
    ('I wanted the ordinary to stay', 22),
    ('The street answered softly', 23),
    ('Tomorrow had no witness yet', 24)
  ) as seed(fragment_text, display_order)
on conflict do nothing;

with perf as (
  select id from performances where slug = 'promise-light-or-tomorrow'
)
insert into cues (performance_id, label, order_index, treatment)
select perf.id, label, order_index, treatment::jsonb
from perf,
  (values
    ('bar 10', 1, '{"name":"single witness","texture":"solo","voiceCount":1,"gain":0.72,"loopStart":0,"loopEnd":2.6,"filterType":"lowpass","filterFrequency":2600,"distortion":0.04,"reverb":0.05,"playbackRate":1}'),
    ('bar 12', 2, '{"name":"three-line handoff","texture":"sequence","voiceCount":3,"staggerSeconds":1.6,"gain":0.74,"loopStart":0,"loopEnd":2.8,"filterType":"bandpass","filterFrequency":1450,"distortion":0.18,"delay":0.04,"reverb":0.12,"playbackRate":1.03}'),
    ('bar 18', 3, '{"name":"room of almost words","texture":"cacophony","voiceCount":7,"staggerSeconds":0.32,"gain":0.42,"loopStart":0,"loopEnd":4.2,"filterType":"highpass","filterFrequency":420,"distortion":0.09,"reverb":0.68,"playbackRate":0.82,"reverse":true}'),
    ('bar 24', 4, '{"name":"stuttered pulse","texture":"solo","voiceCount":1,"gain":0.6,"loopStart":0.25,"loopEnd":1.15,"filterType":"bandpass","filterFrequency":880,"distortion":0.22,"delay":0.18,"reverb":0.2,"playbackRate":1.18}'),
    ('bar 31', 5, '{"name":"almost intelligible braid","texture":"sequence","voiceCount":5,"staggerSeconds":1.1,"gain":0.62,"loopStart":0,"loopEnd":3.3,"filterType":"lowpass","filterFrequency":1900,"distortion":0.12,"reverb":0.34,"playbackRate":0.94}'),
    ('bar 38', 6, '{"name":"public cloud","texture":"cacophony","voiceCount":11,"staggerSeconds":0.18,"gain":0.34,"loopStart":0,"loopEnd":3.8,"filterType":"bandpass","filterFrequency":1200,"distortion":0.2,"delay":0.11,"reverb":0.55,"playbackRate":1.08}'),
    ('bar 44', 7, '{"name":"one clear return","texture":"solo","voiceCount":1,"gain":0.8,"loopStart":0,"loopEnd":3,"filterType":"lowpass","filterFrequency":3200,"distortion":0.02,"reverb":0.1,"playbackRate":1}'),
    ('bar 52', 8, '{"name":"supercollider bed cue","texture":"soundtrack","voiceCount":0,"gain":0,"reverb":0}')
  ) as seed(label, order_index, treatment)
on conflict (performance_id, order_index)
do update set label = excluded.label, treatment = excluded.treatment;
