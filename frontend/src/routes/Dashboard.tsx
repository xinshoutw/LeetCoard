import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useContestStream } from "../hooks/useContestStream";
import Login from "../components/dashboard/Login";
import ContestPanel from "../components/dashboard/ContestPanel";
import ProblemsPanel from "../components/dashboard/ProblemsPanel";
import ParticipantsPanel from "../components/dashboard/ParticipantsPanel";
import EventsPanel from "../components/dashboard/EventsPanel";
import type { AdminSnapshot } from "../lib/types";

const TOKEN_KEY = "gdg-leetcode.admin-token";

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [authError, setAuthError] = useState<string | null>(null);

  // Auth check on mount / token change
  useEffect(() => {
    if (!token) return;
    api<{ ok: true }>("/api/admin/auth/check", { token })
      .then(() => setAuthError(null))
      .catch((e: ApiError) => {
        if (e.status === 401) {
          setToken(null);
          localStorage.removeItem(TOKEN_KEY);
          setAuthError("Token 無效，請重新登入");
        }
      });
  }, [token]);

  if (!token) {
    return (
      <Login
        error={authError}
        onSubmit={(t) => {
          localStorage.setItem(TOKEN_KEY, t);
          setToken(t);
          setAuthError(null);
        }}
      />
    );
  }

  return <DashboardInner token={token} onLogout={() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }} />;
}

function DashboardInner({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { snapshot, conn } = useContestStream({ audience: "admin", token });
  const adminSnap = snapshot as AdminSnapshot | null;

  if (!adminSnap) {
    return (
      <div className="w-screen h-screen flex items-center justify-center text-ink-300">
        正在載入 dashboard…
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col stage-grid p-5 gap-4">
      <header className="flex items-center justify-between surface rounded-2xl px-6 py-3 shrink-0">
        <div>
          <h1 className="text-xl font-black">控制中心</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className={"text-xs px-2 py-1 rounded font-mono " + (conn.connected ? "bg-g-green/20 text-g-green" : "bg-g-red/20 text-g-red")}>
            {conn.connected ? "CONNECTED" : "OFFLINE"}
          </span>
          <button
            onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded bg-stage-700 hover:bg-stage-600 text-ink-200"
          >登出</button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-12 grid-rows-2 gap-4 min-h-0">
        <section className="col-span-12 lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:row-span-1 min-h-0">
          <ContestPanel snapshot={adminSnap} token={token} />
        </section>
        <section className="col-span-12 lg:col-span-4 lg:col-start-1 lg:row-start-2 lg:row-span-1 min-h-0">
          <ProblemsPanel snapshot={adminSnap} token={token} />
        </section>
        <section className="col-span-12 lg:col-span-4 lg:col-start-5 lg:row-start-1 lg:row-span-2 min-h-0">
          <EventsPanel snapshot={adminSnap} />
        </section>
        <section className="col-span-12 lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:row-span-2 min-h-0">
          <ParticipantsPanel snapshot={adminSnap} token={token} />
        </section>
      </div>
    </div>
  );
}
