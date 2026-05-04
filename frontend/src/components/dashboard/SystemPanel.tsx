import type { AdminSnapshot } from "../../lib/types";

const LEVEL_COLOR: Record<string, string> = {
  info: "#9aa3c7",
  warn: "#FBBC04",
  error: "#EA4335",
};

export default function SystemPanel({ snapshot }: { snapshot: AdminSnapshot }) {
  const events = [...snapshot.system_events].reverse().slice(0, 80);
  return (
    <div className="surface rounded-3xl p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg">系統紀錄</h2>
        <span className="text-[10px] text-ink-300">{events.length} 筆</span>
      </div>
      <div className="max-h-72 overflow-y-auto text-[12px] font-mono space-y-1">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 py-1 border-b border-white/5">
            <span className="text-ink-300 text-[10px] tabular w-20 shrink-0">
              {new Date(e.at).toLocaleTimeString([], { hour12: false })}
            </span>
            <span
              className="text-[10px] font-bold uppercase shrink-0 w-12"
              style={{ color: LEVEL_COLOR[e.level] ?? "#9aa3c7" }}
            >
              {e.kind}
            </span>
            <span className="flex-1 text-ink-200 break-words">{e.message}</span>
          </div>
        ))}
        {!events.length && <div className="text-center text-ink-300 py-6">尚無事件</div>}
      </div>
    </div>
  );
}
