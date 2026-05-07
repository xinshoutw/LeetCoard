import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { AdminSnapshot, BonusTier, ProblemPayload } from "../../lib/types";
import { difficultyColor } from "../../lib/color";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

interface Draft extends ProblemPayload {
  _key: string;
  _open: boolean;
  beat_bonus_tiers: BonusTier[];
}

const DEFAULT: ProblemPayload[] = [
  { title_slug: "two-sum", difficulty: "easy", points: 1, order: 0 },
  { title_slug: "valid-parentheses", difficulty: "easy", points: 1, order: 1 },
  { title_slug: "3sum", difficulty: "medium", points: 3, order: 2 },
  { title_slug: "trapping-rain-water", difficulty: "hard", points: 5, order: 3 },
];

function toDraft(p: ProblemPayload, i: number): Draft {
  return { ...p, beat_bonus_tiers: p.beat_bonus_tiers ?? [], _key: `${p.title_slug}-${i}`, _open: false };
}

export default function ProblemsPanel({ snapshot, token }: Props) {
  const locked = snapshot.status === "running" || snapshot.status === "ended";
  const [draft, setDraft] = useState<Draft[]>(() =>
    (snapshot.problems.length ? snapshot.problems : DEFAULT).map(toDraft),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(snapshot.problems.map(toDraft));
  }, [snapshot.problems]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const addRow = () =>
    setDraft((d) => [
      ...d,
      { title_slug: "", difficulty: "easy", points: 1, order: d.length, beat_bonus_tiers: [], _key: `new-${Date.now()}`, _open: false },
    ]);

  const delRow = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));

  const toggleOpen = (i: number) =>
    setDraft((d) => d.map((p, idx) => idx === i ? { ...p, _open: !p._open } : p));

  const addTier = (i: number) =>
    setDraft((d) => d.map((p, idx) => idx === i
      ? { ...p, beat_bonus_tiers: [...p.beat_bonus_tiers, { min_beat_pct: 80, bonus_pts: 1 }] }
      : p,
    ));

  const removeTier = (i: number, ti: number) =>
    setDraft((d) => d.map((p, idx) => idx === i
      ? { ...p, beat_bonus_tiers: p.beat_bonus_tiers.filter((_, tidx) => tidx !== ti) }
      : p,
    ));

  const updateTier = (i: number, ti: number, patch: Partial<BonusTier>) =>
    setDraft((d) => d.map((p, idx) => idx === i
      ? { ...p, beat_bonus_tiers: p.beat_bonus_tiers.map((t, tidx) => tidx === ti ? { ...t, ...patch } : t) }
      : p,
    ));

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
          beat_bonus_tiers: p.beat_bonus_tiers.map((t) => ({
            min_beat_pct: Number(t.min_beat_pct),
            bonus_pts: Number(t.bonus_pts),
          })),
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

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {draft.map((p, i) => {
          const tierCount = p.beat_bonus_tiers.length;
          return (
            <div key={p._key}>
              {/* Main row */}
              <div className="grid grid-cols-[1fr_90px_70px_auto_28px] gap-2 items-center">
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
                {/* Bonus tier toggle */}
                <button
                  onClick={() => toggleOpen(i)}
                  title={p._open ? "收合加分區間" : "展開加分區間"}
                  className={[
                    "text-[11px] px-1.5 py-0.5 rounded transition-colors whitespace-nowrap",
                    tierCount > 0
                      ? "bg-g-blue/20 text-g-blue hover:bg-g-blue/30"
                      : "bg-stage-700/50 text-ink-300 hover:bg-stage-600/50",
                  ].join(" ")}
                >
                  {tierCount > 0 ? `★ ${tierCount}` : "bonus"}
                </button>
                <button
                  onClick={() => delRow(i)}
                  disabled={locked}
                  title="刪除"
                  className="text-ink-300 hover:text-g-red disabled:opacity-30"
                >×</button>
              </div>

              {/* Tier sub-panel */}
              {p._open && (
                <div className="ml-2 mt-1.5 pl-3 border-l border-white/10 space-y-1">
                  {p.beat_bonus_tiers.length === 0 && (
                    <span className="text-[11px] text-ink-300">尚未設定加分區間</span>
                  )}
                  {p.beat_bonus_tiers.map((t, ti) => (
                    <div key={ti} className="flex items-center gap-1.5 text-xs">
                      <span className="text-ink-300 w-3 text-right">≥</span>
                      <input
                        type="number"
                        value={t.min_beat_pct}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(e) => updateTier(i, ti, { min_beat_pct: Number(e.target.value) })}
                        disabled={locked}
                        className="w-14 px-1 py-0.5 rounded bg-stage-900/50 border border-white/10 tabular disabled:opacity-50"
                      />
                      <span className="text-ink-300">%  →  +</span>
                      <input
                        type="number"
                        value={t.bonus_pts}
                        min={0}
                        step={1}
                        onChange={(e) => updateTier(i, ti, { bonus_pts: Number(e.target.value) })}
                        disabled={locked}
                        className="w-12 px-1 py-0.5 rounded bg-stage-900/50 border border-white/10 tabular disabled:opacity-50"
                      />
                      <span className="text-ink-300">pt</span>
                      {!locked && (
                        <button
                          onClick={() => removeTier(i, ti)}
                          className="text-ink-300 hover:text-g-red ml-0.5"
                        >×</button>
                      )}
                    </div>
                  ))}
                  {!locked && (
                    <button
                      onClick={() => addTier(i)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-stage-700/50 hover:bg-stage-600/50"
                    >
                      + 加分區間
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
