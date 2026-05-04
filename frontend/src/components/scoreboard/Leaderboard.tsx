import { AnimatePresence, motion } from "framer-motion";
import type { LeaderboardRow, ProblemPayload } from "../../lib/types";
import { difficultyColor, userColor } from "../../lib/color";

interface Props {
  rows: LeaderboardRow[];
  problems: ProblemPayload[];
}

export default function Leaderboard({ rows, problems }: Props) {
  const sortedProblems = [...problems].sort((a, b) => a.order - b.order);
  return (
    <div className="surface rounded-3xl h-full flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-g-blue animate-pulse" />
          <h2 className="font-display font-bold text-lg tracking-wide">排行榜</h2>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-ink-300 font-mono">
          {sortedProblems.map((p, i) => (
            <div key={p.title_slug} className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: difficultyColor(p.difficulty) }}
              />
              <span>{p.points}</span>
              {i < sortedProblems.length - 1 && <span className="text-white/20">·</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.div
              key={row.username}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
              className="px-3 py-2 border-b border-white/5"
            >
              <Row row={row} problems={sortedProblems} />
            </motion.div>
          ))}
        </AnimatePresence>
        {rows.length === 0 && (
          <div className="p-8 text-center text-ink-300 text-sm">尚未有參賽者</div>
        )}
      </div>
    </div>
  );
}

function Row({ row, problems }: { row: LeaderboardRow; problems: ProblemPayload[] }) {
  const colour = userColor(row.username, row.color);
  return (
    <div className="flex items-center gap-3">
      <div className="text-xl font-black text-ink-300 font-mono w-8 text-right tabular">
        {row.rank}
      </div>
      <div
        className="relative size-11 rounded-full overflow-hidden flex-shrink-0"
        style={{ boxShadow: `0 0 0 2px ${colour}, 0 0 0 4px rgba(0,0,0,0.4)` }}
      >
        {row.avatar_url ? (
          <img src={row.avatar_url} alt="" className="size-full object-cover" />
        ) : (
          <div
            className="size-full flex items-center justify-center text-stage-900 font-black"
            style={{ background: colour }}
          >
            {row.username.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold leading-tight truncate" style={{ color: colour }}>
          {row.username}
        </div>
        <div className="text-[11px] text-ink-300 font-mono truncate">{row.student_id}</div>
      </div>
      <div className="flex items-center gap-1.5">
        {problems.map((p) => {
          const solved = row.solved_problems.includes(p.title_slug);
          return (
            <div
              key={p.title_slug}
              className="size-3.5 rounded-sm border-2"
              style={{
                borderColor: difficultyColor(p.difficulty),
                background: solved ? difficultyColor(p.difficulty) : "transparent",
              }}
              title={p.title_slug}
            />
          );
        })}
      </div>
      <motion.div
        className="text-2xl font-black tabular w-12 text-right"
        key={row.score}
        initial={{ scale: 1.4, color: "#FBBC04" }}
        animate={{ scale: 1, color: "#f4f6ff" }}
        transition={{ duration: 0.5 }}
      >
        {row.score}
      </motion.div>
    </div>
  );
}
