// AUDIENCE VIEW — shown on projector. Never imports rankings, scores, or operator controls.
import { useEffect, useState } from 'react'
import { isDirectVideo, toEmbedUrl, toVideoEmbedUrl } from '../lib/embed.ts'
import { supabase } from '../lib/supabase.ts'
import { AWARDS, EVENT, type DisplayState, type Participant } from '../lib/types.ts'

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

  useEffect(() => {
    if (!supabase) return
    const load = async () => {
      const [{ data: ds }, { data: ps }] = await Promise.all([
        supabase!.from('display_state').select('*').eq('id', 1).single(),
        supabase!.from('participants').select('*'),
      ])
      if (ds) setState(ds as DisplayState)
      if (ps) setParticipants(ps as Participant[])
    }
    load()
    const channel = supabase
      .channel('audience')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'display_state' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, load)
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

  useEffect(() => {
    setWinnerScore(null)
    if (state?.screen_mode === 'winner_reveal' && state.show_winner_score && state.reveal_participant_id) {
      fetchWinnerScore(state.reveal_participant_id).then(setWinnerScore)
    }
  }, [state?.screen_mode, state?.show_winner_score, state?.reveal_participant_id])

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

  return (
    <div className="audience">
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
            <span className="pitch-timer">{mmss}</span>
          </div>
          {state.show_video && current.video_url ? (
            isDirectVideo(current.video_url) ? (
              <video key="video" className="slide-frame" src={current.video_url} controls playsInline />
            ) : (
              <iframe key="video" className="slide-frame" src={toVideoEmbedUrl(current.video_url)} allow="autoplay; fullscreen" allowFullScreen title={`${current.name} output video`} />
            )
          ) : (
            <iframe key="slides" className="slide-frame" src={toEmbedUrl(current.slide_url!)} allow="autoplay; fullscreen" allowFullScreen title={`${current.name} slides`} />
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
          <div className="aud-timer">{mmss}</div>
          <p className="aud-note">Output video max 1 min</p>
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

      {state.screen_mode === 'winner_reveal' && (
        <div className="center reveal">
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
