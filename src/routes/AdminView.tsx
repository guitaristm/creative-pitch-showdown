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
  const [rawToken, setRawToken] = useState('')
  const [tokenLabel, setTokenLabel] = useState('')
  const { toast, notify } = useToast()

  async function loadAll() {
    if (!supabase) return
    const [vs, ps, tk, sm] = await Promise.all([
      supabase.from('voting_state').select('*').eq('id', 1).single(),
      supabase.from('participants').select('*').order('pitch_order'),
      supabase.from('voting_tokens').select('id,token_hash,token_label,is_active').order('created_at'),
      supabase.from('current_participant_vote_summary').select('*'),
    ])
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
      .subscribe()
    const poll = setInterval(loadAll, 4000) // employee_votes isn't anon-readable → poll the summary
    return () => {
      supabase!.removeChannel(ch)
      clearInterval(poll)
    }
  }, [])

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
          <label>Current participant</label>
          <select value={state?.current_participant_id ?? ''} onChange={(e) => patchState({ current_participant_id: e.target.value || null })}>
            <option value="">— none (voters see “waiting”) —</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>#{p.pitch_order} {p.name} ({p.level})</option>
            ))}
          </select>
          <label>Voting mode</label>
          <div className="mode-buttons">
            <button className={state?.voting_mode === 'rating' ? 'active' : ''} onClick={() => patchState({ voting_mode: 'rating' })}>Rating 1–5</button>
            <button className={state?.voting_mode === 'like' ? 'active' : ''} onClick={() => patchState({ voting_mode: 'like' })}>Simple like</button>
          </div>
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
