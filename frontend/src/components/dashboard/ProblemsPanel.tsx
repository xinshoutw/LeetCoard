import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type Difficulty = ProblemPayload["difficulty"];

interface DifficultyDefaults {
  points: number;
  tiers: BonusTier[];
}

const DIFFICULTY_DEFAULTS: Record<Difficulty, DifficultyDefaults> = {
  easy: {
    points: 5,
    tiers: [
      { min_beat_pct: 70, bonus_pts: 3 },
      { min_beat_pct: 30, bonus_pts: 2 },
      { min_beat_pct: 0, bonus_pts: 1 },
    ],
  },
  medium: {
    points: 10,
    tiers: [
      { min_beat_pct: 70, bonus_pts: 6 },
      { min_beat_pct: 30, bonus_pts: 4 },
      { min_beat_pct: 0, bonus_pts: 2 },
    ],
  },
  hard: {
    points: 20,
    tiers: [
      { min_beat_pct: 70, bonus_pts: 12 },
      { min_beat_pct: 30, bonus_pts: 8 },
      { min_beat_pct: 0, bonus_pts: 4 },
    ],
  },
};

function defaultsFor(diff: Difficulty): DifficultyDefaults {
  const d = DIFFICULTY_DEFAULTS[diff];
  return { points: d.points, tiers: d.tiers.map((t) => ({ ...t })) };
}

function toDraft(p: ProblemPayload, i: number): Draft {
  return {
    ...p,
    beat_bonus_tiers: p.beat_bonus_tiers ?? [],
    _key: `${p.title_slug}-${i}`,
    _open: false,
  };
}

function newRow(order: number): Draft {
  const defaults = defaultsFor("easy");
  return {
    title_slug: "",
    title: null,
    difficulty: "easy",
    points: defaults.points,
    order,
    beat_bonus_tiers: defaults.tiers,
    _key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    _open: false,
  };
}

