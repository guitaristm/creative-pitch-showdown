// AUDIENCE VIEW — shown on projector. Never imports rankings, scores, or operator controls.
import { useEffect, useRef, useState } from 'react'
import { Fireworks } from '../components/Fireworks.tsx'
import { playCelebration, playDrumRoll } from '../lib/celebrate.ts'
import { playChime, unlockAudio } from '../lib/chime.ts'
import { isDirectVideo, toEmbedUrl, toVideoEmbedUrl } from '../lib/embed.ts'
import { supabase } from '../lib/supabase.ts'
import { AWARDS, EVENT, type DisplayState, type Participant, type VotingState } from '../lib/types.ts'

/** Seconds remaining when the "wrap up" chime sounds (1:30). */
const WARN_AT = 90

/** Drum roll length before the winner's name appears — the reveal lands on the crash. */
const DRUM_ROLL_SECONDS = 5

/** Only what the audience is allowed to see for the winner: final score, fetched on demand. */
async function fetchWinnerScore(participantId: string): Promise<number | null> {
  if (!supabase) return null
  const [{ data: scores }, { data: judges }] = await Promise.all([
    supabase.from('scores').select('judge_id,total_score').eq('participant_id', participantId),
    supabase.from('judges').select('id,judge_group'),
  ])
  if (!scores || !judges) return null
  const groupOf = new Map(judges.map((j) => [j.id, j.judge_group]))
  const jp = scores.filter((s) => groupOf.get(s.judge_id) === 'JP').reduce((sum, s) => sum + Number(s.total_score), 0)
  const th = scores.filter((s) => groupOf.get(s.judge_id) === 'TH')
  const thAvg = th.length ? th.reduce((sum, s) => sum + Number(s.total_score), 0) / th.length : 0
  return jp + thAvg
}

