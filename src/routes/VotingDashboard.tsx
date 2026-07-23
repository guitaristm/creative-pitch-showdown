// /dashboard — aggregated voting results. Never shows tokens or identities.
import { useEffect, useMemo, useState } from 'react'
import { AdminGate } from '../components/AdminGate.tsx'
import { supabase } from '../lib/supabase.ts'
import { VOTING, type Level, type ParticipantVoteSummary, type VotingState } from '../lib/types.ts'

const STAR_COLORS = ['#ff5c6c', '#ffa552', '#f5c542', '#8fd14f', '#3ecf8e']

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
  const [state, setState] = useState<VotingState | null>(null)
  const [filter, setFilter] = useState<Level | 'All'>('All')

  useEffect(() => {
    if (!supabase) return
    const load = async () => {
      const [sm, vs] = await Promise.all([
        supabase!.from('participant_vote_summary').select('*'),
        supabase!.from('voting_state').select('*').eq('id', 1).single(),
      ])
      setRows((sm.data as ParticipantVoteSummary[]) ?? [])
      if (vs.data) setState(vs.data as VotingState)
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

  const filtered = useMemo(() => rows.filter((r) => filter === 'All' || r.level === filter), [rows, filter])
  const ranked = useMemo(
    () => [...filtered].sort((a, b) =>
      Number(b.average_rating) - Number(a.average_rating) || b.vote_count - a.vote_count || a.participant_name.localeCompare(b.participant_name)),
    [filtered],
  )
  const maxCount = Math.max(1, ...filtered.map((r) => r.vote_count))
  const totalVotes = filtered.reduce((s, r) => s + r.vote_count, 0)

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
      </div>

      <div className="dash-grid">
        <section className="panel">
          <h2>Ranking</h2>
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Level</th><th>Avg</th><th>Votes</th></tr></thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.participant_id}>
                  <td>{i + 1}</td>
                  <td>{r.participant_name}</td>
                  <td>{r.level}</td>
                  <td><strong>{r.vote_count ? Number(r.average_rating).toFixed(2) : '—'}</strong></td>
                  <td>{r.vote_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Votes per participant</h2>
          {ranked.map((r) => (
            <div key={r.participant_id} className="bar-row">
              <span className="bar-label">{r.participant_name}</span>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.vote_count / maxCount) * 100}%` }} /></div>
              <span className="bar-value">{r.vote_count}</span>
            </div>
          ))}
        </section>

        <section className="panel wide">
          <h2>Rating distribution (1–5)</h2>
          {ranked.map((r) => {
            const counts = [r.rating_1_count, r.rating_2_count, r.rating_3_count, r.rating_4_count, r.rating_5_count]
            const total = counts.reduce((s, c) => s + c, 0)
            return (
              <div key={r.participant_id} className="dist-row">
                <span className="bar-label">{r.participant_name}</span>
                <div className="dist-track">
                  {counts.map((c, i) => c > 0 && (
                    <div key={i} className="dist-seg" title={`${i + 1}★: ${c}`}
                      style={{ width: `${(c / total) * 100}%`, background: STAR_COLORS[i] }}>{c}</div>
                  ))}
                  {total === 0 && <div className="dist-empty">no votes</div>}
                </div>
              </div>
            )
          })}
          <p className="muted">Colours: red 1★ → green 5★. Individual votes and voter identities are never shown.</p>
        </section>
      </div>
    </div>
  )
}
