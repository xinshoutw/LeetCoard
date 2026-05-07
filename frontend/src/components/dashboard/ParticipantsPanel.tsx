import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { AdminSnapshot } from "../../lib/types";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

interface Row {
  username: string;
  student_id: string;
  _key: string;
}

function makeRow(): Row {
  return {
    username: "",
    student_id: "",
    _key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
}

const EMPTY_ROWS = (): Row[] => [makeRow()];

export default function ParticipantsPanel({ snapshot, token }: Props) {
  const locked = snapshot.status === "running" || snapshot.status === "ended";
  const list = Object.values(snapshot.participants_admin);

  const [rows, setRows] = useState<Row[]>(EMPTY_ROWS);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((current) => {
      const next = current.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      // Auto-grow: if the LAST row now has any content, append a fresh blank row.
      const last = next[next.length - 1];
      if (last && (last.username.trim() || last.student_id.trim())) {
        next.push(makeRow());
      }
      return next;
    });

  const removeRow = (i: number) =>
    setRows((current) => {
      const next = current.filter((_, idx) => idx !== i);
      return next.length ? next : EMPTY_ROWS();
    });

  const submit = async () => {
    const filled = rows.filter((r) => r.username.trim() && r.student_id.trim());
    if (filled.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = filled
        .map((r) => `${r.username.trim()},${r.student_id.trim()}`)
        .join("\n");
      const res = await api<{ ok: true; created: number; updated: number; errors: string[] }>(
        "/api/admin/participants/bulk",
        { method: "PUT", token, body: JSON.stringify({ text }) },
      );
      const errSummary = res.errors.length ? ` · ${res.errors.length} 行失敗` : "";
      setMsg({
        ok: true,
        text: `新增 ${res.created} · 更新 ${res.updated}${errSummary}`,
      });
      if (!res.errors.length) setRows(EMPTY_ROWS());
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
    <div className="surface rounded-3xl p-5 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h2 className="font-bold text-lg">參賽者</h2>
        <span className="text-[10px] text-ink-300">共 {list.length} 人</span>
      </div>

      <div className="shrink-0 space-y-1 max-h-48 overflow-y-auto pr-1">
        <div className="grid grid-cols-[1fr_1fr_24px] gap-2 text-[10px] text-ink-300 px-1">
          <span>username</span>
          <span>nickname</span>
          <span></span>
        </div>
        {rows.map((r, i) => (
          <div key={r._key} className="grid grid-cols-[1fr_1fr_24px] gap-2 items-center">
            <input
              value={r.username}
              onChange={(e) => update(i, { username: e.target.value })}
              disabled={locked}
              placeholder={i === 0 ? "xinshoutw" : ""}
              className="px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-sm font-mono disabled:opacity-50"
            />
            <input
              value={r.student_id}
              onChange={(e) => update(i, { student_id: e.target.value })}
              disabled={locked}
              placeholder={i === 0 ? "B11315009" : ""}
              className="px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-sm font-mono disabled:opacity-50"
            />
            {(r.username || r.student_id) ? (
              <button
                onClick={() => removeRow(i)}
                disabled={locked}
                title="刪除此列"
                className="text-ink-300 hover:text-g-red disabled:opacity-30"
              >
                ×
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 shrink-0">
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

      <hr className="my-3 border-white/10 shrink-0" />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
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
              >
                ×
              </button>
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
