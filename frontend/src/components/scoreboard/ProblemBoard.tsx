import { AnimatePresence, motion } from "framer-motion";
import type {
  ContestStatus,
  LeaderboardRow,
  ProblemPayload,
  SubmissionEventPayload,
} from "../../lib/types";
import { difficultyColor, userColor } from "../../lib/color";

interface Props {
  problems: ProblemPayload[];
  events: SubmissionEventPayload[];
  leaderboard: LeaderboardRow[];
  status: ContestStatus;
}

interface Solver {
  username: string;
  avatar_url: string | null;
  color: string;
  beat_pct: number | null;
  solved_at: string;
}

const DIFF_LABEL: Record<ProblemPayload["difficulty"], string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

function buildSolvers(
  problem: ProblemPayload,
  events: SubmissionEventPayload[],
  rowByUser: Map<string, LeaderboardRow>,
): Solver[] {
  // Only adopted (is_scoring) AC events contribute to the displayed beat%
  // and the sort key. is_scoring is set by the backend exclusively on the
  // first in-window AC and on bonus upgrades — i.e. exactly the submissions
  // whose beat% mutated `problem_best_beat_pct`. This intentionally excludes:
  //   - out-of-window ACs (is_scoring always false)
  //   - 4th+ overflow ACs (is_scoring always false)
  //   - re-ACs that did not move the bonus tier
  const best = new Map<string, Solver>();
  for (const e of events) {
    if (!e.is_accepted) continue;
    if (!e.is_tracked) continue;
    if (!e.is_scoring) continue;
    if (e.title_slug !== problem.title_slug) continue;
    const row = rowByUser.get(e.username);
    if (!row || !row.solved_problems.includes(problem.title_slug)) continue;
    const prev = best.get(e.username);
    const beat = typeof e.beat_pct === "number" ? e.beat_pct : null;
    if (!prev) {
      best.set(e.username, {
        username: e.username,
        avatar_url: row.avatar_url,
        color: userColor(e.username, row.color),
        beat_pct: beat,
        solved_at: e.submitted_at,
      });
    } else {
      const prevBeat = prev.beat_pct ?? -1;
      const curBeat = beat ?? -1;
      if (curBeat > prevBeat) {
        // Tiebreaker for the problem-card sort uses the time of the *best*
        // beat% submission, not the earliest scoring AC. Otherwise a user who
        // hit 100% later loses their lead to someone whose first AC was earlier.
        prev.beat_pct = beat;
        prev.solved_at = e.submitted_at;
      } else if (curBeat === prevBeat && e.submitted_at < prev.solved_at) {
        prev.solved_at = e.submitted_at;
      }
    }
  }

  // Anyone in the leaderboard who solved this problem but has no event in the
  // current buffer (e.g. very old AC pushed off the 200-event window) — still
  // surface them so the card stays accurate.
  for (const row of rowByUser.values()) {
    if (!row.solved_problems.includes(problem.title_slug)) continue;
    if (best.has(row.username)) continue;
    best.set(row.username, {
      username: row.username,
      avatar_url: row.avatar_url,
      color: userColor(row.username, row.color),
      beat_pct: null,
      solved_at: "",
    });
  }

  return Array.from(best.values()).sort((a, b) => {
    const ab = a.beat_pct ?? -1;
    const bb = b.beat_pct ?? -1;
    if (ab !== bb) return bb - ab;
    if (a.solved_at && b.solved_at && a.solved_at !== b.solved_at) {
      return a.solved_at < b.solved_at ? -1 : 1;
    }
    return a.username.localeCompare(b.username);
  });
}

