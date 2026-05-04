import { useEffect, useRef, useState } from "react";
import Stairs from "./Stairs";
import StickmanFigure from "./StickmanFigure";
import type { LeaderboardRow } from "../../lib/types";

interface Props {
  rows: LeaderboardRow[];
  status: "setup" | "precheck" | "running" | "ended";
}

const TOTAL_STEPS = 11; // 0..10

/**
 * Lay out figures so:
 * - Same-score figures spread horizontally with deterministic spacing.
 * - Top platform (10 pts) packs them tighter and is unbounded.
 * - Pre-start status: line them up on the bottom platform in rank order.
 */
function computeLayout(rows: LeaderboardRow[], width: number, height: number, status: Props["status"]) {
  const stepH = height / TOTAL_STEPS;
  const groups = new Map<number, LeaderboardRow[]>();
  for (const r of rows) {
    const key = status === "setup" || status === "precheck" ? -1 : Math.min(10, Math.max(0, r.score));
    groups.get(key) ?? groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const placed: { row: LeaderboardRow; x: number; y: number }[] = [];

  if (status === "setup" || status === "precheck") {
    // Queue them along the bottom platform — but lifted up by ~70px so the
    // foot-labels (E/M/H counts) and head-labels both stay inside the canvas.
    const queue = rows.slice().sort((a, b) => a.username.localeCompare(b.username));
    const spacing = Math.min(110, (width - 100) / Math.max(1, queue.length));
    const y = (TOTAL_STEPS - 1) * stepH - 90;
    queue.forEach((r, i) => {
      const startX = (width - spacing * (queue.length - 1)) / 2;
      placed.push({ row: r, x: startX + i * spacing - width / 2, y });
    });
    return placed;
  }

  // Running / ended: each score group on its own platform.
  for (const [score, group] of groups) {
    const y = (TOTAL_STEPS - 1 - score) * stepH;
    const sorted = group.slice().sort((a, b) => {
      const ta = a.reached_current_score_at ? Date.parse(a.reached_current_score_at) : Number.MAX_SAFE_INTEGER;
      const tb = b.reached_current_score_at ? Date.parse(b.reached_current_score_at) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
    const max = score === 10 ? Math.max(8, sorted.length) : 12;
    const spacing = Math.min(96, (width - 60) / Math.max(1, max));
    sorted.forEach((r, i) => {
      const startX = -((sorted.length - 1) * spacing) / 2;
      placed.push({ row: r, x: startX + i * spacing, y });
    });
  }
  return placed;
}

export default function Stickman({ rows, status }: Props) {
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

  const layout = computeLayout(rows, size.w, size.h, status);
  const preGame = status === "setup" || status === "precheck";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden surface rounded-3xl"
    >
      <Stairs totalSteps={TOTAL_STEPS} height={size.h} width={size.w} status={status} />
      <div
        className="absolute inset-0"
        style={{ transform: `translate(${size.w / 2}px, 0)` }}
      >
        {layout.map(({ row, x, y }) => (
          <StickmanFigure
            key={row.username}
            row={row}
            x={x}
            y={y}
            preGame={preGame}
            status={status}
          />
        ))}
      </div>

      {/* status overlay */}
      {(status === "setup" || status === "precheck") && (
        <div className="absolute inset-x-0 top-6 text-center pointer-events-none">
          <div className="inline-block px-6 py-2 rounded-full bg-stage-700/80 border border-g-blue/40 text-g-blue font-bold tracking-widest text-sm">
            {status === "setup" ? "STAND BY · 比賽尚未開始" : "PRE-CHECK · 賽前檢查中"}
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
