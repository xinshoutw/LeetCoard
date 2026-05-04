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
  const events = [...snapshot.events].reverse().slice(0, 80);
  return (
    <div className="surface rounded-3xl p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg">Submission 紀錄</h2>
        <span className="text-[10px] text-ink-300">{events.length} 筆</span>
      </div>
      <div className="max-h-72 overflow-y-auto text-[12px] font-mono">
        {events.map((e) => {
          const colour = STATUS_COLOR[e.short_label] ?? "#9aa3c7";
          return (
            <div key={e.id} className="grid grid-cols-[80px_56px_1fr_60px] gap-2 py-1 border-b border-white/5">
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
              <span className="truncate">
                <b>{e.username}</b>
                <span className="text-ink-300"> · {e.title_slug}</span>
                {e.note && <span className="text-ink-300"> · {e.note}</span>}
              </span>
              <span className="text-right text-g-green tabular">
                {e.is_scoring ? `+${e.points_delta}` : ""}
              </span>
            </div>
          );
        })}
        {!events.length && <div className="text-center text-ink-300 py-6">尚未有提交</div>}
      </div>
    </div>
  );
}
