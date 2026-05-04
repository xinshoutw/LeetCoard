import { AnimatePresence, motion } from "framer-motion";
import type { ProblemPayload, SubmissionEventPayload } from "../../lib/types";
import { userColor, difficultyColor } from "../../lib/color";

interface Props {
  events: SubmissionEventPayload[];
  problems: ProblemPayload[];
}

const STATUS_COLOR: Record<string, string> = {
  AC: "#34A853",
  WA: "#EA4335",
  TLE: "#FBBC04",
  RE: "#EA4335",
  CE: "#EA4335",
  MLE: "#FBBC04",
  OLE: "#FBBC04",
};

export default function EventFeed({ events, problems }: Props) {
  // Per spec: only the FIRST AC per (user, problem) is shown.
  // - Scoring AC events are kept (they're already first-AC by construction).
  // - Non-AC events (WA, TLE, RE, ...) are kept as failure feedback.
  // - AC events that aren't scoring (already-solved replays, outside-window) are dropped.
  const visible = events.filter((e) => (e.is_accepted ? e.is_scoring : true));
  const recent = visible.slice(-40).reverse();
  const diffByGslug = new Map(problems.map((p) => [p.title_slug, p.difficulty]));

  return (
    <div className="surface rounded-3xl h-full flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-g-red animate-pulse" />
          <h2 className="font-display font-bold text-lg tracking-wide">即時事件</h2>
        </div>
        <span className="text-[10px] text-ink-300 font-mono">最新 {recent.length} 筆</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {recent.map((e) => (
            <motion.div
              key={e.id}
              layout
              initial={{ opacity: 0, x: 28, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 28 }}
              transition={{ type: "spring", stiffness: 200, damping: 24 }}
              className={
                "px-4 py-2 border-b border-white/5 " +
                (e.is_scoring ? "bg-g-green/10" : "bg-transparent")
              }
            >
              <Item e={e} difficulty={diffByGslug.get(e.title_slug)} />
            </motion.div>
          ))}
        </AnimatePresence>
        {recent.length === 0 && (
          <div className="p-8 text-center text-ink-300 text-sm">等待提交…</div>
        )}
      </div>
    </div>
  );
}

function Item({ e, difficulty }: { e: SubmissionEventPayload; difficulty?: ProblemPayload["difficulty"] }) {
  const colour = userColor(e.username);
  const statusFill = STATUS_COLOR[e.short_label] ?? "#9aa3c7";
  const time = new Date(e.submitted_at).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex items-center gap-2">
      <div className="text-[10px] font-mono text-ink-300 w-16 tabular">{time}</div>
      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular"
        style={{
          background: e.is_accepted ? statusFill : "transparent",
          color: e.is_accepted ? "#070b1f" : statusFill,
          border: e.is_accepted ? "none" : `1px solid ${statusFill}`,
        }}
      >
        {e.short_label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-[12px] truncate">
          <span className="font-bold" style={{ color: colour }}>
            {e.username}
          </span>
          <span className="text-ink-300/70">·</span>
          <span className="text-ink-300 font-mono">{e.student_id}</span>
        </div>
        <div className="text-[11px] text-ink-200 truncate flex items-center gap-1">
          {difficulty && (
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: difficultyColor(difficulty) }}
            />
          )}
          {e.title || e.title_slug}
        </div>
      </div>
      {e.is_scoring && (
        <span className="text-g-green text-[12px] font-black tabular">+{e.points_delta}</span>
      )}
    </div>
  );
}