export default function AudienceView() {
  const [state, setState] = useState<DisplayState | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [winnerScore, setWinnerScore] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [vote, setVote] = useState<VotingState | null>(null)
  const [audioReady, setAudioReady] = useState(false)
  const chimedFor = useRef<string | null>(null)
  // 'rolling' = drum roll, name still hidden · 'party' = name revealed, fireworks + applause
  const [phase, setPhase] = useState<'idle' | 'rolling' | 'party'>('idle')
  // undefined until the first load: whatever value is already stored must NOT fire a celebration
  const celebratedAt = useRef<string | null | undefined>(undefined)
  const celebrating = phase === 'party'

  useEffect(() => {
    if (!supabase) return
    const load = async () => {
      const [{ data: ds }, { data: ps }, { data: vs }] = await Promise.all([
        supabase!.from('display_state').select('*').eq('id', 1).single(),
        supabase!.from('participants').select('*'),
        supabase!.from('voting_state').select('*').eq('id', 1).maybeSingle(),
      ])
      if (ds) setState(ds as DisplayState)
      if (ps) setParticipants(ps as Participant[])
      setVote((vs as VotingState) ?? null)
    }
    load()
    const channel = supabase
      .channel('audience')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'display_state' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voting_state' }, load)
      .subscribe()
    return () => {
      supabase!.removeChannel(channel)
    }
  }, [])

  // tick for the countdown timer
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  // browsers block sound until the page is interacted with — arm it on the first click/key
  useEffect(() => {
    const arm = () => setAudioReady(unlockAudio())
    window.addEventListener('click', arm)
    window.addEventListener('keydown', arm)
    return () => {
      window.removeEventListener('click', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [])

  useEffect(() => {
    setWinnerScore(null)
    if (state?.screen_mode === 'winner_reveal' && state.show_winner_score && state.reveal_participant_id) {
      fetchWinnerScore(state.reveal_participant_id).then(setWinnerScore)
    }
  }, [state?.screen_mode, state?.show_winner_score, state?.reveal_participant_id])

  // celebration fires when the operator bumps celebrate_at: drum roll first, name only at the crash.
  // Timings are anchored to the timestamp, so the reveal lands exactly DRUM_ROLL_SECONDS after the click.
  useEffect(() => {
    if (!state) return
    const stamp = state.celebrate_at ?? null
    // first sight of the row: remember it, don't replay an old celebration on page load
    if (celebratedAt.current === undefined) {
      celebratedAt.current = stamp
      return
    }
    if (!stamp || celebratedAt.current === stamp) return
    celebratedAt.current = stamp
    // Roll runs a full DRUM_ROLL_SECONDS from the moment this screen receives the trigger.
    // Deliberately not derived from the timestamp: operator and projector clocks differ.
    setPhase('rolling')
    playDrumRoll(DRUM_ROLL_SECONDS)
    const reveal = setTimeout(() => {
      setPhase('party')
      playCelebration(7)
    }, DRUM_ROLL_SECONDS * 1000)
    const settle = setTimeout(() => setPhase('idle'), DRUM_ROLL_SECONDS * 1000 + 7000)
    return () => {
      clearTimeout(reveal)
      clearTimeout(settle)
    }
  }, [state?.celebrate_at, !!state])

  // "wrap up" chime at 1:30 left — once per timer run (updated_at changes on every start/reset)
  useEffect(() => {
    if (!state?.timer_running || state.chime_enabled === false) return
    const left = state.timer_seconds - Math.floor((now - new Date(state.updated_at).getTime()) / 1000)
    const runId = `${state.current_participant_id}-${state.updated_at}`
    if (left <= WARN_AT && left > WARN_AT - 5 && chimedFor.current !== runId) {
      chimedFor.current = runId
      playChime()
    }
  }, [now, state?.timer_running, state?.timer_seconds, state?.updated_at, state?.current_participant_id, state?.chime_enabled])

  if (!supabase) return <div className="audience center"><p className="aud-note">Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p></div>
  if (!state) return <div className="audience center"><p className="aud-note">Connecting…</p></div>

  const byId = (id: string | null | undefined) => participants.find((p) => p.id === id)
  const current = byId(state.current_participant_id)
  const winner = byId(state.reveal_participant_id)
  const award = AWARDS.find((a) => a.key === state.selected_award)

  // updated_at is only bumped by timer start/reset (see OperatorView.saveDisplay), so it anchors the countdown
  const elapsed = state.timer_running ? Math.floor((now - new Date(state.updated_at).getTime()) / 1000) : 0
  const remaining = Math.max(0, state.timer_seconds - elapsed)
  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
  const warning = state.timer_running && remaining <= WARN_AT && remaining > 0

  // Computed during render: a brand-new trigger must hide the name on the FIRST frame.
  // Waiting for the effect (which runs after paint) would flash the winner for one frame.
  const freshTrigger =
    celebratedAt.current !== undefined && !!state.celebrate_at && state.celebrate_at !== celebratedAt.current
  const rolling = phase === 'rolling' || freshTrigger

  // operator-run voting window — a banner over whatever screen is showing
  const voteLeft =
    vote?.vote_timer_running && vote.vote_timer_started_at
      ? Math.max(0, (vote.vote_timer_seconds ?? 15) - Math.floor((now - new Date(vote.vote_timer_started_at).getTime()) / 1000))
      : null
  const voteBanner = voteLeft !== null && voteLeft > 0 && (
    <div className="vote-banner">
      <span className="vote-banner-text">VOTE NOW</span>
      <span className="vote-banner-count">{voteLeft}</span>
    </div>
  )

  // A shared deck takes over the whole screen (work-sample review, briefing) — no name, but keep the timer.
  if (state.shared_slide_url) {
    return (
      <div className="audience">
        {voteBanner}
        <div className="pitch-stage">
          <div className="pitch-bar">
            <span className="pitch-name">{current ? current.name : EVENT.name}</span>
            <span className={warning ? 'pitch-timer warn' : 'pitch-timer'}>{mmss}</span>
          </div>
          {/* no allowFullScreen: a fullscreened deck would cover the timer bar (nothing outside it renders) */}
          <iframe className="slide-frame" src={toEmbedUrl(state.shared_slide_url)} title="Shared slides" />
        </div>
      </div>
    )
  }

  return (
    <div className="audience">
      {voteBanner}
      {celebrating && <Fireworks seconds={7} />}
      {state.screen_mode === 'opening' && (
        <div className="center fade-in">
          <p className="aud-kicker">{EVENT.subtitle}</p>
          <h1 className="aud-title">{EVENT.name}</h1>
          <p className="aud-date">{EVENT.date}</p>
          <p className="aud-process">{EVENT.process}</p>
        </div>
      )}

      {state.screen_mode === 'now_pitching' && current && (current.slide_url || (state.show_video && current.video_url)) && (
        <div className="pitch-stage fade-in">
          <div className="pitch-bar">
            <span className="pitch-name">{current.name}<span className="pitch-meta"> · {current.level} · Pitch #{current.pitch_order}</span></span>
            <span className={warning ? 'pitch-timer warn' : 'pitch-timer'}>{mmss}</span>
          </div>
          {state.show_video && current.video_url ? (
            // keyed by URL: a <video> keeps showing the previously loaded clip if only src changes
            isDirectVideo(current.video_url) ? (
              <video key={current.video_url} className="slide-frame" src={current.video_url} controls playsInline />
            ) : (
              <iframe key={current.video_url} className="slide-frame" src={toVideoEmbedUrl(current.video_url)} allow="autoplay; fullscreen" allowFullScreen title={`${current.name} output video`} />
            )
          ) : (
            /* no allowFullScreen — see shared-slide note above */
            <iframe key={current.slide_url!} className="slide-frame" src={toEmbedUrl(current.slide_url!)} allow="autoplay" title={`${current.name} slides`} />
          )}
        </div>
      )}

      {state.screen_mode === 'now_pitching' && !current?.slide_url && !(state.show_video && current?.video_url) && (
        <div className="center fade-in">
          <p className="aud-kicker">Now Pitching</p>
          <h1 className="aud-title">{current?.name ?? '—'}</h1>
          <p className="aud-sub">
            {current ? `${current.level} · Pitch #${current.pitch_order}` : ''}
          </p>
          {current?.topic && <p className="aud-topic">“{current.topic}”</p>}
          <div className={warning ? 'aud-timer warn' : 'aud-timer'}>{mmss}</div>
          <p className="aud-note">Output video max 1 min</p>
          {!audioReady && state.chime_enabled !== false && (
            <p className="aud-note dim">🔇 Click anywhere to enable the 1:30 reminder sound</p>
          )}
        </div>
      )}

      {state.screen_mode === 'scoring' && (
        <div className="center fade-in">
          <p className="aud-kicker">Scoring in Progress</p>
          <h1 className="aud-title-md">{current?.name ?? ''}</h1>
          <div className="aud-cards">
            <div className="aud-card">📋 Score sheets collected</div>
            <div className="aud-card">⌨️ Staff input in progress</div>
            <div className="aud-card">✅ Verification pending</div>
          </div>
        </div>
      )}

      {state.screen_mode === 'winner_reveal' && rolling && (
        <div className="center suspense">
          <p className="aud-kicker gold">{award?.label ?? 'Award'}</p>
          <h1 className="aud-title-md suspense-text">AND THE WINNER IS…</h1>
          <div className="drum-dots"><span /><span /><span /></div>
        </div>
      )}

      {state.screen_mode === 'winner_reveal' && !rolling && (
        <div className={celebrating ? 'center reveal celebrating' : 'center reveal'}>
          <p className="aud-kicker gold">{award?.label ?? 'Award'}</p>
          <h1 className="aud-title gold">{winner?.name ?? '…'}</h1>
          {winner && <p className="aud-sub">{winner.level}</p>}
          {state.show_winner_score && winnerScore !== null && (
            <p className="aud-score">{Number(winnerScore.toFixed(1))} / 100</p>
          )}
        </div>
      )}
    </div>
  )
}
