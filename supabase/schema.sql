-- The Creative Pitch Showdown — schema + seed
-- Run this whole file in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  participant_code text unique not null,
  name text not null,
  level text not null check (level in ('Senior', 'Junior')),
  pitch_order int not null,
  topic text,
  status text default 'pending',
  slide_url text,
  video_url text,
  created_at timestamptz default now()
);

alter table display_state add column if not exists show_video boolean default false;

-- migrations for databases created before these columns existed (safe to re-run)
alter table participants add column if not exists slide_url text;
alter table participants add column if not exists video_url text;

create table if not exists judges (
  id uuid primary key default gen_random_uuid(),
  judge_code text unique not null,
  name text not null,
  judge_group text not null check (judge_group in ('JP', 'TH')),
  role text,
  created_at timestamptz default now()
);

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  judge_id uuid not null references judges(id) on delete cascade,
  concept_score numeric not null default 0 check (concept_score between 0 and 3),
  visual_score numeric not null default 0 check (visual_score between 0 and 10),
  technical_score numeric not null default 0 check (technical_score between 0 and 4),
  business_score numeric not null default 0 check (business_score between 0 and 3),
  total_score numeric generated always as (concept_score + visual_score + technical_score + business_score) stored,
  comment text,
  input_by text,
  verified boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (participant_id, judge_id)
);

create table if not exists display_state (
  id int primary key default 1 check (id = 1),
  screen_mode text not null default 'opening' check (screen_mode in ('opening', 'now_pitching', 'scoring', 'winner_reveal')),
  current_participant_id uuid references participants(id),
  selected_award text,
  reveal_participant_id uuid references participants(id),
  show_winner_score boolean default false,
  show_video boolean default false,
  timer_seconds int default 300,
  timer_running boolean default false,
  updated_at timestamptz default now()
);

create table if not exists award_overrides (
  id uuid primary key default gen_random_uuid(),
  award_key text unique not null,
  participant_id uuid references participants(id),
  updated_at timestamptz default now()
);

create table if not exists final_consensus (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid unique references participants(id),
  consensus_rank_adjustment int default 0,
  note text,
  updated_at timestamptz default now()
);

-- Seed: participants
insert into participants (participant_code, name, level, pitch_order) values
  ('P01', 'Nanot',   'Senior', 1),
  ('P02', 'Jack',    'Senior', 2),
  ('P03', 'Deaw',    'Senior', 3),
  ('P04', 'Fon',     'Senior', 4),
  ('P05', 'Gyb',     'Senior', 5),
  ('P06', 'Sho',     'Senior', 6),
  ('P07', 'Ball',    'Senior', 7),
  ('P08', 'Nott',    'Senior', 8),
  ('P09', 'Preaw',   'Senior', 9),
  ('P10', 'Airi',    'Senior', 10),
  ('P11', 'Taichi',  'Senior', 11),
  ('P12', 'Bank',    'Junior', 12),
  ('P13', 'Cherry',  'Junior', 13),
  ('P14', 'Eight',   'Junior', 14),
  ('P15', 'Pim',     'Junior', 15),
  ('P16', 'Parn',    'Junior', 16),
  ('P17', 'Tangkwa', 'Junior', 17)
on conflict (participant_code) do nothing;

-- Seed: judges
insert into judges (judge_code, name, judge_group) values
  ('J01', 'Mamo',    'JP'),
  ('J02', 'Yui',     'JP'),
  ('J03', 'Takuya',  'JP'),
  ('J04', 'Jay',     'JP'),
  ('J05', 'Maprang', 'TH'),
  ('J06', 'Pued',    'TH')
on conflict (judge_code) do nothing;

-- Seed: single display_state row
insert into display_state (id, screen_mode) values (1, 'opening')
on conflict (id) do nothing;

-- Realtime: broadcast changes on tables the views subscribe to
alter publication supabase_realtime add table display_state;
alter publication supabase_realtime add table scores;
alter publication supabase_realtime add table award_overrides;
alter publication supabase_realtime add table participants;

-- RLS (prototype-grade: anon can read everything; anon can write the operator tables).
-- This is an INTERNAL event tool. Protect /operator by not sharing the URL and/or
-- Vercel Deployment Protection. See README "Security notes".
alter table participants enable row level security;
alter table judges enable row level security;
alter table scores enable row level security;
alter table display_state enable row level security;
alter table award_overrides enable row level security;
alter table final_consensus enable row level security;

create policy "anon read participants" on participants for select using (true);
create policy "anon read judges" on judges for select using (true);
create policy "anon read scores" on scores for select using (true);
create policy "anon read display_state" on display_state for select using (true);
create policy "anon read award_overrides" on award_overrides for select using (true);
create policy "anon read final_consensus" on final_consensus for select using (true);

create policy "anon write participants" on participants for update using (true) with check (true);

-- Storage bucket for participant output videos (played natively on the audience screen —
-- Google blocks Drive video streaming inside third-party embeds, so we host the files ourselves).
insert into storage.buckets (id, name, public) values ('videos', 'videos', true)
on conflict (id) do nothing;
create policy "anon read videos" on storage.objects for select using (bucket_id = 'videos');
create policy "anon upload videos" on storage.objects for insert with check (bucket_id = 'videos');
create policy "anon replace videos" on storage.objects for update using (bucket_id = 'videos') with check (bucket_id = 'videos');
create policy "anon write scores" on scores for all using (true) with check (true);
create policy "anon write display_state" on display_state for all using (true) with check (true);
create policy "anon write award_overrides" on award_overrides for all using (true) with check (true);
create policy "anon write final_consensus" on final_consensus for all using (true) with check (true);
