export type Level = 'Senior' | 'Junior'
export type JudgeGroup = 'JP' | 'TH'
export type ScreenMode = 'opening' | 'now_pitching' | 'scoring' | 'winner_reveal'

export interface Participant {
  id: string
  participant_code: string
  name: string
  level: Level
  pitch_order: number
  topic: string | null
  status: string
  slide_url?: string | null
  video_url?: string | null
  is_active?: boolean
}

export interface Judge {
  id: string
  judge_code: string
  name: string
  judge_group: JudgeGroup
  role: string | null
}

export interface Score {
  id?: string
  participant_id: string
  judge_id: string
  concept_score: number
  visual_score: number
  technical_score: number
  business_score: number
  comment: string | null
  input_by: string | null
  verified: boolean
}

export interface DisplayState {
  id: number
  screen_mode: ScreenMode
  current_participant_id: string | null
  selected_award: string | null
  reveal_participant_id: string | null
  show_winner_score: boolean
  show_video?: boolean
  timer_seconds: number
  timer_running: boolean
  updated_at: string
}

export interface AwardOverride {
  award_key: string
  participant_id: string
}

export const AWARDS: { key: string; label: string; level: Level | null }[] = [
  { key: 'senior_1', label: 'Senior Award 1', level: 'Senior' },
  { key: 'senior_2', label: 'Senior Award 2', level: 'Senior' },
  { key: 'junior_1', label: 'Junior Award 1', level: 'Junior' },
  { key: 'junior_2', label: 'Junior Award 2', level: 'Junior' },
  { key: 'grand_prix', label: 'Grand Prix', level: null },
]

export const EVENT = {
  name: 'The Creative Pitch Showdown',
  subtitle: 'Creative Output Pitching Challenge',
  date: '13 Aug 2026',
  process: 'Define → Plan → Execute → Review',
}

// ---- Employee anonymous voting ----
export type VotingMode = 'like' | 'rating'

export interface VotingState {
  id: number
  voting_open: boolean
  current_participant_id: string | null
  voting_mode: VotingMode
  show_dashboard: boolean
  updated_at: string
}

export interface VotingToken {
  id: string
  token_hash: string
  token_label: string | null
  is_active: boolean
}

export interface ParticipantVoteSummary {
  participant_id: string
  participant_name: string
  level: Level
  vote_count: number
  total_vote_value: number
  average_rating: number
  rating_1_count: number
  rating_2_count: number
  rating_3_count: number
  rating_4_count: number
  rating_5_count: number
}

export const RATING_LABELS: Record<number, string> = {
  1: 'Needs more development',
  2: 'Fair',
  3: 'Good',
  4: 'Very good',
  5: 'Excellent',
}

export const VOTING = {
  title: 'The Creative Pitch Showdown',
  subtitle: 'Employee Anonymous Voting',
}