export default function ProblemsPanel({ snapshot, token }: Props) {
  const locked = snapshot.status === "running" || snapshot.status === "ended";
  const [draft, setDraft] = useState<Draft[]>(() => snapshot.problems.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(snapshot.problems.map(toDraft));
  }, [snapshot.problems]);

  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const applyDifficulty = (i: number, next: Difficulty) => {
    const defaults = defaultsFor(next);
    setDraft((d) =>
      d.map((p, idx) =>
        idx === i
          ? { ...p, difficulty: next, points: defaults.points, beat_bonus_tiers: defaults.tiers }
          : p,
      ),
    );
  };

  const addRow = () => setDraft((d) => [...d, newRow(d.length)]);

  const delRow = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));

  const toggleOpen = (i: number) =>
    setDraft((d) => d.map((p, idx) => (idx === i ? { ...p, _open: !p._open } : p)));

  const addTier = (i: number) =>
    setDraft((d) =>
      d.map((p, idx) =>
        idx === i
          ? { ...p, beat_bonus_tiers: [...p.beat_bonus_tiers, { min_beat_pct: 50, bonus_pts: 1 }] }
          : p,
      ),
    );

  const removeTier = (i: number, ti: number) =>
    setDraft((d) =>
      d.map((p, idx) =>
        idx === i
          ? { ...p, beat_bonus_tiers: p.beat_bonus_tiers.filter((_, tidx) => tidx !== ti) }
          : p,
      ),
    );

  const updateTier = (i: number, ti: number, patch: Partial<BonusTier>) =>
    setDraft((d) =>
      d.map((p, idx) =>
        idx === i
          ? {
              ...p,
              beat_bonus_tiers: p.beat_bonus_tiers.map((t, tidx) =>
                tidx === ti ? { ...t, ...patch } : t,
              ),
            }
          : p,
      ),
    );

  const onPick = async (i: number, slug: string, title: string) => {
    update(i, { title_slug: slug, title });
    try {
      const detail = await api<{ title: string; difficulty: Difficulty }>(
        `/api/admin/leetcode/problem/${encodeURIComponent(slug)}`,
        { token },
      );
      applyDifficulty(i, detail.difficulty);
      // Apply canonical title from upstream too in case search returned a stale name.
      update(i, { title: detail.title });
    } catch {
      // Silent fallback: keep whatever defaults the row already has.
    }
  };

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

  const totalScore = draft.reduce((s, p) => {
    const base = Number(p.points) || 0;
    const maxTier = p.beat_bonus_tiers.reduce((m, t) => Math.max(m, Number(t.bonus_pts) || 0), 0);
    return s + base + maxTier;
  }, 0);

  return (
    <div className="surface rounded-3xl p-5 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h2 className="font-bold text-lg">題目設定</h2>
        <span className="text-[10px] text-ink-300">最高可得 {totalScore} pt</span>
      </div>

      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
        {draft.map((p, i) => {
          const tierCount = p.beat_bonus_tiers.length;
          return (
            <div key={p._key}>
              <div className="grid grid-cols-[1fr_72px_64px_auto_24px] gap-2 items-center">
                <SlugSearch
                  value={p.title_slug}
                  title={p.title ?? null}
                  disabled={locked}
                  token={token}
                  onChange={(v) => update(i, { title_slug: v })}
                  onPick={(slug, title) => onPick(i, slug, title)}
                />
                <span
                  className="px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-[11px] uppercase font-bold tracking-wide text-center"
                  style={{ color: difficultyColor(p.difficulty) }}
                  title="難度由 LeetCode 自動判定"
                >
                  {p.difficulty}
                </span>
                <input
                  type="number"
                  value={p.points}
                  min={0}
                  onChange={(e) => update(i, { points: Number(e.target.value) })}
                  disabled={locked}
                  className="px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-sm tabular disabled:opacity-50"
                />
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
                >
                  ×
                </button>
              </div>

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
                        onChange={(e) =>
                          updateTier(i, ti, { min_beat_pct: Number(e.target.value) })
                        }
                        disabled={locked}
                        className="w-14 px-1 py-0.5 rounded bg-stage-900/50 border border-white/10 tabular disabled:opacity-50"
                      />
                      <span className="text-ink-300">% → +</span>
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
                        >
                          ×
                        </button>
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
        <button onClick={addRow} className="mt-3 text-xs px-2 py-1 rounded bg-stage-700 hover:bg-stage-600 shrink-0 self-start">
          + 新增題目
        </button>
      )}

      <div className="mt-3 flex items-center gap-2 shrink-0">
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

interface SearchHit {
  title: string;
  title_slug: string;
}

interface SlugSearchProps {
  value: string;
  title: string | null;
  disabled: boolean;
  token: string;
  onChange: (v: string) => void;
  onPick: (slug: string, title: string) => void;
}

function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, "-");
}

function SlugSearch({ value, disabled, token, onChange, onPick }: SlugSearchProps) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  // Track input bounds while open; capture-phase scroll catches all ancestor
  // scroll containers (the inner panel scroll, the page itself, etc.).
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Outside click — also exclude clicks inside the portal-rendered dropdown.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const runSearch = (raw: string) => {
    const q = normaliseQuery(raw);
    if (q.length < 2) {
      setHits([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setOpen(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const data = await api<{ results: SearchHit[] }>(
          `/api/admin/leetcode/search?q=${encodeURIComponent(q)}`,
          { token },
        );
        setHits(data.results);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  };

  const handleChange = (raw: string) => {
    const slug = normaliseQuery(raw);
    onChange(slug);
    runSearch(raw);
  };

  const dropdown =
    open && pos && !disabled
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
            className="max-h-64 overflow-y-auto rounded bg-stage-800 border border-white/10 shadow-glow text-sm"
          >
            {loading && <div className="px-3 py-2 text-[11px] text-ink-300">搜尋中…</div>}
            {!loading && hits.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-ink-300">沒有結果</div>
            )}
            {hits.map((h) => (
              <button
                key={h.title_slug}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(h.title_slug, h.title);
                  setOpen(false);
                }}
                className="block w-full text-left px-3 py-1.5 hover:bg-stage-700"
              >
                <div className="text-ink-100 truncate">{h.title}</div>
                <div className="text-[10px] text-ink-300 font-mono truncate">{h.title_slug}</div>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => value.length >= 2 && setOpen(true)}
        placeholder="輸入題目關鍵字…"
        disabled={disabled}
        className="w-full px-2 py-1 rounded bg-stage-900/50 border border-white/10 text-sm font-mono disabled:opacity-50"
      />
      {dropdown}
    </div>
  );
}
