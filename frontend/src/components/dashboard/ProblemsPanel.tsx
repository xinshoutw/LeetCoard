import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { AdminSnapshot, ProblemPayload } from "../../lib/types";
import { difficultyColor } from "../../lib/color";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

interface Draft extends ProblemPayload {
  _key: string;
}

const DEFAULT: ProblemPayload[] = [
  { title_slug: "two-sum", difficulty: "easy", points: 1, order: 0 },
  { title_slug: "valid-parentheses", difficulty: "easy", points: 1, order: 1 },
  { title_slug: "3sum", difficulty: "medium", points: 3, order: 2 },
  { title_slug: "trapping-rain-water", difficulty: "hard", points: 5, order: 3 },
];

export default function ProblemsPanel({ snapshot, token }: Props) {
  const locked = snapshot.status === "running" || snapshot.status === "ended";
  const [draft, setDraft] = useState<Draft[]>(() =>
    (snapshot.problems.length ? snapshot.problems : DEFAULT).map((p, i) => ({
      ...p,
      _key: `${p.title_slug}-${i}`,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(snapshot.problems.map((p, i) => ({ ...p, _key: `${p.title_slug}-${i}` })));
  }, [snapshot.problems]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const addRow = () =>
    setDraft((d) => [
      ...d,
      { title_slug: "", difficulty: "easy", points: 1, order: d.length, _key: `new-${Date.now()}` },
    ]);

  const delRow = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const cleaned = draft
        .map((p, i) => ({
          title_slug: p.title_slug.trim(),
          difficulty: p.difficulty,
          points: Number(p.points) || 0,
          order: i,
          title: p.title ?? null,
        }))
        .filter((p) => p.title_slug);
      await api("/api/admin/problems", {
        method: "PUT",
        token,
        body: JSON.stringify({ problems: cleaned }),
      });
      setMsg({ ok: true, text: `已儲存 ${cleaned.length} 題` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? `${e.status}: ${e.message}` : String(e) });
    }
    setBusy(false);
  };

  return (
    <div className="surface rounded-3xl p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-lg">題目設定</h2>
        <span className="text-[10px] text-ink-300">總分 {draft.reduce((s, p) => s + (Number(p.points) || 0), 0)} pt</span>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {draft.map((p, i) => (
          <div key={p._key} className="grid grid-cols-[1fr_90px_70px_28px] gap-2 items-center">
            <input
              value={p.title_slug}
              onChange={(e) => update(i, { title_slug: e.target.value })}
              placeholder="title-slug"
              disabled={locked}
              className="px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-sm font-mono disabled:opacity-50"
            />
            <select
              value={p.difficulty}
              onChange={(e) => update(i, { difficulty: e.target.value as ProblemPayload["difficulty"] })}
              disabled={locked}
              className="px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-sm disabled:opacity-50"
              style={{ color: difficultyColor(p.difficulty) }}
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
            <input
              type="number"
              value={p.points}
              min={0}
              onChange={(e) => update(i, { points: Number(e.target.value) })}
              disabled={locked}
              className="px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-sm tabular disabled:opacity-50"
            />
            <button
              onClick={() => delRow(i)}
              disabled={locked}
              title="刪除"
              className="text-ink-300 hover:text-g-red disabled:opacity-30"
            >×</button>
          </div>
        ))}
      </div>

      {!locked && (
        <button onClick={addRow} className="mt-3 text-xs px-2 py-1 rounded bg-stage-700 hover:bg-stage-600">
          + 新增題目
        </button>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy || locked}
          className="px-4 py-1.5 rounded bg-g-blue text-white text-sm font-bold disabled:opacity-50"
        >
          {busy ? "儲存中…" : "儲存"}
        </button>
        {locked && <span className="text-[11px] text-g-yellow">比賽已開始，題目鎖定中</span>}
        {msg && <span className={"text-xs " + (msg.ok ? "text-g-green" : "text-g-red")}>{msg.text}</span>}
      </div>
    </div>
  );
}
