// /vote — mobile-first employee voting. Never shows results or identities.
import { useEffect, useState } from 'react'
import { CRITERIA } from '../lib/scoring.ts'
import { supabase } from '../lib/supabase.ts'
import { RATING_LABELS, VOTING, type Participant, type VotingState } from '../lib/types.ts'

const CRIT_FIELDS = ['concept', 'visual', 'technical', 'business'] as const
type CritDraft = Record<(typeof CRIT_FIELDS)[number], number | null>
const emptyCrit: CritDraft = { concept: null, visual: null, technical: null, business: null }

type Phase = 'token' | 'vote' | 'success'

export default function VoteView() {
  const [phase, setPhase] = useState<Phase>('token')
  const [tokenInput, setTokenInput] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [state, setState] = useState<VotingState | null>(null)
  const [current, setCurrent] = useState<Participant | null>(null)
  const [alreadyVoted, setAlreadyVoted] = useState(false)
  const [crit, setCrit] = useState<CritDraft>(emptyCrit)

  // live voting state + current participant
  useEffect(() => {
    if (!supabase) return
    const load = async () => {
      const { data: vs } = await supabase!.from('voting_state').select('*').eq('id', 1).single()
      if (!vs) return
      setState(vs as VotingState)
      if (vs.current_participant_id) {
        const { data: p } = await supabase!.from('participants').select('*').eq('id', vs.current_participant_id).single()
        setCurrent((p as Participant) ?? null)
      } else {
        setCurrent(null)
      }
    }
    load()
    const ch = supabase
      .channel('vote')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voting_state' }, load)
      .subscribe()
    return () => {
      supabase!.removeChannel(ch)
    }
  }, [])

  // when the current participant changes, check if this token already voted for them
  useEffect(() => {
    setAlreadyVoted(false)
    setCrit(emptyCrit)
    if (!supabase || !token || !current) return
    supabase.rpc('has_voted', { p_participant: current.id, p_token: token }).then(({ data }) => setAlreadyVoted(!!data))
  }, [token, current])

  if (!supabase)
    return <div className="vote-wrap"><p className="vote-note">Voting is not configured yet.</p></div>

  async function continueToken() {
    setError('')
    setBusy(true)
    const { data, error: e } = await supabase!.rpc('validate_token', { p_token: tokenInput })
    setBusy(false)
    if (e) return setError('Could not reach the server. Try again.')
    if (!data) return setError('That code is not valid. Check it and try again.')
    setToken(tokenInput.trim())
    setPhase('vote')
  }

  function handleResult(data: unknown, e: unknown) {
    if (e) return setError('Could not submit. Try again.')
    if (data === 'ok') return setPhase('success')
    if (data === 'duplicate') return setAlreadyVoted(true)
    if (data === 'closed') return setError('Voting just closed for this participant.')
    if (data === 'invalid') return setError('Your code is no longer active.')
    setError('Something went wrong. Try again.')
  }

  async function castVote(value: number) {
    if (!current) return
    setError('')
    setBusy(true)
    const { data, error: e } = await supabase!.rpc('submit_vote', { p_participant: current.id, p_token: token, p_value: value })
    setBusy(false)
    handleResult(data, e)
  }

  async function castCriteriaVote() {
    if (!current || CRIT_FIELDS.some((f) => crit[f] === null)) return
    setError('')
    setBusy(true)
    const { data, error: e } = await supabase!.rpc('submit_criteria_vote', {
      p_participant: current.id, p_token: token,
      p_concept: crit.concept, p_visual: crit.visual, p_technical: crit.technical, p_business: crit.business,
    })
    setBusy(false)
    handleResult(data, e)
  }

  const mode = state?.voting_mode ?? 'rating'

  return (
    <div className="vote-wrap">
      <div className="vote-head">
        <p className="vote-kicker">{VOTING.subtitle}</p>
        <h1 className="vote-title">{VOTING.title}</h1>
      </div>

      {phase === 'token' && (
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

      {phase === 'vote' && (
        <div className="vote-card">
          {!state?.voting_open ? (
            <p className="vote-note big">Voting is currently closed.<br />Please wait for the next pitch.</p>
          ) : !current ? (
            <p className="vote-note big">Waiting for the next participant…</p>
          ) : alreadyVoted ? (
            <div className="voted-box">
              <p className="voted-check">✓</p>
              <p className="vote-note big">You have already voted for</p>
              <h2 className="vote-name">{current.name}</h2>
              <p className="vote-note">Thanks! Wait for the next participant.</p>
            </div>
          ) : (
            <>
              <p className="vote-note">Now pitching</p>
              <h2 className="vote-name">{current.name}</h2>
              <p className="vote-sub">{current.level}{current.topic ? ` · ${current.topic}` : ''}</p>
              {mode === 'like' ? (
                <button className="vote-btn primary big" disabled={busy} onClick={() => castVote(1)}>
                  👏 Vote for {current.name}
                </button>
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
                  <div className="crit-total">
                    Total <strong>{CRIT_FIELDS.reduce((s, f) => s + (crit[f] ?? 0), 0)}</strong> / 20
                  </div>
                  <button className="vote-btn primary" disabled={busy || CRIT_FIELDS.some((f) => crit[f] === null)} onClick={castCriteriaVote}>
                    {busy ? 'Submitting…' : CRIT_FIELDS.some((f) => crit[f] === null) ? 'Score all 4 criteria' : 'Submit vote'}
                  </button>
                </>
              ) : (
                <div className="rating-grid">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button key={v} className="rating-btn" disabled={busy} onClick={() => castVote(v)}>
                      <span className="rating-num">{v}</span>
                      <span className="rating-lbl">{RATING_LABELS[v]}</span>
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="vote-error">{error}</p>}
            </>
          )}
        </div>
      )}

      {phase === 'success' && (
        <div className="vote-card">
          <p className="voted-check">✓</p>
          <h2 className="vote-name">Vote submitted</h2>
          <p className="vote-note big">Thank you for supporting the creators.</p>
          <button className="vote-btn primary" onClick={() => setPhase('vote')}>Back to voting</button>
        </div>
      )}
    </div>
  )
}
