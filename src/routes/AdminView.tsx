// /admin — staff controls for the employee voting layer. Passcode-gated.
import { useEffect, useState } from 'react'
import { AdminGate } from '../components/AdminGate.tsx'
import { Toast, useToast } from '../components/Toast.tsx'
import { supabase } from '../lib/supabase.ts'
import type { Participant, ParticipantVoteSummary, VotingState, VotingToken } from '../lib/types.ts'

export default function AdminView() {
  return (
    <AdminGate label="Voting Admin">
      <AdminInner />
    </AdminGate>
  )
}

function AdminInner() {
  const [state, setState] = useState<VotingState | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [tokens, setTokens] = useState<VotingToken[]>([])
  const [summary, setSummary] = useState<ParticipantVoteSummary[]>([])
  const [turnout, setTurnout] = useState<{ token_label: string | null; is_active: boolean; votes_cast: number }[]>([])
  const [operatorCurrentId, setOperatorCurrentId] = useState<string | null>(null)
  const [autoFollow, setAutoFollow] = useState(() => localStorage.getItem('vote_follow_operator') === '1')
  const [now, setNow] = useState(Date.now())
  const [windowSecs, setWindowSecs] = useState(15)
  // score-level data stays unloaded until deliberately revealed — this screen gets opened in rooms
  const [scoreRows, setScoreRows] = useState<{ token_label: string; participant_name: string; vote_value: number; created_at: string }[] | null>(null)
  const [codeFilter, setCodeFilter] = useState('')
  const [pitcherFilter, setPitcherFilter] = useState('')
  const [rawToken, setRawToken] = useState('')
  const [tokenLabel, setTokenLabel] = useState('')
  const { toast, notify } = useToast()

  async function loadAll() {
    if (!supabase) return
    const [vs, ps, tk, sm, to, ds] = await Promise.all([
      supabase.from('voting_state').select('*').eq('id', 1).single(),
      supabase.from('participants').select('*').order('pitch_order'),
      supabase.from('voting_tokens').select('id,token_hash,token_label,is_active').order('created_at'),
      supabase.from('current_participant_vote_summary').select('*'),
      supabase.from('token_turnout').select('token_label,is_active,votes_cast').order('token_label'),
      supabase.from('display_state').select('current_participant_id').eq('id', 1).single(),
    ])
    setTurnout((to.data as typeof turnout) ?? [])
    setOperatorCurrentId((ds.data?.current_participant_id as string | null) ?? null)
    if (vs.data) setState(vs.data as VotingState)
    if (ps.data) setParticipants(ps.data as Participant[])
    if (tk.data) setTokens(tk.data as VotingToken[])
    setSummary((sm.data as ParticipantVoteSummary[]) ?? [])
  }

  useEffect(() => {
    loadAll()
    if (!supabase) return
    const ch = supabase
      .channel('admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voting_state' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'display_state' }, loadAll)
      .subscribe()
    const poll = setInterval(loadAll, 4000) // employee_votes isn't anon-readable → poll the summary
    return () => {
      supabase!.removeChannel(ch)
      clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (state?.vote_timer_seconds) setWindowSecs(state.vote_timer_seconds)
  }, [state?.vote_timer_seconds])

  // follow the operator's current participant, so voters always rate whoever is on screen
  useEffect(() => {
    if (!autoFollow || !state || !operatorCurrentId) return
    if (operatorCurrentId !== state.current_participant_id) patchState({ current_participant_id: operatorCurrentId })
  }, [autoFollow, operatorCurrentId, state?.current_participant_id])

  const voteLeft =
    state?.vote_timer_running && state.vote_timer_started_at
      ? Math.max(0, (state.vote_timer_seconds ?? 15) - Math.floor((now - new Date(state.vote_timer_started_at).getTime()) / 1000))
      : null

  // when the window runs out, close voting automatically (this page is always open during the event)
  useEffect(() => {
    if (voteLeft === 0 && state?.vote_timer_running) {
      patchState({ vote_timer_running: false, voting_open: false })
    }
  }, [voteLeft])

  if (!supabase) return <div className="operator"><div className="op-warning">Supabase is not configured.</div></div>

  async function patchState(patch: Partial<VotingState>) {
    const next = { ...patch, updated_at: new Date().toISOString() }
    const { error } = await supabase!.from('voting_state').update(next).eq('id', 1)
    if (error) notify({ kind: 'error', text: error.message })
    else {
      setState((p) => (p ? { ...p, ...next } as VotingState : p))
      notify({ kind: 'success', text: 'Voting state saved.' })
    }
  }

  async function resetVotes() {
    if (!window.confirm('Delete ALL employee votes? Use this to clear trial votes before the event. This cannot be undone.')) return
    const { data, error } = await supabase!.rpc('reset_votes')
    if (error)
      notify({ kind: 'error', text: error.message.includes('reset_votes') ? 'Run the latest supabase/voting.sql first (adds reset_votes).' : error.message })
    else if (data === 'voting_open') notify({ kind: 'error', text: 'Close voting first — refusing to wipe a live tally.' })
    else {
      notify({ kind: 'success', text: 'All votes deleted.' })
      loadAll()
    }
  }

  async function loadScoresByCode() {
    const { data, error } = await supabase!.from('votes_by_token').select('*').order('token_label').order('pitch_order')
    if (error) {
      notify({ kind: 'error', text: /votes_by_token/.test(error.message) ? 'Missing view — run the votes_by_token block from supabase/voting.sql.' : error.message })
      return
    }
    setScoreRows((data as typeof scoreRows) ?? [])
  }

  function downloadScoresCsv() {
    if (!scoreRows?.length) return
    const csv = ['code,pitcher,score,time', ...scoreRows.map((r) => `${r.token_label},${r.participant_name},${r.vote_value},${r.created_at}`)].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `votes-by-code-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function addToken() {
    if (!rawToken.trim()) return
    const { data, error } = await supabase!.rpc('add_token', { p_raw: rawToken, p_label: tokenLabel || null })
    if (error) notify({ kind: 'error', text: error.message.includes('add_token') ? 'Run supabase/voting.sql first.' : error.message })
    else if (data !== 'ok') notify({ kind: 'error', text: 'Token was empty.' })
    else {
      notify({ kind: 'success', text: 'Token added.' })
      setRawToken('')
      setTokenLabel('')
      loadAll()
    }
  }

  async function toggleToken(t: VotingToken) {
    const { error } = await supabase!.from('voting_tokens').update({ is_active: !t.is_active }).eq('id', t.id)
    if (error) notify({ kind: 'error', text: error.message })
    else loadAll()
  }

  async function updateParticipant(id: string, patch: Partial<Participant>) {
    const { error } = await supabase!.from('participants').update(patch).eq('id', id)
    if (error) notify({ kind: 'error', text: error.message })
    else loadAll()
  }

  const activeTokens = tokens.filter((t) => t.is_active).length
  const activeTurnout = turnout.filter((t) => t.is_active)
  const voted = activeTurnout.filter((t) => t.votes_cast > 0).length
  const notVoted = activeTurnout.filter((t) => t.votes_cast === 0)
  const totalVotes = activeTurnout.reduce((s, t) => s + t.votes_cast, 0)
  const visibleScores = (scoreRows ?? []).filter(
    (r) => (!codeFilter || r.token_label === codeFilter) && (!pitcherFilter || r.participant_name === pitcherFilter),
  )
  const cur = summary[0]

  return (
    <div className="operator">
      <Toast toast={toast} />
      <div className="op-warning">🔒 Voting admin — staff only. Do not project this screen.</div>
      <div className="op-grid">
        <section className="panel">
          <h2>Voting Control</h2>
          <label className="check">
            <input type="checkbox" checked={state?.voting_open ?? false} onChange={(e) => patchState({ voting_open: e.target.checked })} />
            Voting open
          </label>
          <label>Current participant (who voters rate)</label>
          <select value={state?.current_participant_id ?? ''} onChange={(e) => patchState({ current_participant_id: e.target.value || null })}>
            <option value="">— none (voters see “waiting”) —</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>#{p.pitch_order} {p.name} ({p.level})</option>
            ))}
          </select>
          <div className="row slide-row">
            <span className="muted">
              Operator screen: <strong>{participants.find((p) => p.id === operatorCurrentId)?.name ?? 'none'}</strong>
              {operatorCurrentId && operatorCurrentId === state?.current_participant_id && ' ✓ in sync'}
            </span>
            {operatorCurrentId && operatorCurrentId !== state?.current_participant_id && (
              <button className="primary" onClick={() => patchState({ current_participant_id: operatorCurrentId })}>
                ⇄ Sync from operator
              </button>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={autoFollow}
              onChange={(e) => { setAutoFollow(e.target.checked); localStorage.setItem('vote_follow_operator', e.target.checked ? '1' : '0') }} />
            Auto-follow the operator's current participant
          </label>
          <label>Voting mode</label>
          <div className="mode-buttons">
            <button className={state?.voting_mode === 'quality' ? 'active' : ''} onClick={() => patchState({ voting_mode: 'quality' })}>Quality of work /10</button>
            <button className={state?.voting_mode === 'rating' ? 'active' : ''} onClick={() => patchState({ voting_mode: 'rating' })}>Rating 1–5</button>
            <button className={state?.voting_mode === 'criteria' ? 'active' : ''} onClick={() => patchState({ voting_mode: 'criteria' })}>Judge-style /20</button>
            <button className={state?.voting_mode === 'like' ? 'active' : ''} onClick={() => patchState({ voting_mode: 'like' })}>Simple like</button>
          </div>
          <p className="muted">Don’t switch modes mid-event — mixed vote scales make averages meaningless. Wipe votes first if you must switch.</p>
          <label>Voting window after each pitch</label>
          <div className="row slide-row">
            <input type="number" min={5} max={300} className="order-input" value={windowSecs}
              onChange={(e) => setWindowSecs(Number(e.target.value) || 15)} /> <span className="muted">seconds</span>
            {state?.vote_timer_running ? (
              <>
                <span className="timer-display">{voteLeft ?? 0}s</span>
                <button className="danger" onClick={() => patchState({ vote_timer_running: false, voting_open: false })}>■ Stop now</button>
              </>
            ) : (
              <button className="primary" onClick={() => patchState({
                vote_timer_seconds: windowSecs, vote_timer_running: true,
                vote_timer_started_at: new Date().toISOString(), voting_open: true,
              })}>▶ Start voting window</button>
            )}
          </div>
          <p className="muted">Start opens voting and shows a countdown on the audience screen; it closes automatically when time is up (or press Stop).</p>
          <label className="check">
            <input type="checkbox" checked={state?.show_dashboard ?? false} onChange={(e) => patchState({ show_dashboard: e.target.checked })} />
            Make /dashboard public (no passcode)
          </label>
        </section>

        <section className="panel">
          <h2>Live Voting Status</h2>
          {cur ? (
            <ul className="health">
              <li>Current: <strong>{cur.participant_name}</strong></li>
              <li>Votes received: <strong>{cur.vote_count}</strong></li>
              <li>Unique voters: <strong>{cur.vote_count}</strong> (one per token)</li>
              <li>Average rating: <strong>{cur.vote_count ? Number(cur.average_rating).toFixed(2) : '—'}</strong></li>
            </ul>
          ) : (
            <p className="muted">No current participant selected.</p>
          )}
          <p className="muted">Voting is {state?.voting_open ? '🟢 open' : '🔴 closed'}.</p>
          <h2 style={{ marginTop: '1.2rem' }}>Testing / Rehearsal <span className="badge red">danger</span></h2>
          <button className="danger" onClick={resetVotes} disabled={state?.voting_open}>🗑 Reset all employee votes</button>
          <p className="muted">{state?.voting_open ? 'Close voting to enable this.' : 'Clears every vote — use after rehearsal, before the real event.'}</p>
        </section>

        <section className="panel">
          <h2>Turnout <span className="badge">{voted} / {activeTokens} codes voted</span></h2>
          <ul className="health">
            <li>Codes that have voted: <strong>{voted}</strong></li>
            <li>Codes with no votes yet: <strong>{notVoted.length}</strong></li>
            <li>Total votes cast: <strong>{totalVotes}</strong></li>
          </ul>
          {!turnout.length ? (
            <p className="muted">Missing view — run the <code>token_turnout</code> block from supabase/voting.sql to enable turnout tracking.</p>
          ) : notVoted.length > 0 ? (
            <>
              <label>Not voted yet — chase these codes</label>
              <div className="chase-list">
                {notVoted.map((t) => <span key={t.token_label} className="chip">{t.token_label}</span>)}
              </div>
            </>
          ) : (
            <p className="muted">Every active code has voted at least once. 🎉</p>
          )}
          <p className="muted">Shows activity per code only — never what anyone voted.</p>
        </section>

        <section className="panel wide">
          <h2>Scores by Code <span className="badge red">shows how each code voted</span></h2>
          {scoreRows === null ? (
            <>
              <p className="muted">Hidden by default — this reveals what every code scored each pitcher.</p>
              <button className="ghost" onClick={loadScoresByCode}>👁 Reveal scores by code</button>
            </>
          ) : (
            <>
              <div className="row slide-row">
                <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
                  <option value="">All codes</option>
                  {[...new Set(scoreRows.map((r) => r.token_label))].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={pitcherFilter} onChange={(e) => setPitcherFilter(e.target.value)}>
                  <option value="">All pitchers</option>
                  {[...new Set(scoreRows.map((r) => r.participant_name))].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="ghost" onClick={downloadScoresCsv}>⬇ CSV</button>
                <button className="ghost" onClick={() => { setScoreRows(null); setCodeFilter(''); setPitcherFilter('') }}>Hide</button>
              </div>
              <p className="muted">{visibleScores.length} of {scoreRows.length} votes shown</p>
              <table>
                <thead><tr><th>Code</th><th>Pitcher</th><th>Score</th><th>Time</th></tr></thead>
                <tbody>
                  {visibleScores.slice(0, 200).map((r, i) => (
                    <tr key={i}>
                      <td>{r.token_label}</td>
                      <td>{r.participant_name}</td>
                      <td><strong>{r.vote_value}</strong></td>
                      <td className="muted">{new Date(r.created_at).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                  {!visibleScores.length && <tr><td colSpan={4} className="muted">No votes yet.</td></tr>}
                </tbody>
              </table>
              {visibleScores.length > 200 && <p className="muted">Showing first 200 — use the filters or CSV for the rest.</p>}
            </>
          )}
        </section>

        <section className="panel wide">
          <h2>Token Management <span className="badge">{activeTokens} active</span></h2>
          <div className="row slide-row">
            <input className="vote-input inline" placeholder="Raw token e.g. EMP-7KQ2-MN9A" value={rawToken} onChange={(e) => setRawToken(e.target.value)} />
            <input className="vote-input inline" placeholder="Label (non-identifying)" value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} />
            <button onClick={addToken}>Add token</button>
          </div>
          <p className="muted">Raw tokens are hashed on the server — only the hash is stored. Generate a batch with <code>scripts/generateTokens.ts</code>.</p>
          <table>
            <thead><tr><th>Label</th><th>Hash (first 12)</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.token_label ?? '—'}</td>
                  <td className="muted">{t.token_hash.slice(0, 12)}…</td>
                  <td>{t.is_active ? '🟢' : '⚪'}</td>
                  <td><button className="ghost" onClick={() => toggleToken(t)}>{t.is_active ? 'Deactivate' : 'Reactivate'}</button></td>
                </tr>
              ))}
              {!tokens.length && <tr><td colSpan={4} className="muted">No tokens yet.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="panel wide">
          <h2>Participant Management</h2>
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Level</th><th>Topic</th><th>Active</th></tr></thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.id} className={p.is_active === false ? 'missing' : ''}>
                  <td>{p.pitch_order}</td>
                  <td>{p.name}</td>
                  <td>{p.level}</td>
                  <td>
                    <input className="vote-input inline" defaultValue={p.topic ?? ''} placeholder="topic"
                      onBlur={(e) => e.target.value !== (p.topic ?? '') && updateParticipant(p.id, { topic: e.target.value || null })} />
                  </td>
                  <td><input type="checkbox" checked={p.is_active !== false} onChange={(e) => updateParticipant(p.id, { is_active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Reorder / rename participants in the Operator view. Inactive participants are hidden from voters.</p>
        </section>
      </div>
    </div>
  )
}
