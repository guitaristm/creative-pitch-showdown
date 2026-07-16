// OPERATOR VIEW — private. Never show this route on the projector.
import { useEffect, useMemo, useState } from 'react'
import { Toast, useToast } from '../components/Toast.tsx'
import { CRITERIA, calculateParticipantScore, calculateRankings, calculateSuggestedAwards, validateScore } from '../lib/scoring.ts'
import { supabase } from '../lib/supabase.ts'
import { AWARDS, type DisplayState, type Judge, type Participant, type Score, type ScreenMode } from '../lib/types.ts'

interface Draft {
  concept: string
  visual: string
  technical: string
  business: string
  comment: string
  verified: boolean
  saved: boolean
}
const emptyDraft: Draft = { concept: '', visual: '', technical: '', business: '', comment: '', verified: false, saved: false }

const SCREEN_MODES: { value: ScreenMode; label: string }[] = [
  { value: 'opening', label: 'Opening' },
  { value: 'now_pitching', label: 'Now Pitching' },
  { value: 'scoring', label: 'Scoring in Progress' },
  { value: 'winner_reveal', label: 'Winner Reveal' },
]

export default function OperatorView() {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [judges, setJudges] = useState<Judge[]>([])
  const [scores, setScores] = useState<Score[]>([])
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map())
  const [consensus, setConsensus] = useState<Map<string, number>>(new Map())
  const [display, setDisplay] = useState<DisplayState | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [slideDraft, setSlideDraft] = useState('')
  const [videoDraft, setVideoDraft] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(Date.now())
  const { toast, notify } = useToast()

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  async function loadAll() {
    if (!supabase) return
    const [ps, js, sc, ds, ov, fc] = await Promise.all([
      supabase.from('participants').select('*').order('pitch_order'),
      supabase.from('judges').select('*').order('judge_code'),
      supabase.from('scores').select('*'),
      supabase.from('display_state').select('*').eq('id', 1).single(),
      supabase.from('award_overrides').select('*'),
      supabase.from('final_consensus').select('*'),
    ])
    if (ps.error || js.error) {
      setConnected(false)
      return
    }
    setConnected(true)
    setLastRefresh(new Date())
    setParticipants((ps.data as Participant[]) ?? [])
    setJudges((js.data as Judge[]) ?? [])
    setScores((sc.data as Score[]) ?? [])
    if (ds.data) setDisplay(ds.data as DisplayState)
    setOverrides(new Map((ov.data ?? []).filter((o) => o.participant_id).map((o) => [o.award_key, o.participant_id])))
    setConsensus(new Map((fc.data ?? []).map((c) => [c.participant_id, c.consensus_rank_adjustment ?? 0])))
  }

  useEffect(() => {
    loadAll()
    if (!supabase) {
      setConnected(false)
      return
    }
    const channel = supabase
      .channel('operator')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'display_state' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'award_overrides' }, loadAll)
      .subscribe()
    return () => {
      supabase!.removeChannel(channel)
    }
  }, [])

  // load drafts from saved scores whenever the selected participant (or scores) change
  useEffect(() => {
    if (!selectedId) return
    const next: Record<string, Draft> = {}
    for (const j of judges) {
      const s = scores.find((x) => x.participant_id === selectedId && x.judge_id === j.id)
      next[j.id] = s
        ? { concept: String(s.concept_score), visual: String(s.visual_score), technical: String(s.technical_score), business: String(s.business_score), comment: s.comment ?? '', verified: s.verified, saved: true }
        : { ...emptyDraft }
    }
    setDrafts(next)
  }, [selectedId, scores, judges])

  const currentId = display?.current_participant_id ?? null
  useEffect(() => {
    const p = participants.find((x) => x.id === currentId)
    setSlideDraft(p?.slide_url ?? '')
    setVideoDraft(p?.video_url ?? '')
  }, [currentId, participants])

  const selected = participants.find((p) => p.id === selectedId)
  const rankings = useMemo(() => calculateRankings(participants, scores, judges, consensus), [participants, scores, judges, consensus])
  const awards = useMemo(() => calculateSuggestedAwards(rankings, overrides), [rankings, overrides])
  const awardOf = (pid: string) => AWARDS.filter((a) => awards.get(a.key) === pid).map((a) => a.label).join(', ')
  const nameOf = (pid: string | null | undefined) => participants.find((p) => p.id === pid)?.name ?? '—'

  function draftRowFilled(d: Draft) {
    return d.concept !== '' || d.visual !== '' || d.technical !== '' || d.business !== ''
  }
  function draftToScore(judgeId: string, d: Draft): Score {
    return {
      participant_id: selectedId,
      judge_id: judgeId,
      concept_score: Number(d.concept || 0),
      visual_score: Number(d.visual || 0),
      technical_score: Number(d.technical || 0),
      business_score: Number(d.business || 0),
      comment: d.comment || null,
      input_by: 'operator',
      verified: d.verified,
    }
  }

  async function saveScores() {
    if (!supabase || !selectedId) return
    const rows: Score[] = []
    for (const j of judges) {
      const d = drafts[j.id]
      if (!d || !draftRowFilled(d)) continue
      const row = draftToScore(j.id, d)
      const errors = validateScore(row)
      if (errors.length) {
        notify({ kind: 'error', text: `${j.name}: ${errors.join(', ')}` })
        return
      }
      rows.push(row)
    }
    if (!rows.length) {
      notify({ kind: 'error', text: 'No scores entered yet.' })
      return
    }
    setSaving(true)
    const { error } = await supabase.from('scores').upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'participant_id,judge_id' },
    )
    setSaving(false)
    if (error) notify({ kind: 'error', text: `Save failed: ${error.message}` })
    else {
      notify({ kind: 'success', text: `Saved ${rows.length} judge score(s) for ${selected?.name}.` })
      loadAll()
    }
  }

  async function saveDisplay(patch: Partial<DisplayState>) {
    if (!supabase || !display) return
    // patch only the changed fields — writing the whole row races with rapid consecutive edits.
    // updated_at is the audience timer anchor: bump it only on timer operations, otherwise
    // unrelated edits mid-pitch (e.g. pre-selecting the reveal award) restart the countdown.
    const changes: Partial<DisplayState> = { ...patch }
    if ('timer_seconds' in patch || 'timer_running' in patch) changes.updated_at = new Date().toISOString()
    let { error } = await supabase.from('display_state').update(changes).eq('id', 1)
    if (error?.message.includes('show_video')) {
      // column not migrated yet — save the rest, surface the migration hint only if the toggle itself was used
      delete changes.show_video
      if (Object.keys(changes).length) ({ error } = await supabase.from('display_state').update(changes).eq('id', 1))
      if ('show_video' in patch && Object.keys(patch).length === 1) {
        notify({ kind: 'error', text: 'Missing column — run in Supabase SQL editor: alter table display_state add column show_video boolean default false;' })
        return
      }
    }
    if (error) notify({ kind: 'error', text: `Display update failed: ${error.message}` })
    else {
      setDisplay((prev) => (prev ? { ...prev, ...changes } : prev))
      notify({ kind: 'success', text: 'Display state saved — audience screen updated.' })
    }
  }

  async function saveOverride(awardKey: string, participantId: string) {
    if (!supabase) return
    const { error } = participantId
      ? await supabase.from('award_overrides').upsert({ award_key: awardKey, participant_id: participantId, updated_at: new Date().toISOString() }, { onConflict: 'award_key' })
      : await supabase.from('award_overrides').delete().eq('award_key', awardKey)
    if (error) notify({ kind: 'error', text: `Override failed: ${error.message}` })
    else {
      notify({ kind: 'success', text: participantId ? 'Award override saved.' : 'Override cleared — back to auto.' })
      loadAll()
    }
  }

  async function saveParticipantLink(field: 'slide_url' | 'video_url', value: string) {
    if (!supabase || !currentId) return
    // .select() so an RLS-blocked update (0 rows, no error) is detected instead of silently "succeeding"
    const { data, error } = await supabase.from('participants').update({ [field]: value.trim() || null }).eq('id', currentId).select()
    if (error)
      notify({ kind: 'error', text: error.message.includes(field) ? `Missing column — run in Supabase SQL editor: alter table participants add column ${field} text;` : `Save failed: ${error.message}` })
    else if (!data?.length)
      notify({ kind: 'error', text: 'Save blocked — run in Supabase SQL editor: create policy "anon write participants" on participants for update using (true) with check (true);' })
    else {
      notify({ kind: 'success', text: field === 'slide_url' ? 'Presentation link saved.' : 'Output video link saved.' })
      loadAll()
    }
  }

  async function uploadVideo(file: File) {
    if (!supabase || !currentId) return
    setUploading(true)
    const code = participants.find((p) => p.id === currentId)?.participant_code ?? currentId
    const path = `${code}-${Date.now()}.${file.name.split('.').pop() || 'mp4'}`
    const { error } = await supabase.storage.from('videos').upload(path, file, { upsert: true, contentType: file.type || 'video/mp4' })
    setUploading(false)
    if (error) {
      notify({
        kind: 'error',
        text: /bucket|not found/i.test(error.message)
          ? 'Storage bucket missing — run the storage SQL block from supabase/schema.sql (bucket "videos").'
          : `Upload failed: ${error.message}`,
      })
      return
    }
    const { data } = supabase.storage.from('videos').getPublicUrl(path)
    setVideoDraft(data.publicUrl)
    await saveParticipantLink('video_url', data.publicUrl)
  }

  async function fillTestScores() {
    if (!supabase) return
    if (!window.confirm('Fill ALL participants with random test scores? Existing scores will be overwritten.')) return
    const rand = (max: number) => Math.floor(Math.random() * (max + 1))
    const rows = participants.flatMap((p) =>
      judges.map((j) => ({
        participant_id: p.id, judge_id: j.id,
        concept_score: rand(3), visual_score: rand(10), technical_score: rand(4), business_score: rand(3),
        comment: null, input_by: 'test-mode', verified: true, updated_at: new Date().toISOString(),
      })),
    )
    const { error } = await supabase.from('scores').upsert(rows, { onConflict: 'participant_id,judge_id' })
    if (error) notify({ kind: 'error', text: `Test fill failed: ${error.message}` })
    else {
      notify({ kind: 'success', text: `Filled ${rows.length} random test scores.` })
      loadAll()
    }
  }

  async function resetAllScores() {
    if (!supabase) return
    if (!window.confirm('Delete ALL scores, award overrides and consensus entries? This cannot be undone.')) return
    const [a, b, c] = await Promise.all([
      supabase.from('scores').delete().not('id', 'is', null),
      supabase.from('award_overrides').delete().not('id', 'is', null),
      supabase.from('final_consensus').delete().not('id', 'is', null),
    ])
    const error = a.error || b.error || c.error
    if (error) notify({ kind: 'error', text: `Reset failed: ${error.message}` })
    else {
      notify({ kind: 'success', text: 'All scoring data reset.' })
      loadAll()
    }
  }

  async function saveConsensus(participantId: string, adjustment: number) {
    if (!supabase) return
    const { error } = await supabase
      .from('final_consensus')
      .upsert({ participant_id: participantId, consensus_rank_adjustment: adjustment, updated_at: new Date().toISOString() }, { onConflict: 'participant_id' })
    if (error) notify({ kind: 'error', text: `Consensus save failed: ${error.message}` })
    else loadAll()
  }

  if (!supabase) {
    return (
      <div className="operator">
        <div className="op-warning">⚠️ Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, then restart the dev server.</div>
      </div>
    )
  }

  const summary = selected ? calculateParticipantScore(selected, scores, judges) : null
  const missingScores = participants.length * judges.length - scores.length
  const unverified = scores.filter((s) => !s.verified).length
  const timerRemaining = display
    ? display.timer_running
      ? Math.max(0, display.timer_seconds - Math.floor((now - new Date(display.updated_at).getTime()) / 1000))
      : display.timer_seconds
    : 300

  return (
    <div className="operator">
      <Toast toast={toast} />
      <div className="op-warning">🔒 Private operator view — do not show this screen on projector.</div>

      <div className="op-grid">
        {/* 1. Display Control */}
        <section className="panel">
          <h2>Display Control</h2>
          <label>Screen mode</label>
          <div className="mode-buttons">
            {SCREEN_MODES.map((m) => (
              <button key={m.value} className={display?.screen_mode === m.value ? 'active' : ''} onClick={() => saveDisplay({ screen_mode: m.value })}>
                {m.label}
              </button>
            ))}
          </div>
          <label>Current participant (Now Pitching / Scoring)</label>
          <select value={display?.current_participant_id ?? ''} onChange={(e) => saveDisplay({ current_participant_id: e.target.value || null, show_video: false })}>
            <option value="">— none —</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>#{p.pitch_order} {p.name} ({p.level})</option>
            ))}
          </select>
          {currentId && (
            <>
              <label>Presentation link for {nameOf(currentId)} (shown on Now Pitching)</label>
              <div className="row slide-row">
                <input type="url" placeholder="Google Slides / Canva share link" value={slideDraft} onChange={(e) => setSlideDraft(e.target.value)} />
                <button onClick={() => saveParticipantLink('slide_url', slideDraft)}>Save link</button>
                {participants.find((p) => p.id === currentId)?.slide_url && (
                  <a href={participants.find((p) => p.id === currentId)!.slide_url!} target="_blank" rel="noreferrer">open ↗</a>
                )}
              </div>
              <label>Output video for {nameOf(currentId)} (upload preferred — plays natively, no Google restrictions)</label>
              <div className="row slide-row">
                <input type="file" accept="video/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && uploadVideo(e.target.files[0])} />
                {uploading && <span className="muted">Uploading…</span>}
              </div>
              <div className="row slide-row">
                <input type="url" placeholder="…or paste a link (YouTube / direct .mp4 / Drive)" value={videoDraft} onChange={(e) => setVideoDraft(e.target.value)} />
                <button onClick={() => saveParticipantLink('video_url', videoDraft)}>Save link</button>
              </div>
              {participants.find((p) => p.id === currentId)?.video_url && (
                <button
                  className={display?.show_video ? 'active' : ''}
                  onClick={() => saveDisplay({ show_video: !display?.show_video })}
                >
                  {display?.show_video ? '🖼 Back to slides' : '🎬 Show output video'}
                </button>
              )}
            </>
          )}
          <label>Reveal award</label>
          <select value={display?.selected_award ?? ''} onChange={(e) => saveDisplay({ selected_award: e.target.value || null })}>
            <option value="">— none —</option>
            {AWARDS.map((a) => (
              <option key={a.key} value={a.key}>{a.label} (suggested: {nameOf(awards.get(a.key))})</option>
            ))}
          </select>
          <label>Reveal participant</label>
          <select value={display?.reveal_participant_id ?? ''} onChange={(e) => saveDisplay({ reveal_participant_id: e.target.value || null })}>
            <option value="">— none —</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.level})</option>
            ))}
          </select>
          {display?.selected_award && awards.get(display.selected_award) && (
            <button className="ghost" onClick={() => saveDisplay({ reveal_participant_id: awards.get(display.selected_award!) ?? null })}>
              Use suggested winner: {nameOf(awards.get(display.selected_award))}
            </button>
          )}
          <label className="check">
            <input type="checkbox" checked={display?.show_winner_score ?? false} onChange={(e) => saveDisplay({ show_winner_score: e.target.checked })} />
            Show winner score on reveal
          </label>
          <label>Pitch timer</label>
          <div className="row">
            <span className="timer-display">{`${Math.floor(timerRemaining / 60)}:${String(timerRemaining % 60).padStart(2, '0')}`}{display?.timer_running ? '' : ' ⏸'}</span>
            {display?.timer_running ? (
              <button onClick={() => saveDisplay({ timer_running: false, timer_seconds: timerRemaining })}>⏸ Pause</button>
            ) : (
              <button onClick={() => saveDisplay({ timer_running: true })}>▶ {display && display.timer_seconds < 300 ? 'Resume' : 'Start 5:00'}</button>
            )}
            <button className="ghost" onClick={() => saveDisplay({ timer_running: false, timer_seconds: 300 })}>Reset</button>
          </div>
        </section>

        {/* 2 + 3. Score Input + Summary */}
        <section className="panel wide">
          <h2>Score Input</h2>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">— select participant —</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>#{p.pitch_order} {p.name} ({p.level})</option>
            ))}
          </select>
          {selected && (
            <>
              <p className="muted">{selected.name} · {selected.level} · Pitch #{selected.pitch_order}</p>
              <table className="score-table">
                <thead>
                  <tr>
                    <th>Judge</th><th>Concept /3</th><th>Visual /10</th><th>Technical /4</th><th>Business /3</th><th>Total /20</th><th>Comment</th><th>✓</th>
                  </tr>
                </thead>
                <tbody>
                  {judges.map((j) => {
                    const d = drafts[j.id] ?? emptyDraft
                    const total = Number(d.concept || 0) + Number(d.visual || 0) + Number(d.technical || 0) + Number(d.business || 0)
                    const filled = draftRowFilled(d)
                    const errors = filled ? validateScore(draftToScore(j.id, d)) : []
                    const set = (patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [j.id]: { ...(prev[j.id] ?? emptyDraft), ...patch } }))
                    return (
                      <tr key={j.id} className={!d.saved && !filled ? 'missing' : errors.length ? 'invalid' : ''}>
                        <td>{j.name} <span className="badge">{j.judge_group}</span></td>
                        {CRITERIA.map((c, i) => {
                          const field = (['concept', 'visual', 'technical', 'business'] as const)[i]
                          return (
                            <td key={c.key}>
                              <input type="number" min={0} max={c.max} step="0.5" value={d[field]} onChange={(e) => set({ [field]: e.target.value })} />
                            </td>
                          )
                        })}
                        <td className={total > 20 ? 'over' : 'total'}>{total}</td>
                        <td><input type="text" className="comment" value={d.comment} onChange={(e) => set({ comment: e.target.value })} /></td>
                        <td><input type="checkbox" checked={d.verified} onChange={(e) => set({ verified: e.target.checked })} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <button className="primary" onClick={saveScores} disabled={saving}>
                {saving ? 'Saving…' : `Save all judge scores for ${selected.name}`}
              </button>
              {summary && (
                <div className="summary">
                  <div><span>JP Total</span><strong>{summary.jpTotal} / 80</strong><small>{summary.jpCount}/{summary.jpExpected} JP judges entered</small></div>
                  <div><span>Thai Average</span><strong>{Number(summary.thAverage.toFixed(2))} / 20</strong><small>{summary.thCount}/{summary.thExpected} TH judges entered{summary.thCount < summary.thExpected ? ' — incomplete' : ''}</small></div>
                  <div><span>Final Score</span><strong>{Number(summary.finalScore.toFixed(2))} / 100</strong><small>{summary.complete ? 'complete' : 'incomplete'}</small></div>
                  <div><span>Verified</span><strong>{summary.verifiedCount}/{summary.scoreCount}</strong><small>score rows verified</small></div>
                </div>
              )}
            </>
          )}
        </section>

        {/* 4. Private Ranking */}
        <section className="panel wide">
          <h2>Private Ranking <span className="badge red">operator only</span></h2>
          <table className="rank-table">
            <thead>
              <tr>
                <th>#</th><th>Lvl #</th><th>Name</th><th>Level</th><th>JP /80</th><th>TH avg /20</th><th>Final /100</th><th>Vis TB</th><th>Tech TB</th><th>Completion</th><th>Award</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => (
                <tr key={r.participant.id} className={r.needsConsensus ? 'tied' : ''}>
                  <td>{r.overallRank}</td>
                  <td>{r.levelRank}</td>
                  <td>{r.participant.name}{r.needsConsensus && ' ⚠️'}</td>
                  <td>{r.participant.level}</td>
                  <td>{r.jpTotal}</td>
                  <td>{Number(r.thAverage.toFixed(2))}</td>
                  <td><strong>{Number(r.finalScore.toFixed(2))}</strong></td>
                  <td>{r.visualTieBreaker}</td>
                  <td>{r.technicalTieBreaker}</td>
                  <td>{r.complete ? '✅' : `${r.jpCount + r.thCount}/${r.jpExpected + r.thExpected}`}</td>
                  <td>
                    {awardOf(r.participant.id)}
                    {r.needsConsensus && (
                      <input
                        className="consensus" type="number" title="Consensus rank adjustment (lower wins the tie)"
                        defaultValue={consensus.get(r.participant.id) ?? 0}
                        onBlur={(e) => saveConsensus(r.participant.id, Number(e.target.value || 0))}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">⚠️ = tie needs judges’ consensus. Enter a rank adjustment (lower number wins the tie).</p>
        </section>

        {/* 5. Award Management */}
        <section className="panel">
          <h2>Award Management</h2>
          {AWARDS.map((a) => {
            const overridden = overrides.has(a.key)
            return (
              <div key={a.key} className="award-row">
                <label>{a.label} {overridden && <span className="badge">override</span>}</label>
                <select value={awards.get(a.key) ?? ''} onChange={(e) => saveOverride(a.key, e.target.value)}>
                  <option value="">— auto —</option>
                  {participants
                    .filter((p) => !a.level || p.level === a.level)
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.level})</option>
                    ))}
                </select>
              </div>
            )
          })}
          <p className="muted">“Auto” follows the ranking. Picking a name saves an override to Supabase.</p>
        </section>

        {/* 6. Data Health */}
        <section className="panel">
          <h2>Data Health</h2>
          <ul className="health">
            <li>Supabase: {connected === null ? '…' : connected ? '🟢 connected' : '🔴 disconnected'}</li>
            <li>Last refresh: {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}</li>
            <li>Participants: {participants.length}</li>
            <li>Score records: {scores.length} / {participants.length * judges.length}</li>
            <li>Missing scores: {missingScores}</li>
            <li>Unverified scores: {unverified}</li>
          </ul>
          <button className="ghost" onClick={loadAll}>↻ Refresh now</button>
          <h2 style={{ marginTop: '1.2rem' }}>Testing / Rehearsal <span className="badge red">danger</span></h2>
          <div className="row">
            <button onClick={fillTestScores}>🎲 Fill random test scores</button>
            <button className="danger" onClick={resetAllScores}>🗑 Reset all scores</button>
          </div>
          <p className="muted">Use before the event to rehearse the full flow, then reset. Both ask for confirmation.</p>
        </section>
      </div>
    </div>
  )
}
