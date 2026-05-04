import { useEffect, useState } from "react";
import type { ContestStatus } from "../../lib/types";
import { fmtDuration } from "../../lib/format";

interface Props {
  status: ContestStatus;
  startTime: string | null;
  endTime: string | null;
  connected: boolean;
}

const STATUS_LABEL: Record<ContestStatus, { text: string; color: string }> = {
  setup: { text: "尚未開始 · SETUP", color: "#9aa3c7" },
  precheck: { text: "賽前檢查 · PRE-CHECK", color: "#4285F4" },
  running: { text: "比賽進行中 · RUNNING", color: "#34A853" },
  ended: { text: "比賽結束 · ENDED", color: "#FBBC04" },
};

export default function Header({ status, startTime, endTime, connected }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { text, color } = STATUS_LABEL[status];
  const start = startTime ? Date.parse(startTime) : null;
  const end = endTime ? Date.parse(endTime) : null;

  let countdown: string | null = null;
  let countdownLabel: string | null = null;
  if (status === "setup" || status === "precheck") {
    if (start && start > now) {
      countdown = fmtDuration(start - now);
      countdownLabel = "距開始";
    }
  } else if (status === "running" && end) {
    countdown = fmtDuration(Math.max(0, end - now));
    countdownLabel = "剩餘時間";
  } else if (status === "ended") {
    countdown = "—";
    countdownLabel = "結束";
  }

  return (
    <div className="flex items-center justify-between px-8 py-4 surface rounded-3xl">
      <div className="flex items-center gap-4">
        <div className="size-10 rounded-2xl bg-stage-700 flex items-center justify-center shadow-glow">
          <Logo />
        </div>
        <div>
          <div className="text-[11px] tracking-[0.3em] text-ink-300 font-mono">
            GDG ON CAMPUS · NTUST
          </div>
          <div className="text-2xl font-black tracking-wide">LeetCode 競賽計分板</div>
        </div>
      </div>

      <div className="flex items-center gap-8">
        <StatusPill text={text} color={color} />
        {countdown && (
          <div className="text-right">
            <div className="text-[11px] text-ink-300 tracking-widest">{countdownLabel}</div>
            <div className="text-3xl font-black tabular">{countdown}</div>
          </div>
        )}
        <div
          className={
            "size-3 rounded-full " +
            (connected ? "bg-g-green shadow-glow-green" : "bg-g-red animate-pulse")
          }
          title={connected ? "Live" : "Disconnected — reconnecting"}
        />
      </div>
    </div>
  );
}

function StatusPill({ text, color }: { text: string; color: string }) {
  return (
    <div
      className="px-4 py-1.5 rounded-full font-bold text-sm tracking-wider"
      style={{
        color,
        background: `${color}22`,
        border: `1px solid ${color}66`,
      }}
    >
      {text}
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width={26} height={26}>
      <circle cx="10" cy="11" r="4" fill="#4285F4" />
      <circle cx="22" cy="11" r="4" fill="#EA4335" />
      <circle cx="10" cy="22" r="4" fill="#FBBC04" />
      <circle cx="22" cy="22" r="4" fill="#34A853" />
    </svg>
  );
}