export default function ProblemBoard({ problems, events, leaderboard, status }: Props) {
  const sortedProblems = [...problems].sort((a, b) => a.order - b.order);
  const rowByUser = new Map(leaderboard.map((r) => [r.username, r]));

  return (
    <div className="surface rounded-3xl h-full flex flex-col overflow-hidden">
      <div className="px-6 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-g-yellow" />
          <h2 className="font-display font-bold text-lg tracking-wide">題目進度</h2>
        </div>
        <span className="text-[10px] text-ink-300 font-mono">
          {status === "setup" ? "STAND BY" : status === "ended" ? "ENDED" : `${sortedProblems.length} 題`}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {sortedProblems.length === 0 && (
          <div className="h-full flex items-center justify-center text-ink-300 text-sm">
            尚未設定題目
          </div>
        )}
        {sortedProblems.map((p) => (
          <ProblemCard
            key={p.title_slug}
            problem={p}
            solvers={buildSolvers(p, events, rowByUser)}
            blurTitle={status === "setup"}
          />
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  problem: ProblemPayload;
  solvers: Solver[];
  blurTitle: boolean;
}

function ProblemCard({ problem, solvers, blurTitle }: CardProps) {
  const diffColor = difficultyColor(problem.difficulty);
  const masked = blurTitle || !problem.title;
  const title = masked ? "— — — — —" : (problem.title as string);
  const number = masked ? "???" : (problem.frontend_id ?? "—");
  const top = solvers[0];

  return (
    <motion.div
      layout
      className="rounded-2xl border border-white/10 bg-stage-900/60 overflow-hidden"
      style={{
        boxShadow: top
          ? `inset 4px 0 0 ${top.color}, 0 0 28px -10px ${diffColor}`
          : `inset 4px 0 0 ${diffColor}33`,
      }}
    >
      {/* Title strip */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3">
        <span
          className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest uppercase"
          style={{ background: `${diffColor}22`, color: diffColor, border: `1px solid ${diffColor}55` }}
        >
          {DIFF_LABEL[problem.difficulty]}
        </span>
        <h3
          className={
            "font-display font-black text-xl tracking-tight truncate flex-1 " +
            (masked ? "text-ink-300 select-none" : "")
          }
          aria-hidden={masked}
        >
          <span className="font-mono text-ink-300 mr-2">#{number}</span>
          {title}
        </h3>
        <span className="font-mono tabular text-sm text-ink-300">
          <span className="text-g-yellow font-bold">{problem.points}</span> pt
        </span>
      </div>

      {/* Solver row */}
      <div className="px-4 pb-4">
        {solvers.length === 0 ? (
          <div className="text-center text-ink-300 text-xs py-3 border border-dashed border-white/10 rounded-xl">
            尚無人解出
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <AnimatePresence initial={false}>
              {solvers.map((s, idx) => (
                <motion.div
                  key={s.username}
                  layout
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: "spring", stiffness: 180, damping: 22 }}
                  className="flex flex-col items-center w-16"
                >
                  <div className="relative">
                    <div
                      className="size-12 rounded-full overflow-hidden"
                      style={{ boxShadow: `0 0 0 2px ${s.color}, 0 0 0 4px rgba(0,0,0,0.5)` }}
                    >
                      {s.avatar_url ? (
                        <img src={s.avatar_url} alt="" className="size-full object-cover" />
                      ) : (
                        <div
                          className="size-full flex items-center justify-center text-stage-900 font-black text-lg"
                          style={{ background: s.color }}
                        >
                          {s.username.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                    </div>
                    {idx === 0 && (
                      <span
                        className="absolute -top-1 -right-1 size-5 rounded-full bg-g-yellow text-stage-900 text-[10px] font-black flex items-center justify-center"
                        title="最佳擊敗百分比"
                      >
                        ★
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-1 text-[11px] font-bold leading-tight tracking-tight max-w-full truncate"
                    style={{ color: s.color }}
                    title={s.username}
                  >
                    {s.username}
                  </div>
                  <div className="text-[10px] font-mono tabular text-ink-300 leading-tight">
                    {s.beat_pct != null ? `${s.beat_pct.toFixed(1)}%` : "—"}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}
