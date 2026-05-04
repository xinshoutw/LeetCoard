import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useContestStream } from "../hooks/useContestStream";
import Login from "../components/dashboard/Login";
import ContestPanel from "../components/dashboard/ContestPanel";
import ProblemsPanel from "../components/dashboard/ProblemsPanel";
import ParticipantsPanel from "../components/dashboard/ParticipantsPanel";
import PrecheckPanel from "../components/dashboard/PrecheckPanel";
import PollingPanel from "../components/dashboard/PollingPanel";
import SystemPanel from "../components/dashboard/SystemPanel";
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
    <div className="w-screen min-h-screen stage-grid p-5">
      <header className="flex items-center justify-between surface rounded-2xl px-6 py-3 mb-4">
        <div>
          <div className="text-xs tracking-widest text-ink-300">GDG NTUST · ADMIN DASHBOARD</div>
          <h1 className="text-xl font-black">控制中心</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className={"text-xs px-2 py-1 rounded font-mono " + (conn.connected ? "bg-g-green/20 text-g-green" : "bg-g-red/20 text-g-red")}>
            {conn.connected ? "LIVE" : "OFFLINE"}
          </span>
          <button
            onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded bg-stage-700 hover:bg-stage-600 text-ink-200"
          >登出</button>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12 lg:col-span-4">
          <ContestPanel snapshot={adminSnap} token={token} />
        </section>
        <section className="col-span-12 lg:col-span-4">
          <ProblemsPanel snapshot={adminSnap} token={token} />
        </section>
        <section className="col-span-12 lg:col-span-4">
          <ParticipantsPanel snapshot={adminSnap} token={token} />
        </section>

        <section className="col-span-12 lg:col-span-6">
          <PrecheckPanel snapshot={adminSnap} token={token} />
        </section>
        <section className="col-span-12 lg:col-span-6">
          <PollingPanel snapshot={adminSnap} />
        </section>

        <section className="col-span-12 lg:col-span-6">
          <EventsPanel snapshot={adminSnap} />
        </section>
        <section className="col-span-12 lg:col-span-6">
          <SystemPanel snapshot={adminSnap} />
        </section>
      </div>
    </div>
  );
}
