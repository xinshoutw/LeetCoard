import type { AdminSnapshot } from "../../lib/types";

const STATUS_COLOR: Record<string, string> = {
  AC: "#34A853",
  WA: "#EA4335",
  TLE: "#FBBC04",
  RE: "#EA4335",
  CE: "#EA4335",
  MLE: "#FBBC04",
  OLE: "#FBBC04",
};

export default function EventsPanel({ snapshot }: { snapshot: AdminSnapshot }) {
  // Only show events that landed AT or AFTER the contest start. Untracked
  // submissions are kept (with a 「非題目」 marker) so admins can spot
  // off-topic activity. Sorted newest-first, capped at the latest 200.
  const startMs = snapshot.start_time ? Date.parse(snapshot.start_time) : null;
  const events = [...snapshot.events]
    .filter((e) => {
      if (startMs == null) return false;
      return Date.parse(e.submitted_at) >= startMs;
    })
    .reverse()
    .slice(0, 200);

  return (
    <div className="surface rounded-3xl p-5 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h2 className="font-bold text-lg">Submission 紀錄</h2>
        <span className="text-[10px] text-ink-300">
          {events.length} 筆 · 自比賽開始
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto text-[12px] font-mono">
        {events.map((e) => {
          const colour = STATUS_COLOR[e.short_label] ?? "#9aa3c7";
          const beat = e.beat_pct != null ? `${Math.round(e.beat_pct)}%` : null;
          return (
            <div
              key={e.id}
              className={
                "grid grid-cols-[64px_44px_1fr_44px_56px] gap-2 py-1 border-b border-white/5 items-center " +
                (!e.is_tracked ? "opacity-70" : "")
              }
            >
              <span className="text-ink-300 text-[10px] tabular">
                {new Date(e.submitted_at).toLocaleTimeString([], { hour12: false })}
              </span>
              <span
                className="px-1 rounded text-center text-[10px] font-bold"
                style={{
                  background: e.is_accepted ? colour : "transparent",
                  color: e.is_accepted ? "#070b1f" : colour,
                  border: e.is_accepted ? "none" : `1px solid ${colour}`,
                }}
              >
                {e.short_label}
              </span>
              <span className="truncate flex items-center gap-1">
                <b>{e.username}</b>
                <span className="text-ink-300">·</span>
                <span className="truncate text-ink-200">{e.title || e.title_slug}</span>
                {!e.is_tracked && (
                  <span
                    className="ml-1 px-1 rounded bg-g-yellow/20 text-g-yellow text-[9px] font-bold tracking-wide shrink-0"
                    title="此題目不在比賽題目清單內"
                  >
                    非題目
                  </span>
                )}
                {e.is_overflow && (
                  <span
                    className="ml-1 text-ink-300/60 shrink-0"
                    title="超過前 3 次 AC，未採計"
                    aria-label="not counted"
                  >
                    ⊘
                  </span>
                )}
                {e.note && <span className="text-ink-300/70"> · {e.note}</span>}
              </span>
              <span className="text-right text-[10px] tabular text-g-blue">
                {beat ? `★${beat}` : ""}
              </span>
              <span className="text-right text-g-green tabular">
                {e.is_scoring ? (
                  <>
                    +{e.points_delta}
                    {e.bonus_delta > 0 && (
                      <span className="text-[9px] text-g-blue/80"> (+{e.bonus_delta})</span>
                    )}
                  </>
                ) : ""}
              </span>
            </div>
          );
        })}
        {!events.length && (
          <div className="text-center text-ink-300 py-6">
            {startMs == null ? "尚未設定開始時間" : "尚未有提交"}
          </div>
        )}
      </div>
    </div>
  );
}
