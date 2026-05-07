// Mirrors backend payloads. Keep in sync with `app/state.py::snapshot_dict`.

export type ContestStatus = "setup" | "running" | "ended";

export interface BonusTier {
  min_beat_pct: number;  // 0–100, inclusive lower bound
  bonus_pts: number;
}

export interface ProblemPayload {
  title_slug: string;
  difficulty: "easy" | "medium" | "hard";
  points: number;
  order: number;
  title?: string | null;
  color?: string | null;
  beat_bonus_tiers?: BonusTier[];
}

export interface LeaderboardRow {
  rank: number;
  username: string;
  student_id: string;
  avatar_url: string | null;
  color: string;
  score: number;
  solved_problems: string[];
  reached_current_score_at: string | null;
  // In-contest tracked-problem AC counts.
  easy_solved: number;
  medium_solved: number;
  hard_solved: number;
  // LeetCode global stats (populated by profile fetcher).
  lc_ranking: number | null;
  lc_easy_total: number;
  lc_medium_total: number;
  lc_hard_total: number;
}

export interface SubmissionEventPayload {
  id: string;
  submission_id: string | null;
  username: string;
  student_id: string;
  title_slug: string;
  title?: string | null;
  status: string;
  short_label: string;
  submitted_at: string;
  detected_at: string;
  points_delta: number;       // total awarded (base + bonus)
  bonus_delta: number;        // bonus portion (from beat-% tiers)
  beat_pct?: number | null;   // runtime beat percentile reported by LeetCode
  is_accepted: boolean;
  is_scoring: boolean;
  note?: string | null;
}

export interface ParticipantAdminPayload {
  username: string;
  student_id: string;
  avatar_url: string | null;
  color: string | null;
  score: number;
  rank: number;
  solved_problems: string[];
}

export interface PublicSnapshot {
  status: ContestStatus;
  start_time: string | null;
  end_time: string | null;
  server_time: string;
  problems: ProblemPayload[];
  leaderboard: LeaderboardRow[];
  events: SubmissionEventPayload[];
}

export interface AdminSnapshot extends PublicSnapshot {
  participants_admin: Record<string, ParticipantAdminPayload>;
}
