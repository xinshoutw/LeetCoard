import type { AdminSnapshot } from "../../lib/types";
import { fmtRelative } from "../../lib/format";

interface Props {
  snapshot: AdminSnapshot;
}

export default function PollingPanel({ snapshot }: Props) {
  const rows = Object.values(snapshot.polling_status).sort((a, b) => {
    const ta = a.last_checked_at ? Date.parse(a.last_checked_at) : 0;
    const tb = b.last_checked_at ? Date.parse(b.last_checked_at) : 0;
    return tb - ta;
  });
  const errors = rows.filter((r) => r.last_error);

  return (
    <div className="surface rounded-3xl p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-lg">輪詢狀態</h2>
        <span className="text-[10px] text-ink-300">
          {rows.length} 位 · {errors.length} 錯誤
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto text-sm">
        <div className="grid grid-cols-[1fr_90px_90px_90px] gap-2 text-[10px] text-ink-300 mb-1 px-1">
          <span>使用者</span>
          <span>最近檢查</span>
          <span>最近成功</span>
          <span>狀態</span>
        </div>
        {rows.map((r) => (
          <div key={r.username} className="grid grid-cols-[1fr_90px_90px_90px] gap-2 px-1 py-1 border-b border-white/5">
            <span className="font-bold truncate">{r.username}</span>
            <span className="text-[11px] text-ink-300 font-mono">{fmtRelative(r.last_checked_at)}</span>
            <span className="text-[11px] text-ink-300 font-mono">{fmtRelative(r.last_success_at)}</span>
            {r.last_error ? (
              <span className="text-[11px] text-g-red truncate" title={r.last_error}>
                ⚠ {r.last_error}
              </span>
            ) : (
              <span className="text-[11px] text-g-green">OK</span>
            )}
          </div>
        ))}
        {!rows.length && (
          <div className="text-center text-ink-300 py-6 text-sm">尚未開始輪詢</div>
        )}
      </div>
    </div>
  );
}
