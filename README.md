# The Creative Pitch Showdown — Scoring & Live Scoreboard

Internal scoring + live display system for the **Creative Output Pitching Challenge** (13 Aug 2026).
Judges score on paper → staff enter scores in the **Operator View** → the system computes JP totals,
Thai average, final score, ranking and awards → the **Audience View** (projector) shows only what the
operator chooses to reveal.

- `/operator` — private staff console: score input, ranking, awards, display control, participant order/names.
- `/audience` — projector screen: opening, now-pitching, scoring-in-progress, winner reveal. **Never shows ranking or partial scores.**
- `/vote` — employee anonymous voting (mobile). `/dashboard` — aggregated voting results. `/admin` — voting control.
- `/` redirects to `/audience` (employees get the `/vote` link directly).

Stack: React + Vite + TypeScript, Supabase (DB + realtime), Vercel (hosting), no custom backend.

## 1. Run locally

```bash
npm install
cp .env.example .env   # fill in Supabase values (step 2–3)
npm run dev            # http://localhost:5173/operator and /audience
npm test               # scoring logic self-check
```

## 2. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (any region, free tier is fine).
2. Project Settings → API: copy the **Project URL** and **anon public key**.

> ⚠️ Use the plain project URL (`https://xxxx.supabase.co`) — **not** the REST endpoint
> ending in `/rest/v1/`. The app strips that suffix defensively, but paste the clean one.

## 3. Run the schema (also seeds participants & judges)

1. Dashboard → **SQL Editor** → New query.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.

This creates all tables, enables RLS + realtime, and seeds the 17 participants, 6 judges,
and the single `display_state` row. It is safe to re-run (seeds use `on conflict do nothing`;
the `alter publication` lines will error if already added — ignore that on re-runs).

## 4. Environment variables

Local `.env`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

On Vercel: Project → Settings → Environment Variables → add both for Production (and Preview).

## 5. Deploy to Vercel

