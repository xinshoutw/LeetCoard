import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { AdminSnapshot } from "../../lib/types";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

const STATUS_COLOR: Record<string, string> = {
  setup: "#9aa3c7",
  running: "#34A853",
  ended: "#FBBC04",
};

export default function ContestPanel({ snapshot, token }: Props) {
  const [start, setStart] = useState(snapshot.start_time?.slice(0, 16) ?? "");
  const [end, setEnd] = useState(snapshot.end_time?.slice(0, 16) ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const locked = snapshot.status === "running" || snapshot.status === "ended";

  const setTimes = async () => {
    setBusy("times");
    setMsg(null);
    try {
      await api("/api/admin/times", {
        method: "PUT",
        token,
        body: JSON.stringify({
          start_time: start ? new Date(start).toISOString() : null,
          end_time: end ? new Date(end).toISOString() : null,
        }),
      });
      setMsg({ ok: true, text: "比賽時間已更新" });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
    setBusy(null);
  };

  const start_ = async () => act("start", () => api("/api/admin/contest/start", { method: "POST", token }));
  const end_ = async () => act("end", () => api("/api/admin/contest/end", { method: "POST", token }));
  const reset = async () => {
    if (!window.confirm("重置會清除分數、AC 狀態、submission 紀錄與事件，題目與參賽者保留。確定？")) return;
    act("reset", () =>
      api("/api/admin/contest/reset", {
        method: "POST",
        token,
        body: JSON.stringify({ keep_config: true, confirm: "RESET" }),
      }),
    );
  };

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: `${name} 完成` });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
    setBusy(null);
  }

  return (
    <div className="surface rounded-3xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg">比賽控制</h2>
        <span
          className="px-2 py-0.5 rounded-full text-xs font-bold tracking-wider"
          style={{ background: `${STATUS_COLOR[snapshot.status]}22`, color: STATUS_COLOR[snapshot.status] }}
        >
          {snapshot.status.toUpperCase()}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-ink-300 mb-1">開始時間</label>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={locked}
            className="w-full px-2 py-1.5 rounded bg-stage-900/50 border border-white/10 text-ink-100 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-300 mb-1">結束時間</label>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            disabled={locked}
            className="w-full px-2 py-1.5 rounded bg-stage-900/50 border border-white/10 text-ink-100 disabled:opacity-50"
          />
        </div>
        <button
          onClick={setTimes}
          disabled={locked || busy === "times"}
          className="w-full py-1.5 rounded bg-g-blue text-white text-sm font-bold disabled:opacity-50"
        >
          {busy === "times" ? "儲存中…" : "儲存時間"}
        </button>
        {locked && (
          <div className="text-[11px] text-g-yellow">⚠ 比賽已開始，題目／參賽者／時間皆已鎖定。</div>
        )}
      </div>

      <hr className="my-4 border-white/10" />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={start_}
          disabled={busy === "start" || snapshot.status === "running" || snapshot.status === "ended"}
          className="py-1.5 rounded bg-g-green/80 hover:bg-g-green text-stage-900 text-sm font-bold disabled:opacity-30"
        >
          開始比賽
        </button>
        <button
          onClick={end_}
          disabled={busy === "end" || snapshot.status !== "running"}
          className="py-1.5 rounded bg-g-yellow/80 hover:bg-g-yellow text-stage-900 text-sm font-bold disabled:opacity-30"
        >
          結束比賽
        </button>
        <button
          onClick={reset}
          disabled={busy === "reset"}
          className="col-span-2 py-1.5 rounded bg-g-red/80 hover:bg-g-red text-white text-sm font-bold disabled:opacity-30"
        >
          重置（保留題目與參賽者）
        </button>
      </div>

      {msg && (
        <div className={"mt-3 text-xs " + (msg.ok ? "text-g-green" : "text-g-red")}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function errMsg(e: unknown) {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return String(e);
}
