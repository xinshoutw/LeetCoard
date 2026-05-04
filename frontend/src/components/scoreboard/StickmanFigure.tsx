import { motion } from "framer-motion";
import { userColor } from "../../lib/color";
import type { LeaderboardRow } from "../../lib/types";

interface Props {
  row: LeaderboardRow;
  x: number;
  y: number;
  status: "setup" | "precheck" | "running" | "ended";
  preGame: boolean;
}

const FIGURE_W = 56;

export default function StickmanFigure({ row, x, y, status, preGame }: Props) {
  const colour = userColor(row.username, row.color);
  const isMax = row.score >= 10;
  const isFalling = status === "ended";

  return (
    <motion.div
      className="absolute"
      style={{ width: FIGURE_W, marginLeft: -FIGURE_W / 2 }}
      animate={{ x, y, opacity: 1 }}
      transition={{ type: "spring", stiffness: 130, damping: 18, mass: 0.7 }}
    >
      {/* Pre-game header: LC rank / username / student id */}
      {preGame && (
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 text-center pointer-events-none whitespace-nowrap">
          <div className="text-[10px] font-mono text-ink-300">
            #{row.lc_ranking ? row.lc_ranking.toLocaleString() : "—"}
          </div>
          <div className="text-[12px] font-bold leading-tight" style={{ color: colour }}>
            {row.username}
          </div>
          <div className="text-[10px] text-ink-300/80 font-mono">{row.student_id}</div>
        </div>
      )}

      {/* In-contest header: just rank above */}
      {!preGame && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 text-center pointer-events-none whitespace-nowrap">
          <div className="text-[10px] font-mono text-ink-300">#{row.rank}</div>
          <div className="text-[11px] font-bold leading-tight" style={{ color: colour }}>
            {row.username}
          </div>
        </div>
      )}

      {/* Halo for top platform residents */}
      {isMax && !preGame && (
        <motion.div
          className="absolute -inset-4 rounded-full"
          style={{ background: `radial-gradient(circle, ${colour}80 0%, transparent 60%)` }}
          animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        />
      )}

      <motion.svg
        viewBox="0 0 56 84"
        width={FIGURE_W}
        height={84}
        className="relative"
        animate={isFalling ? { rotate: [0, -8, 0] } : { y: [0, -3, 0] }}
        transition={{ duration: isFalling ? 1.2 : 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <ellipse cx="28" cy="80" rx="14" ry="3" fill={colour} opacity="0.35" />
        <circle cx="28" cy="14" r="9" fill={colour} stroke="#fff" strokeWidth="1.5" />
        <line x1="28" y1="23" x2="28" y2="52" stroke={colour} strokeWidth="3.5" strokeLinecap="round" />
        <line x1="28" y1="32" x2="14" y2="42" stroke={colour} strokeWidth="3" strokeLinecap="round" />
        <line x1="28" y1="32" x2="42" y2="42" stroke={colour} strokeWidth="3" strokeLinecap="round" />
        <line x1="28" y1="52" x2="18" y2="74" stroke={colour} strokeWidth="3" strokeLinecap="round" />
        <line x1="28" y1="52" x2="38" y2="74" stroke={colour} strokeWidth="3" strokeLinecap="round" />
      </motion.svg>

      {/* Pre-game footer: lifetime AC by difficulty */}
      {preGame ? (
        <div className="mt-1 mx-auto flex items-center justify-center gap-1 text-[10px] font-mono whitespace-nowrap">
          <span className="text-g-green tabular">{row.lc_easy_total}E</span>
          <span className="text-ink-300">·</span>
          <span className="text-g-yellow tabular">{row.lc_medium_total}M</span>
          <span className="text-ink-300">·</span>
          <span className="text-g-red tabular">{row.lc_hard_total}H</span>
        </div>
      ) : (
        <div
          className="mx-auto -mt-1 px-2 rounded-full text-[10px] font-bold text-stage-900 tabular"
          style={{ background: colour, width: "fit-content" }}
        >
          {row.score} pt
        </div>
      )}
    </motion.div>
  );
}