```bash
npx vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard (framework preset: Vite). `vercel.json`
already contains the SPA rewrite so `/operator` and `/audience` work on refresh.
After adding the env vars, redeploy.

## 6. Using the Operator View (`/operator`)

- **Display Control** — pick the screen mode; every change saves immediately and pushes to the
  audience screen via realtime. Set the current participant before "Now Pitching". The pitch
  timer supports Start / Pause / Resume / Reset and the audience screen mirrors it live.
- **Presentation slides** — in Display Control, pick the current participant and paste their
  presentation link (Google Slides / Canva share links auto-convert to embed form). On
  "Now Pitching" the audience screen embeds the deck fullscreen with a name + timer bar.
- **Output videos** — videos *inside* an embedded deck will not play on third-party sites
  (Google blocks Drive-video streaming there). Instead, paste the participant's video link
  (Drive share link, YouTube, or direct .mp4) into "Output video link" and use the
  **🎬 Show output video / 🖼 Back to slides** toggle — the audience screen switches between
  the deck and Drive's own embeddable player, which does work on third-party sites.
  Keep the video slide in the deck as a poster; play the real file via the toggle.
- **Testing / Rehearsal** — in the Data Health panel: "Fill random test scores" populates all
  102 score rows for a full rehearsal; "Reset all scores" wipes scores, award overrides and
  consensus entries. Both ask for confirmation.
- **Score Input** — select a participant, type each judge's four criteria scores from the paper
  sheet (Tab moves between fields; totals compute live; invalid values highlight red; judges with
  no scores yet highlight as missing). Press **Save all judge scores**.
- **Score Summary** — JP total /80, Thai average /20, final /100, completion (e.g. 4/4 JP, 2/2 TH), verified count.
- **Private Ranking** — overall + level rank, tie-breaker columns, completion, assigned award.
  Rows marked ⚠️ are fully tied — enter a consensus rank adjustment (lower wins) after judges decide.
- **Award Management** — shows auto winners (top 2 per level, top overall = Grand Prix); pick a
  name to override, pick "auto" to clear the override.
- **Winner reveal** — choose the award and reveal participant (or the "use suggested winner" button),
  toggle "show winner score", then switch screen mode to Winner Reveal.

## 7. Using the Audience View (`/audience`)

Open it fullscreen on the projector output. It follows the operator's display state live —
no interaction needed on that machine.

> **⚠️ Do NOT mirror displays.** Use *extended* display mode and put only the `/audience`
> browser window on the projector. The `/operator` tab must stay on the staff laptop screen.

## 8. Security notes (read before reusing)

This is an **internal-event prototype**:

- The Supabase anon key allows read on all tables and write on `scores`, `display_state`,
  `award_overrides`, `final_consensus`. Anyone with the deployed URL could read scores or change
  the display. There is no login.
- Mitigations for the event: don't share the URL outside staff, and/or enable
  **Vercel Deployment Protection** (password / Vercel Authentication) on the project, or host on
  a private network.
- For real production use: add Supabase Auth, restrict write policies to authenticated operator
  users, and restrict `scores` reads.

The audience route never queries the scores table except for the single winner's total, and only
when the operator enables "show winner score".

## 9. Scoring formula

Each judge scores each participant out of **20**:

| Criterion | Max |
|---|---|
| Quality of Plan / Story / Original Concept | 3 |
| Visual Quality / Execution | 10 |
| Technical Value | 4 |
| Business Potential | 3 |

- **JP Total** = Mamo + Yui + Takuya + Jay (max **80**)
- **Thai Average** = (Maprang + Pued) / 2 (max **20**) — if only one TH score exists it is used
  as-is but flagged incomplete
- **Final Score = JP Total + Thai Average** (max **100**)

Example: 17+16+18+17 = 68 JP; (15+17)/2 = 16 TH avg; final = **84/100**.

**Tie-breakers**: 1) higher total Visual score, 2) higher total Technical score,
3) judges' consensus entered by the operator. Still-tied rows are flagged "needs consensus" —
never silently resolved.

**Awards**: Senior 1 & 2 = top 2 Seniors, Junior 1 & 2 = top 2 Juniors, Grand Prix = top overall.
All manually overridable.

---

# Employee Anonymous Voting

A **separate layer** from the official judge scoring above. Judges score on paper and staff enter
those privately; this layer lets **all employees** vote for each pitch from their phones. The two
never mix — voting results never touch the awards.

## How anonymous token voting works

True anonymity and duplicate prevention conflict: to stop someone voting twice you need to know who
they are, but that breaks anonymity. The resolution is **anonymous tokens**. HR hands each employee
one private code (e.g. `EMP-7KQ2-MN9A`). The database stores **only the SHA-256 hash** of the code —
never the code, never a name. A unique constraint on `(participant_id, token_hash)` means one code can
vote **once per participant** but for **every** participant. Counts are possible; identities are not.

**Integrity (this build):** votes are inserted only by a Postgres `submit_vote()` function that takes
the raw code, hashes it server-side, checks it is a real active token and that voting is open, then
inserts. The browser cannot insert votes directly (RLS denies it) and never sees the token list. This
closes the ballot-stuffing hole that a purely client-side flow would leave open via the public anon key.
> **TODO for external/public use:** move `submit_vote` behind a rate-limited Supabase Edge Function
> and never expose token hashes. For this internal event the DB-enforced RPC is sufficient.

## Setup

1. Run [`supabase/voting.sql`](supabase/voting.sql) once in the Supabase SQL Editor (idempotent; adds
   voting tables, views, RPCs, RLS, realtime, and 5 dev tokens). Reuses the existing `participants`.
2. Set `VITE_ADMIN_PASSCODE` in `.env` (local) and Vercel env vars (Production + Preview), then redeploy.
3. Generate real tokens: `node scripts/generateTokens.ts 60` → writes `tokens-output/distribute.csv`
   (give each employee ONE row — keep the rest private) and `insert.sql` (paste into Supabase SQL Editor).
   **Never commit `tokens-output/`** (gitignored). Use non-identifying labels (`EMP-001`), not names.

Dev tokens for testing: `TOKEN001`–`TOKEN005`.

## Using it

- **`/admin`** (passcode) — open/close voting, pick the current participant, choose mode
  (Rating 1–5 or Simple like), add/deactivate tokens, watch live counts, edit topics / active flags.
- **`/vote`** (employees, mobile) — enter code → rate the current participant 1–5 (or one-tap like) →
  "Vote submitted". Voting a second time for the same person shows "already voted". Updates live when
  the admin changes the current participant. Shows "closed" / "waiting" states.
- **`/dashboard`** — ranking (by average, then vote count, then name), vote-count bars, and a 1–5
  distribution bar per participant, with an All/Senior/Junior filter. Passcode-gated unless the admin
  ticks "Make /dashboard public". **Never shows tokens, hashes, or identities** — only aggregates.

Rating labels: 1 Needs more development · 2 Fair · 3 Good · 4 Very good · 5 Excellent.

## Voting security limitations

- The admin passcode is checked in the browser (it ships in the bundle) — it keeps casual viewers out,
  not determined ones. For real protection, add Vercel Deployment Protection or Supabase Auth.
- The anon key can read token **labels/hashes** and toggle voting state; hashes are useless for voting
  (you need the raw code, and only `submit_vote` writes votes), but don't put employee names in labels.
- Individual votes are never readable by the anon key (RLS) — only the aggregate views are.

## Participant order & names (scoring app)

In `/operator` → "Participants — order & names": edit pitch order or a name and click away to save; untick
"Active" to skip someone who isn't ready (hidden from voters). Handy for last-minute lineup changes.
