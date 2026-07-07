// Run with: npm test (Node 22.6+ strips types natively)
import assert from 'node:assert'
import { calculateJudgeTotal, calculateParticipantScore, calculateRankings, calculateSuggestedAwards, validateScore } from './scoring.ts'
import type { Judge, Participant, Score } from './types.ts'

const judges: Judge[] = [
  { id: 'j1', judge_code: 'mamo', name: 'Mamo', judge_group: 'JP', role: null },
  { id: 'j2', judge_code: 'yui', name: 'Yui', judge_group: 'JP', role: null },
  { id: 'j3', judge_code: 'takuya', name: 'Takuya', judge_group: 'JP', role: null },
  { id: 'j4', judge_code: 'jay', name: 'Jay', judge_group: 'JP', role: null },
  { id: 'j5', judge_code: 'maprang', name: 'Maprang', judge_group: 'TH', role: null },
  { id: 'j6', judge_code: 'pued', name: 'Pued', judge_group: 'TH', role: null },
]
const p = (id: string, level: 'Senior' | 'Junior', order: number): Participant =>
  ({ id, participant_code: id, name: id, level, pitch_order: order, topic: null, status: 'pending' })
const score = (pid: string, jid: string, total: number, visual = 0): Score =>
  ({ participant_id: pid, judge_id: jid, concept_score: total - visual, visual_score: visual, technical_score: 0, business_score: 0, comment: null, input_by: null, verified: true })

// Spec example: Mamo 17, Yui 16, Takuya 18, Jay 17, Maprang 15, Pued 17 → 68 + 16 = 84
const p1 = p('p1', 'Senior', 1)
const specScores: Score[] = [
  score('p1', 'j1', 17), score('p1', 'j2', 16), score('p1', 'j3', 18),
  score('p1', 'j4', 17), score('p1', 'j5', 15), score('p1', 'j6', 17),
]
const r1 = calculateParticipantScore(p1, specScores, judges)
assert.strictEqual(r1.jpTotal, 68)
assert.strictEqual(r1.thAverage, 16)
assert.strictEqual(r1.finalScore, 84)
assert.strictEqual(r1.complete, true)

// One TH score only → computed from available, flagged incomplete
const r2 = calculateParticipantScore(p1, specScores.slice(0, 5), judges)
assert.strictEqual(r2.thAverage, 15)
assert.strictEqual(r2.complete, false)

// Validation
assert.strictEqual(validateScore({ concept_score: 3, visual_score: 10, technical_score: 4, business_score: 3 }).length, 0)
assert.ok(validateScore({ concept_score: 4, visual_score: 0, technical_score: 0, business_score: 0 }).length > 0)
assert.ok(validateScore({ concept_score: -1, visual_score: 0, technical_score: 0, business_score: 0 }).length > 0)
assert.strictEqual(calculateJudgeTotal({ concept_score: 3, visual_score: 10, technical_score: 4, business_score: 3 }), 20)

// Tie-break: same final score, p3 has higher visual → ranks above p2
const p2 = p('p2', 'Senior', 2)
const p3 = p('p3', 'Junior', 3)
const tieScores: Score[] = [score('p2', 'j1', 10, 2), score('p3', 'j1', 10, 5), score('p2', 'j5', 10), score('p3', 'j5', 10)]
const ranked = calculateRankings([p2, p3], tieScores, judges)
assert.strictEqual(ranked[0].participant.id, 'p3')
assert.strictEqual(ranked[0].needsConsensus, false)

// Full tie → both flagged needsConsensus
const fullTie = calculateRankings([p2, p3], [score('p2', 'j1', 10, 2), score('p3', 'j1', 10, 2)], judges)
assert.ok(fullTie.every((r) => r.needsConsensus))

// Awards: grand prix = top overall, level awards from level ranks
const awards = calculateSuggestedAwards(ranked)
assert.strictEqual(awards.get('grand_prix'), 'p3')
assert.strictEqual(awards.get('senior_1'), 'p2')
assert.strictEqual(awards.get('junior_1'), 'p3')
assert.strictEqual(awards.get('junior_2'), null)
// Override wins
assert.strictEqual(calculateSuggestedAwards(ranked, new Map([['grand_prix', 'p2']])).get('grand_prix'), 'p2')

// Embed URL conversion
const { toEmbedUrl } = await import('./embed.ts')
assert.strictEqual(
  toEmbedUrl('https://docs.google.com/presentation/d/1AbC_dEf-123/edit?usp=sharing'),
  'https://docs.google.com/presentation/d/1AbC_dEf-123/embed?start=false&loop=false&rm=minimal',
)
assert.strictEqual(
  toEmbedUrl('https://www.canva.com/design/DAF123abc/xYz_456/view'),
  'https://www.canva.com/design/DAF123abc/xYz_456/view?embed',
)
assert.strictEqual(
  toEmbedUrl('https://docs.google.com/presentation/d/e/2PACX-1vAbC_123/pubhtml'),
  'https://docs.google.com/presentation/d/e/2PACX-1vAbC_123/embed?start=false&loop=false&rm=minimal',
)
assert.strictEqual(toEmbedUrl('https://example.com/deck.html'), 'https://example.com/deck.html')

console.log('scoring.test.ts: all assertions passed')
