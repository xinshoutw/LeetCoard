import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { AdminSnapshot } from "../../lib/types";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

export default function ParticipantsPanel({ snapshot, token }: Props) {
  const locked = snapshot.status === "running" || snapshot.status === "ended";
  const list = Object.values(snapshot.participants_admin);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ ok: true; created: number; updated: number; errors: string[] }>(
        "/api/admin/participants/bulk",
        { method: "PUT", token, body: JSON.stringify({ text }) },
      );
      const errSummary = res.errors.length ? ` · ${res.errors.length} 行失敗` : "";
      setMsg({
        ok: true,
        text: `新增 ${res.created} · 更新 ${res.updated}${errSummary}`,
      });
      if (!res.errors.length) setText("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? `${e.status}: ${e.message}` : String(e) });
    }
    setBusy(false);
  };

  const remove = async (username: string) => {
    if (!window.confirm(`移除 ${username}？`)) return;
    try {
      await api(`/api/admin/participants/${encodeURIComponent(username)}`, {
        method: "DELETE",
        token,
      });
    } catch (e) {
      alert(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    }
  };

  return (
    <div className="surface rounded-3xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg">參賽者</h2>
        <span className="text-[10px] text-ink-300">共 {list.length} 人</span>
      </div>

      <div className="text-[11px] text-ink-300 mb-1">
        批量新增：每行一筆 <code className="font-mono text-ink-200">username,student_id</code>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={locked}
        placeholder={"alice,B11000001\nbob,B11000002"}
        className="w-full px-2 py-1 rounded bg-stage-900/50 border border-white/10 font-mono text-sm disabled:opacity-50"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || locked}
          className="px-4 py-1.5 rounded bg-g-blue text-white text-sm font-bold disabled:opacity-50"
        >
          {busy ? "送出中…" : "新增 / 更新"}
        </button>
        {locked && <span className="text-[11px] text-g-yellow">比賽已開始，參賽者鎖定中</span>}
        {msg && <span className={"text-xs " + (msg.ok ? "text-g-green" : "text-g-red")}>{msg.text}</span>}
      </div>

      <hr className="my-4 border-white/10" />

      <div className="max-h-56 overflow-y-auto">
        {list.map((p) => (
          <div key={p.username} className="flex items-center justify-between py-1 text-sm border-b border-white/5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-bold truncate">{p.username}</span>
              <span className="text-ink-300 font-mono text-xs">{p.student_id}</span>
            </div>
            <span className="font-mono tabular text-xs text-ink-300">#{p.rank} · {p.score}pt</span>
            {!locked && (
              <button
                onClick={() => remove(p.username)}
                className="ml-2 text-ink-300 hover:text-g-red"
                title="刪除"
              >×</button>
            )}
          </div>
        ))}
        {!list.length && (
          <div className="text-center text-ink-300 text-sm py-6">尚未新增參賽者</div>
        )}
      </div>
    </div>
  );
}
