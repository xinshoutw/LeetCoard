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
  // Public scoreboard: only tracked problems, and AC events that scored
  // (skip already-solved replays / outside-window). Non-AC failures still
  // show as feedback. Overflow ACs are kept so spectators see continued
  // attempts but they're visually demoted.
  const visible = events.filter((e) => {
    if (!e.is_tracked) return false;
    if (e.is_accepted) return e.is_scoring || e.is_overflow;
    return true;
  });
  const recent = visible.slice(-40).reverse();
  const diffByGslug = new Map(problems.map((p) => [p.title_slug, p.difficulty]));

  return (
    <div className="surface rounded-3xl h-full flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-g-red animate-pulse" />
          <h2 className="font-display font-bold text-lg tracking-wide">即時事件</h2>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
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
                "px-3 py-3 border-b border-white/5 " +
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
    <div className="grid grid-cols-[56px_minmax(0,1fr)_auto] gap-3 items-center">
      {/* LEFT: status badge, larger */}
      <div
        className="size-12 rounded-xl flex items-center justify-center text-sm font-black tabular"
        style={{
          background: e.is_accepted ? statusFill : "transparent",
          color: e.is_accepted ? "#070b1f" : statusFill,
          border: e.is_accepted ? "none" : `2px solid ${statusFill}`,
        }}
      >
        {e.short_label}
      </div>

      {/* MIDDLE: username + title (bigger) */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-bold truncate" style={{ color: colour }}>
            {e.username}
          </span>
          <span className="text-ink-300/60">·</span>
          <span className="text-ink-300 font-mono text-[11px] truncate">{e.student_id}</span>
        </div>
        <div className="text-[16px] font-bold leading-snug truncate flex items-center gap-1.5">
          {difficulty && (
            <span
              className="inline-block size-2 rounded-full shrink-0"
              style={{ background: difficultyColor(difficulty) }}
            />
          )}
          <span className="truncate">{e.title || e.title_slug}</span>
          {e.is_overflow && (
            <span
              className="text-ink-300/60 text-sm shrink-0"
              title="超過前 3 次 AC，未採計"
              aria-label="not counted"
            >
              ⊘
            </span>
          )}
        </div>
      </div>

      {/* RIGHT: score chip + time */}
      <div className="flex flex-col items-end gap-1 shrink-0 min-w-[64px]">
        {e.is_scoring ? (
          <div className="text-[22px] font-black text-g-green tabular leading-none">
            +{e.points_delta}
            {e.bonus_delta > 0 && (
              <span className="ml-1 text-[12px] text-g-blue/80 font-bold">(+{e.bonus_delta})</span>
            )}
          </div>
        ) : e.beat_pct != null ? (
          <span className="text-g-blue text-[12px] font-mono tabular">★{Math.round(e.beat_pct)}%</span>
        ) : (
          <span />
        )}
        <span className="text-[9px] font-mono tabular text-ink-300/60">{time}</span>
      </div>
    </div>
  );
}
