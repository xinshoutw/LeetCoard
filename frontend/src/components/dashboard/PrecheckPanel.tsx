import type { AdminSnapshot } from "../../lib/types";
import { fmtRelative } from "../../lib/format";

interface Props {
  snapshot: AdminSnapshot;
  token: string;
}

export default function PrecheckPanel({ snapshot }: Props) {
  const detected = snapshot.precheck_results.filter((r) => r.detected);
  const partial = snapshot.precheck_results.some((r) => r.confidence === "partial");

  return (
    <div className="surface rounded-3xl p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg">賽前檢查警告</h2>
        <span className="text-[10px] text-ink-300">
          已檢查 {snapshot.precheck_results.length} 項 · 命中 {detected.length}
        </span>
      </div>
      {partial && (
        <div className="mb-3 text-[11px] p-2 rounded bg-g-yellow/15 text-g-yellow border border-g-yellow/30">
          ⚠ 由於 LeetCode API 可能無法取得完整歷史紀錄，此賽前檢查結果僅供參考，可能漏判。
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {detected.length === 0 && (
          <div className="text-center text-ink-300 text-sm py-8">目前未偵測到任何疑似賽前 AC。</div>
        )}
        {detected.map((r) => (
          <div key={`${r.username}-${r.title_slug}`} className="flex items-center gap-3 py-2 border-b border-white/5">
            <span className="text-g-red text-lg">⚠</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">
                {r.username} <span className="text-ink-300 font-mono text-xs">· {r.student_id}</span>
              </div>
              <div className="text-[11px] text-ink-200 font-mono truncate">{r.title_slug}</div>
              {r.note && <div className="text-[10px] text-ink-300">{r.note}</div>}
            </div>
            <div className="text-right">
              <div
                className="text-[10px] font-bold tracking-wider"
                style={{ color: r.confidence === "full" ? "#34A853" : "#FBBC04" }}
              >
                {r.confidence.toUpperCase()}
              </div>
              <div className="text-[10px] text-ink-300">{fmtRelative(r.checked_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
