// /vote — mobile-first employee voting. Never shows results or identities.
import { useEffect, useState } from 'react'
import { CRITERIA } from '../lib/scoring.ts'
import { supabase } from '../lib/supabase.ts'
import { MODE_MAX, RATING_LABELS, VOTING, type Participant, type VotingState } from '../lib/types.ts'

const CRIT_FIELDS = ['concept', 'visual', 'technical', 'business'] as const
type CritDraft = Record<(typeof CRIT_FIELDS)[number], number | null>
const emptyCrit: CritDraft = { concept: null, visual: null, technical: null, business: null }

interface MyVote {
  participant_id: string
  vote_value: number
  concept_score: number | null
  visual_score: number | null
  technical_score: number | null
  business_score: number | null
}

export default function VoteView() {
  const [tokenInput, setTokenInput] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [state, setState] = useState<VotingState | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [myVotes, setMyVotes] = useState<Map<string, MyVote>>(new Map())
  const [selected, setSelected] = useState<Participant | null>(null)
  const [crit, setCrit] = useState<CritDraft>(emptyCrit)

  // live voting state + participant list
  useEffect(() => {
    if (!supabase) return
    const load = async () => {
      const [{ data: vs }, { data: ps }] = await Promise.all([
        supabase!.from('voting_state').select('*').eq('id', 1).single(),
        supabase!.from('participants').select('*').order('pitch_order'),
      ])
      if (vs) setState(vs as VotingState)
      if (ps) setParticipants((ps as Participant[]).filter((p) => p.is_active !== false))
    }
    load()
    const ch = supabase
      .channel('vote')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voting_state' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, load)
      .subscribe()
    return () => {
      supabase!.removeChannel(ch)
    }
  }, [])

  async function refreshMyVotes(t = token) {
    if (!supabase || !t) return
    const { data } = await supabase.rpc('my_votes', { p_token: t })
    setMyVotes(new Map(((data as MyVote[]) ?? []).map((v) => [v.participant_id, v])))
  }

  // preload the form with this voter's existing score when they open someone
  useEffect(() => {
    if (!selected) return setCrit(emptyCrit)
    const v = myVotes.get(selected.id)
    setCrit(
      v && v.concept_score !== null
        ? { concept: v.concept_score, visual: v.visual_score, technical: v.technical_score, business: v.business_score }
        : emptyCrit,
    )
  }, [selected, myVotes])

  if (!supabase) return <div className="vote-wrap"><p className="vote-note">Voting is not configured yet.</p></div>

  async function continueToken() {
    setError('')
    setBusy(true)
    const { data, error: e } = await supabase!.rpc('validate_token', { p_token: tokenInput })
    setBusy(false)
    if (e) return setError('Could not reach the server. Try again.')
    if (!data) return setError('That code is not valid. Check it and try again.')
    const t = tokenInput.trim()
    setToken(t)
    refreshMyVotes(t)
  }

  function handleResult(data: unknown, e: unknown, name: string) {
    if (e) return setError('Could not submit. Try again.')
    if (data === 'ok' || data === 'updated') {
      setFlash(data === 'updated' ? `Score updated for ${name}.` : `Vote submitted for ${name}. Thank you!`)
      setSelected(null)
      refreshMyVotes()
      setTimeout(() => setFlash(''), 4000)
      return
    }
    // old DB function still installed — changing a vote needs the latest supabase/voting.sql
    if (data === 'duplicate') return setError('You already scored this participant. Ask staff to run the latest voting.sql to allow changes.')
    if (data === 'closed') return setError('Voting is closed — scores are locked.')
    if (data === 'invalid') return setError('Your code is no longer active.')
    setError('Something went wrong. Try again.')
  }

  async function castVote(value: number) {
    if (!selected) return
    setError('')
    setBusy(true)
    const { data, error: e } = await supabase!.rpc('submit_vote', { p_participant: selected.id, p_token: token, p_value: value })
    setBusy(false)
    handleResult(data, e, selected.name)
  }

  async function castCriteriaVote() {
    if (!selected || CRIT_FIELDS.some((f) => crit[f] === null)) return
    setError('')
    setBusy(true)
    const { data, error: e } = await supabase!.rpc('submit_criteria_vote', {
      p_participant: selected.id, p_token: token,
      p_concept: crit.concept, p_visual: crit.visual, p_technical: crit.technical, p_business: crit.business,
    })
    setBusy(false)
    handleResult(data, e, selected.name)
  }

  const mode = state?.voting_mode ?? 'rating'
  const open = state?.voting_open ?? false
  const maxLabel = mode === 'like' ? '' : `/${MODE_MAX[mode]}`

  return (
    <div className="vote-wrap">
      <div className="vote-head">
        <p className="vote-kicker">{VOTING.subtitle}</p>
        <h1 className="vote-title">{VOTING.title}</h1>
      </div>

      {/* 1. token entry */}
      {!token && (
        <div className="vote-card">
          <label className="vote-label">Enter your voting code</label>
          <input
            className="vote-input" value={tokenInput} autoFocus autoCapitalize="characters" autoCorrect="off"
            placeholder="EMP-XXXX-XXXX"
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && tokenInput && continueToken()}
          />
          {error && <p className="vote-error">{error}</p>}
          <button className="vote-btn primary" disabled={busy || !tokenInput.trim()} onClick={continueToken}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <p className="vote-note">Your code is anonymous. We store no names.</p>
        </div>
      )}

      {/* 2. participant list */}
      {token && !selected && (
        <div className="vote-card">
          {flash && <p className="vote-flash">✓ {flash}</p>}
          {!open && <p className="vote-note big">🔒 Voting is closed — scores are locked.</p>}
          {open && <p className="vote-note">Tap anyone to score them. You can change a score any time while voting is open.</p>}
          <div className="vote-list">
            {participants.map((p) => {
              const v = myVotes.get(p.id)
              const isNow = state?.current_participant_id === p.id
              return (
                <button key={p.id} className={`vote-item${isNow ? ' now' : ''}`} disabled={!open} onClick={() => { setError(''); setSelected(p) }}>
                  <span className="vote-item-main">
                    <span className="vote-item-name">{p.name}{isNow && <span className="now-tag">NOW</span>}</span>
                    <span className="vote-item-sub">{p.level} · #{p.pitch_order}</span>
                  </span>
                  {v ? <span className="vote-item-score">{v.vote_value}{maxLabel}</span> : <span className="vote-item-todo">{open ? 'vote' : '—'}</span>}
                </button>
              )
            })}
          </div>
          <p className="vote-note">{myVotes.size} of {participants.length} scored</p>
        </div>
      )}

      {/* 3. scoring a participant */}
      {token && selected && (
        <div className="vote-card">
          <button className="vote-back" onClick={() => setSelected(null)}>← All participants</button>
          <h2 className="vote-name">{selected.name}</h2>
          <p className="vote-sub">{selected.level}{selected.topic ? ` · ${selected.topic}` : ''}</p>
          {myVotes.has(selected.id) && (
            <p className="vote-note">You scored {myVotes.get(selected.id)!.vote_value}{maxLabel} — choose again to change it.</p>
          )}
          {mode === 'quality' ? (
            <>
              <p className="vote-label">Quality of work — tap a score</p>
              <div className="quality-grid">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                  <button key={v} className={`quality-btn${myVotes.get(selected.id)?.vote_value === v ? ' sel' : ''}`}
                    disabled={busy} onClick={() => castVote(v)}>{v}</button>
                ))}
              </div>
              <p className="vote-note">1 = needs more development · 10 = excellent</p>
            </>
          ) : mode === 'like' ? (
            <button className="vote-btn primary big" disabled={busy} onClick={() => castVote(1)}>👏 Vote for {selected.name}</button>
          ) : mode === 'criteria' ? (
            <>
              {CRITERIA.map((c, i) => {
                const field = CRIT_FIELDS[i]
                return (
                  <div key={c.key} className="crit-block">
                    <div className="crit-head"><span>{c.label}</span><span className="crit-max">/ {c.max}</span></div>
                    <div className="crit-btns">
                      {Array.from({ length: c.max + 1 }, (_, n) => (
                        <button key={n} className={crit[field] === n ? 'sel' : ''} disabled={busy}
                          onClick={() => setCrit((p) => ({ ...p, [field]: n }))}>{n}</button>
                      ))}
                    </div>
                  </div>
                )
              })}
              <div className="crit-total">Total <strong>{CRIT_FIELDS.reduce((s, f) => s + (crit[f] ?? 0), 0)}</strong> / 20</div>
              <button className="vote-btn primary" disabled={busy || CRIT_FIELDS.some((f) => crit[f] === null)} onClick={castCriteriaVote}>
                {busy ? 'Saving…' : CRIT_FIELDS.some((f) => crit[f] === null) ? 'Score all 4 criteria' : myVotes.has(selected.id) ? 'Update score' : 'Submit vote'}
              </button>
            </>
          ) : (
            <div className="rating-grid">
              {[1, 2, 3, 4, 5].map((v) => (
                <button key={v} className={`rating-btn${myVotes.get(selected.id)?.vote_value === v ? ' sel' : ''}`} disabled={busy} onClick={() => castVote(v)}>
                  <span className="rating-num">{v}</span>
                  <span className="rating-lbl">{RATING_LABELS[v]}</span>
                </button>
              ))}
            </div>
          )}
          {error && <p className="vote-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
