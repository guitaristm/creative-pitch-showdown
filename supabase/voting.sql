-- ============================================================================
-- Employee Anonymous Voting — additive layer for The Creative Pitch Showdown.
-- Run this WHOLE file once in the Supabase SQL Editor (it is idempotent and
-- safe to re-run). It reuses the existing `participants` table.
--
-- Integrity model (DB-enforced, no Edge Function):
--   * Votes are inserted ONLY by the submit_vote() SECURITY DEFINER function,
--     which takes the RAW token, hashes it server-side, checks it is a real
--     active token and that voting is open, then inserts. The browser can't
--     insert votes directly (RLS denies it) and never needs the token list.
--   * unique(participant_id, token_hash) => one vote per token per participant.
--   * A token can only be used if the voter physically holds the raw string;
--     hashes alone are useless because submit_vote hashes a raw pre-image.
-- ============================================================================

-- pgcrypto provides digest(); on Supabase it lives in the `extensions` schema
create extension if not exists pgcrypto with schema extensions;

-- reuse existing participants; just add the active flag the voting admin toggles
alter table participants add column if not exists is_active boolean default true;

-- --- hashing helpers (single source of truth; JS hashToken() must match these)
create or replace function norm_token(raw text) returns text
  language sql immutable as $$ select upper(regexp_replace(coalesce(raw,''), '\s', '', 'g')) $$;

create or replace function hash_token(raw text) returns text
  language sql immutable set search_path = public, extensions
  as $$ select encode(digest(norm_token(raw), 'sha256'), 'hex') $$;

-- --- tables
create table if not exists voting_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  token_label text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists employee_votes (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  token_hash text not null references voting_tokens(token_hash) on delete cascade,
  vote_value int not null check (vote_value between 1 and 5),
  created_at timestamptz default now(),
  unique (participant_id, token_hash)
);

create table if not exists voting_state (
  id int primary key default 1 check (id = 1),
  voting_open boolean default false,
  current_participant_id uuid references participants(id),
  voting_mode text not null default 'rating' check (voting_mode in ('like', 'rating')),
  show_dashboard boolean default false,
  updated_at timestamptz default now()
);

insert into voting_state (id) values (1) on conflict (id) do nothing;

-- --- dashboard views (owner-rights views: expose AGGREGATES to anon, never raw rows)
create or replace view participant_vote_summary as
  select p.id as participant_id, p.name as participant_name, p.level,
    count(v.id) as vote_count,
    coalesce(sum(v.vote_value), 0) as total_vote_value,
    round(coalesce(avg(v.vote_value), 0), 2) as average_rating,
    count(*) filter (where v.vote_value = 1) as rating_1_count,
    count(*) filter (where v.vote_value = 2) as rating_2_count,
    count(*) filter (where v.vote_value = 3) as rating_3_count,
    count(*) filter (where v.vote_value = 4) as rating_4_count,
    count(*) filter (where v.vote_value = 5) as rating_5_count
  from participants p
  left join employee_votes v on v.participant_id = p.id
  group by p.id, p.name, p.level;

create or replace view current_participant_vote_summary as
  select s.* from participant_vote_summary s
  join voting_state vs on vs.id = 1 and vs.current_participant_id = s.participant_id;

-- --- RPCs (callable by anon via PostgREST; SECURITY DEFINER bypasses RLS safely)
create or replace function validate_token(p_token text) returns boolean
  language sql security definer set search_path = public as $$
    select exists (select 1 from voting_tokens where token_hash = hash_token(p_token) and is_active)
  $$;

create or replace function has_voted(p_participant uuid, p_token text) returns boolean
  language sql security definer set search_path = public as $$
    select exists (select 1 from employee_votes
      where participant_id = p_participant and token_hash = hash_token(p_token))
  $$;

-- returns: 'ok' | 'duplicate' | 'invalid' | 'closed' | 'bad_value' | 'no_participant'
create or replace function submit_vote(p_participant uuid, p_token text, p_value int) returns text
  language plpgsql security definer set search_path = public as $$
  declare v_hash text := hash_token(p_token);
  begin
    if not exists (select 1 from voting_state where id = 1 and voting_open) then return 'closed'; end if;
    if p_participant is null then return 'no_participant'; end if;
    if p_value < 1 or p_value > 5 then return 'bad_value'; end if;
    if not exists (select 1 from voting_tokens where token_hash = v_hash and is_active) then return 'invalid'; end if;
    begin
      insert into employee_votes (participant_id, token_hash, vote_value) values (p_participant, v_hash, p_value);
    exception when unique_violation then return 'duplicate';
    end;
    return 'ok';
  end $$;

-- admin adds a token from its raw string (hashed here so it always matches vote-time hashing)
create or replace function add_token(p_raw text, p_label text) returns text
  language plpgsql security definer set search_path = public as $$
  declare v_hash text := hash_token(p_raw);
  begin
    if norm_token(p_raw) = '' then return 'empty'; end if;
    insert into voting_tokens (token_hash, token_label) values (v_hash, p_label)
    on conflict (token_hash) do update set is_active = true, token_label = excluded.token_label;
    return 'ok';
  end $$;

-- --- RLS
alter table voting_tokens enable row level security;
alter table employee_votes enable row level security;
alter table voting_state enable row level security;

drop policy if exists "read voting_state" on voting_state;
create policy "read voting_state" on voting_state for select using (true);
drop policy if exists "write voting_state" on voting_state;
create policy "write voting_state" on voting_state for all using (true) with check (true);

-- tokens: admin UI (anon key) may list/deactivate; hashes are harmless to expose because
-- votes require the RAW token via submit_vote(). No direct insert of votes anywhere.
drop policy if exists "read voting_tokens" on voting_tokens;
create policy "read voting_tokens" on voting_tokens for select using (true);
drop policy if exists "update voting_tokens" on voting_tokens;
create policy "update voting_tokens" on voting_tokens for update using (true) with check (true);

-- employee_votes: NO anon policies => direct read/insert denied. Only submit_vote() writes it,
-- only the aggregate views read it. This keeps individual votes unreadable.

grant select on participant_vote_summary to anon;
grant select on current_participant_vote_summary to anon;

-- realtime so /vote and /dashboard react to admin changes
do $$ begin alter publication supabase_realtime add table voting_state; exception when duplicate_object then null; end $$;

-- --- dev seed tokens (raw values documented in README; DB stores only hashes)
select add_token('TOKEN001', 'DEV-001');
select add_token('TOKEN002', 'DEV-002');
select add_token('TOKEN003', 'DEV-003');
select add_token('TOKEN004', 'DEV-004');
select add_token('TOKEN005', 'DEV-005');
