// /dashboard — aggregated voting results. Never shows tokens or identities.
import { useEffect, useMemo, useState } from 'react'
import { AdminGate } from '../components/AdminGate.tsx'
import { supabase } from '../lib/supabase.ts'
import { MODE_MAX, VOTING, type Level, type ParticipantVoteSummary, type VotingState } from '../lib/types.ts'

interface HistRow {
  participant_id: string
  vote_value: number
  votes: number
}

/** Judges' "Visual Quality / Execution" is scored /10 — the same scale employees vote on. */
function Stars({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100))
  return (
    <span className="stars" title={`${value.toFixed(1)} / 10`}>
      <span className="stars-bg">★★★★★</span>
      <span className="stars-fg" style={{ width: `${pct}%` }}>★★★★★</span>
    </span>
  )
}

export default function VotingDashboard() {
  const [publicOk, setPublicOk] = useState<boolean | null>(null)

  useEffect(() => {
    if (!supabase) return setPublicOk(false)
    supabase.from('voting_state').select('show_dashboard').eq('id', 1).single().then(({ data }) => setPublicOk(!!data?.show_dashboard))
  }, [])

  if (publicOk === null) return <div className="dash"><p className="vote-note">Loading…</p></div>
  if (publicOk) return <DashboardInner />
  return (
    <AdminGate label="Voting Dashboard">
      <DashboardInner />
    </AdminGate>
  )
}

