import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { userColor } from "../../lib/color";
import type { ContestStatus, LeaderboardRow } from "../../lib/types";

interface Props {
  rows: LeaderboardRow[];
  status: ContestStatus;
}

const FIGURE_W = 64;
const TOP_RESERVE = 80;
const BOTTOM_RESERVE = 96;
const SLOT_MAX = 120;
const SLOT_MIN = 56;

interface Placed {
  row: LeaderboardRow;
  x: number;
  y: number;
}

function computePlaced(
  rows: LeaderboardRow[],
  width: number,
  height: number,
  status: ContestStatus,
): Placed[] {
  if (rows.length === 0) return [];

  const usable = Math.max(40, height - TOP_RESERVE - BOTTOM_RESERVE);
  const sorted = [...rows].sort((a, b) => a.username.localeCompare(b.username));
  const slotW = Math.max(SLOT_MIN, Math.min(SLOT_MAX, (width - 80) / sorted.length));
  const maxScore = Math.max(1, ...rows.map((r) => r.score));
  const isPreGame = status === "setup";

  return sorted.map((row, i) => {
    const x = (i - (sorted.length - 1) / 2) * slotW;
    const ratio = isPreGame ? 0 : Math.min(1, row.score / maxScore);
    const y = TOP_RESERVE + (1 - ratio) * usable;
    return { row, x, y };
  });
}

export default function ProgressTrack({ rows, status }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 760 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    return () => ro.disconnect();
  }, []);

  const placed = computePlaced(rows, size.w, size.h, status);
  const preGame = status === "setup";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden surface rounded-3xl"
    >
      {/* Subtle vertical gradient: highlight at top, ground at bottom */}
      <div className="absolute inset-x-0 top-0 h-40 pointer-events-none bg-gradient-to-b from-g-yellow/10 to-transparent" />
      <div className="absolute inset-x-8 bottom-[88px] h-px bg-white/10" />
      <div className="absolute inset-x-8 top-[72px] h-px bg-g-yellow/20" />

      {/* Figures absolutely positioned, x relative to the centre line */}
      <div
        className="absolute inset-0"
        style={{ transform: `translateX(${size.w / 2}px)` }}
      >
        {placed.map(({ row, x, y }) => (
          <Figure key={row.username} row={row} x={x} y={y} preGame={preGame} />
        ))}
      </div>

      {status === "setup" && (
        <div className="absolute inset-x-0 top-6 text-center pointer-events-none">
          <div className="inline-block px-6 py-2 rounded-full bg-stage-700/80 border border-g-blue/40 text-g-blue font-bold tracking-widest text-sm">
            STAND BY · 比賽尚未開始
          </div>
        </div>
      )}
      {status === "ended" && (
        <div className="absolute inset-x-0 top-6 text-center pointer-events-none">
          <div className="inline-block px-6 py-2 rounded-full bg-g-yellow/80 text-stage-900 font-black tracking-widest text-sm">
            CONTEST ENDED · 比賽結束
          </div>
        </div>
      )}
    </div>
  );
}

interface FigureProps {
  row: LeaderboardRow;
  x: number;
  y: number;
  preGame: boolean;
}

function Figure({ row, x, y, preGame }: FigureProps) {
  const colour = userColor(row.username, row.color);
  return (
    <motion.div
      className="absolute left-0 top-0"
      style={{ width: FIGURE_W, marginLeft: -FIGURE_W / 2 }}
      animate={{ x, y, opacity: 1 }}
      transition={{ type: "spring", stiffness: 130, damping: 20, mass: 0.7 }}
    >
      <div className="flex flex-col items-center pointer-events-none select-none">
        <div
          className="size-12 rounded-full overflow-hidden flex-shrink-0"
          style={{ boxShadow: `0 0 0 2px ${colour}, 0 0 0 4px rgba(0,0,0,0.4)` }}
        >
          {row.avatar_url ? (
            <img src={row.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            <div
              className="size-full flex items-center justify-center text-stage-900 font-black text-base"
              style={{ background: colour }}
            >
              {row.username.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div
          className="mt-1 text-[11px] font-bold leading-tight tracking-tight whitespace-nowrap"
          style={{ color: colour }}
        >
          {row.username}
        </div>
        {preGame ? (
          <>
            <div className="text-[10px] font-mono text-ink-300 leading-tight">
              #{row.lc_ranking ?? "—"}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] font-mono whitespace-nowrap">
              <span className="text-g-green tabular">{row.lc_easy_total}</span>
              <span className="text-ink-300">·</span>
              <span className="text-g-yellow tabular">{row.lc_medium_total}</span>
              <span className="text-ink-300">·</span>
              <span className="text-g-red tabular">{row.lc_hard_total}</span>
            </div>
          </>
        ) : (
          <div
            className="mt-1 px-2 rounded-full text-[10px] font-bold text-stage-900 tabular"
            style={{ background: colour }}
          >
            {row.score} pt
          </div>
        )}
      </div>
    </motion.div>
  );
}
