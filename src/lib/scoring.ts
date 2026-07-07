import type { Judge, Participant, Score } from './types.ts'

export const CRITERIA = [
  { key: 'concept_score', label: 'Concept', max: 3 },
  { key: 'visual_score', label: 'Visual', max: 10 },
  { key: 'technical_score', label: 'Technical', max: 4 },
  { key: 'business_score', label: 'Business', max: 3 },
] as const

export function calculateJudgeTotal(s: Pick<Score, 'concept_score' | 'visual_score' | 'technical_score' | 'business_score'>): number {
  return (s.concept_score || 0) + (s.visual_score || 0) + (s.technical_score || 0) + (s.business_score || 0)
}

export function validateScore(s: Pick<Score, 'concept_score' | 'visual_score' | 'technical_score' | 'business_score'>): string[] {
  const errors: string[] = []
  for (const c of CRITERIA) {
    const v = s[c.key]
    if (v < 0) errors.push(`${c.label} cannot be negative`)
    if (v > c.max) errors.push(`${c.label} exceeds max ${c.max}`)
  }
  if (calculateJudgeTotal(s) > 20) errors.push('Total exceeds 20')
  return errors
}

export interface ParticipantResult {
  participant: Participant
  jpTotal: number
  thAverage: number
  finalScore: number
  jpCount: number
  thCount: number
  jpExpected: number
  thExpected: number
  complete: boolean
  verifiedCount: number
  scoreCount: number
  visualTieBreaker: number
  technicalTieBreaker: number
}

export function calculateParticipantScore(
  participant: Participant,
  scores: Score[],
  judges: Judge[],
): ParticipantResult {
  const mine = scores.filter((s) => s.participant_id === participant.id)
  const groupOf = new Map(judges.map((j) => [j.id, j.judge_group]))
  const jp = mine.filter((s) => groupOf.get(s.judge_id) === 'JP')
  const th = mine.filter((s) => groupOf.get(s.judge_id) === 'TH')
  const jpTotal = jp.reduce((sum, s) => sum + calculateJudgeTotal(s), 0)
  // ponytail: TH average uses available TH scores; completeness is flagged, not blocked
  const thAverage = th.length ? th.reduce((sum, s) => sum + calculateJudgeTotal(s), 0) / th.length : 0
  const jpExpected = judges.filter((j) => j.judge_group === 'JP').length
  const thExpected = judges.filter((j) => j.judge_group === 'TH').length
  return {
    participant,
    jpTotal,
    thAverage,
    finalScore: jpTotal + thAverage,
    jpCount: jp.length,
    thCount: th.length,
    jpExpected,
    thExpected,
    complete: jp.length === jpExpected && th.length === thExpected,
    verifiedCount: mine.filter((s) => s.verified).length,
    scoreCount: mine.length,
    visualTieBreaker: mine.reduce((sum, s) => sum + (s.visual_score || 0), 0),
    technicalTieBreaker: mine.reduce((sum, s) => sum + (s.technical_score || 0), 0),
  }
}

export interface RankedResult extends ParticipantResult {
  overallRank: number
  levelRank: number
  needsConsensus: boolean
}

export function calculateRankings(
  participants: Participant[],
  scores: Score[],
  judges: Judge[],
  consensusAdjustments: Map<string, number> = new Map(),
): RankedResult[] {
  const results = participants.map((p) => calculateParticipantScore(p, scores, judges))
  const adj = (r: ParticipantResult) => consensusAdjustments.get(r.participant.id) || 0
  results.sort(
    (a, b) =>
      b.finalScore - a.finalScore ||
      b.visualTieBreaker - a.visualTieBreaker ||
      b.technicalTieBreaker - a.technicalTieBreaker ||
      adj(a) - adj(b) ||
      a.participant.pitch_order - b.participant.pitch_order,
  )
  const fullyTied = (a: ParticipantResult, b: ParticipantResult) =>
    a.finalScore === b.finalScore &&
    a.visualTieBreaker === b.visualTieBreaker &&
    a.technicalTieBreaker === b.technicalTieBreaker &&
    adj(a) === adj(b)
  const levelCounters: Record<string, number> = {}
  return results.map((r, i) => {
    levelCounters[r.participant.level] = (levelCounters[r.participant.level] || 0) + 1
    return {
      ...r,
      overallRank: i + 1,
      levelRank: levelCounters[r.participant.level],
      needsConsensus:
        (i > 0 && fullyTied(r, results[i - 1])) || (i < results.length - 1 && fullyTied(r, results[i + 1])),
    }
  })
}

/** Suggested winners by default logic. Overrides (award_key → participant_id) take precedence. */
export function calculateSuggestedAwards(
  rankings: RankedResult[],
  overrides: Map<string, string> = new Map(),
): Map<string, string | null> {
  const seniors = rankings.filter((r) => r.participant.level === 'Senior')
  const juniors = rankings.filter((r) => r.participant.level === 'Junior')
  const auto: Record<string, string | null> = {
    senior_1: seniors[0]?.participant.id ?? null,
    senior_2: seniors[1]?.participant.id ?? null,
    junior_1: juniors[0]?.participant.id ?? null,
    junior_2: juniors[1]?.participant.id ?? null,
    grand_prix: rankings[0]?.participant.id ?? null,
  }
  return new Map(Object.keys(auto).map((k) => [k, overrides.get(k) ?? auto[k]]))
}