function DashboardInner() {
  const [rows, setRows] = useState<ParticipantVoteSummary[]>([])
  const [hist, setHist] = useState<HistRow[]>([])
  const [state, setState] = useState<VotingState | null>(null)
  const [filter, setFilter] = useState<Level | 'All'>('All')
  const [focusId, setFocusId] = useState('')
  const [judgeQuality, setJudgeQuality] = useState<Map<string, { avg: number; count: number }>>(new Map())

  useEffect(() => {
    if (!supabase) return
    const load = async () => {
      const [sm, vs, hg, js] = await Promise.all([
        supabase!.from('participant_vote_summary').select('*'),
        supabase!.from('voting_state').select('*').eq('id', 1).single(),
        supabase!.from('vote_histogram').select('*'),
        supabase!.from('scores').select('participant_id,visual_score'),
      ])
      setRows((sm.data as ParticipantVoteSummary[]) ?? [])
      if (vs.data) setState(vs.data as VotingState)
      setHist((hg.data as HistRow[]) ?? [])
      // judges' quality-of-work score, averaged across the judges who scored that pitcher
      const acc = new Map<string, { sum: number; count: number }>()
      for (const s of (js.data ?? []) as { participant_id: string; visual_score: number }[]) {
        const a = acc.get(s.participant_id) ?? { sum: 0, count: 0 }
        acc.set(s.participant_id, { sum: a.sum + Number(s.visual_score), count: a.count + 1 })
      }
      setJudgeQuality(new Map([...acc].map(([id, a]) => [id, { avg: a.sum / a.count, count: a.count }])))
    }
    load()
    const ch = supabase.channel('dash').on('postgres_changes', { event: '*', schema: 'public', table: 'voting_state' }, load).subscribe()
    const poll = setInterval(load, 3000) // votes aren't anon-readable individually → poll aggregates
    return () => {
      supabase!.removeChannel(ch)
      clearInterval(poll)
    }
  }, [])

  if (!supabase) return <div className="dash"><p className="vote-note">Voting is not configured.</p></div>

  const mode = state?.voting_mode ?? 'quality'
  const max = MODE_MAX[mode]
  const filtered = useMemo(() => rows.filter((r) => filter === 'All' || r.level === filter), [rows, filter])
  const ranked = useMemo(
    () => [...filtered].sort((a, b) =>
      Number(b.average_rating) - Number(a.average_rating) || b.vote_count - a.vote_count || a.participant_name.localeCompare(b.participant_name)),
    [filtered],
  )
  const maxCount = Math.max(1, ...filtered.map((r) => r.vote_count))
  const totalVotes = filtered.reduce((s, r) => s + r.vote_count, 0)
  const focus = rows.find((r) => r.participant_id === focusId)
  const focusHist = hist.filter((h) => h.participant_id === focusId)
  const focusMaxVotes = Math.max(1, ...focusHist.map((h) => h.votes))
  // min/max arrive with the voting.sql update; until then show "—" rather than "undefined"
  const hasRange = (r: ParticipantVoteSummary) => r.vote_count > 0 && r.min_value != null && r.max_value != null
  const spread = (r: ParticipantVoteSummary) =>
    !hasRange(r) ? '—' : r.min_value === r.max_value ? `${r.min_value}` : `${r.min_value}–${r.max_value}`

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <p className="vote-kicker">{VOTING.subtitle}</p>
          <h1 className="dash-title">{VOTING.title}</h1>
        </div>
        <div className="dash-status">
          <span className={state?.voting_open ? 'pill open' : 'pill closed'}>{state?.voting_open ? 'Voting open' : 'Voting closed'}</span>
          <div className="dash-filter">
            {(['All', 'Senior', 'Junior'] as const).map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-cards">
        <div className="dash-stat"><span>Total votes</span><strong>{totalVotes}</strong></div>
        <div className="dash-stat"><span>Participants</span><strong>{filtered.length}</strong></div>
        <div className="dash-stat"><span>Top average</span><strong>{ranked[0]?.vote_count ? Number(ranked[0].average_rating).toFixed(2) : '—'}</strong></div>
        <div className="dash-stat"><span>Scale</span><strong>/{max}</strong></div>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <h2>Ranking</h2>
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Level</th><th>Avg /{max}</th><th>Range</th><th>Votes</th><th>Judge /10</th></tr></thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.participant_id} className={r.participant_id === focusId ? 'tied' : ''}
                  onClick={() => setFocusId(r.participant_id)} style={{ cursor: 'pointer' }}>
                  <td>{i + 1}</td>
                  <td>{r.participant_name}</td>
                  <td>{r.level}</td>
                  <td><strong>{r.vote_count ? Number(r.average_rating).toFixed(2) : '—'}</strong></td>
                  <td>{spread(r)}</td>
                  <td>{r.vote_count}</td>
                  <td>
                    {judgeQuality.has(r.participant_id) ? (
                      <><Stars value={judgeQuality.get(r.participant_id)!.avg} /> <span className="muted">{judgeQuality.get(r.participant_id)!.avg.toFixed(1)}</span></>
                    ) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Click a row to see that pitcher's detail. Range = lowest–highest score given.</p>
        </section>

        <section className="panel">
          <h2>Pitcher detail</h2>
          <select value={focusId} onChange={(e) => setFocusId(e.target.value)}>
            <option value="">— select a pitcher —</option>
            {rows.map((r) => (
              <option key={r.participant_id} value={r.participant_id}>{r.participant_name} ({r.level})</option>
            ))}
          </select>
          {!focus ? (
            <p className="muted">Pick a name to see their score spread.</p>
          ) : focus.vote_count === 0 ? (
            <p className="muted">{focus.participant_name} has no votes yet.</p>
          ) : (
            <>
              <div className="dash-cards">
                <div className="dash-stat"><span>Employee average</span><strong>{Number(focus.average_rating).toFixed(2)}</strong></div>
                <div className="dash-stat"><span>Range</span><strong>{spread(focus)}</strong></div>
                <div className="dash-stat"><span>Voters</span><strong>{focus.vote_count}</strong></div>
              </div>
              <div className="judge-compare">
                <span>Judges' quality of work</span>
                {judgeQuality.has(focus.participant_id) ? (
                  <>
                    <Stars value={judgeQuality.get(focus.participant_id)!.avg} />
                    <strong>{judgeQuality.get(focus.participant_id)!.avg.toFixed(1)} / 10</strong>
                    <span className="muted">({judgeQuality.get(focus.participant_id)!.count} judge scores)</span>
                  </>
                ) : <span className="muted">not scored yet</span>}
              </div>
              <p className="muted">How many voters gave each score</p>
              {Array.from({ length: max }, (_, i) => i + 1).map((v) => {
                const n = focusHist.find((h) => h.vote_value === v)?.votes ?? 0
                return (
                  <div key={v} className="bar-row">
                    <span className="bar-label small">{v}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / focusMaxVotes) * 100}%` }} /></div>
                    <span className="bar-value">{n || ''}</span>
                  </div>
                )
              })}
            </>
          )}
        </section>

        <section className="panel wide">
          <h2>Judge score vs employee range</h2>
          <div className="legend">
            <span><span className="legend-star">★</span> Avg. judge score</span>
            <span><span className="legend-line" /> Employee score range</span>
          </div>
          {ranked.map((r) => {
            const pos = (v: number) => ((v - 1) / (max - 1)) * 100 // 1 → 0%, max → 100%
            const judge = judgeQuality.get(r.participant_id)
            return (
              <div key={r.participant_id} className="spread-row">
                <span className="spread-name">{r.participant_name}</span>
                <div className="spread-axis">
                  {hasRange(r) && (
                    <>
                      <div className="spread-line" style={{ left: `${pos(Number(r.min_value))}%`, width: `${pos(Number(r.max_value)) - pos(Number(r.min_value))}%` }} />
                      <div className="spread-dot" style={{ left: `${pos(Number(r.min_value))}%` }} title={`lowest ${r.min_value}`} />
                      <div className="spread-dot" style={{ left: `${pos(Number(r.max_value))}%` }} title={`highest ${r.max_value}`} />
                    </>
                  )}
                  {judge && (
                    <div className="spread-star" style={{ left: `${pos(judge.avg)}%` }} title={`judges ${judge.avg.toFixed(1)} / 10`}>★</div>
                  )}
                </div>
                <span className="spread-val">
                  {r.vote_count ? `${spread(r)}` : '—'}
                  {judge && <span className="spread-judge"> ★{judge.avg.toFixed(1)}</span>}
                </span>
              </div>
            )
          })}
          <div className="spread-scale">
            <span className="spread-name" />
            <div className="spread-axis">
              {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
                <span key={v} className="scale-tick" style={{ left: `${((v - 1) / (max - 1)) * 100}%` }}>{v}</span>
              ))}
            </div>
            <span className="spread-val" />
          </div>
          <p className="muted">
            Line = spread of employee scores (lowest to highest) · ★ = judges' quality of work, same 1–{max} scale.
            Individual votes and voter identities are never shown.
          </p>
          <p className="muted red-note">⚠️ This screen shows judge scores — keep it private (don't tick “make dashboard public” in /admin).</p>
        </section>

        <section className="panel wide">
          <h2>Vote counts</h2>
          {ranked.map((r) => (
            <div key={r.participant_id} className="bar-row">
              <span className="bar-label">{r.participant_name}</span>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.vote_count / maxCount) * 100}%` }} /></div>
              <span className="bar-value">{r.vote_count}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
