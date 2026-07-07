# The Creative Pitch Showdown — Scoring & Live Scoreboard

Internal scoring + live display system for the **Creative Output Pitching Challenge** (13 Aug 2026).
Judges score on paper → staff enter scores in the **Operator View** → the system computes JP totals,
Thai average, final score, ranking and awards → the **Audience View** (projector) shows only what the
operator chooses to reveal.

- `/operator` — private staff console: score input, ranking, awards, display control.
- `/audience` — projector screen: opening, now-pitching, scoring-in-progress, winner reveal. **Never shows ranking or partial scores.**
- `/` redirects to `/audience`.

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
  audience screen via realtime. Set the current participant before "Now Pitching". Start the
  5:00 timer when the pitch begins.
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
