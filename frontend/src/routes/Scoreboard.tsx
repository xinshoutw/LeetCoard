import { useContestStream } from "../hooks/useContestStream";
import Header from "../components/scoreboard/Header";
import Leaderboard from "../components/scoreboard/Leaderboard";
import EventFeed from "../components/scoreboard/EventFeed";
import ProgressTrack from "../components/scoreboard/ProgressTrack";

export default function Scoreboard() {
  const { snapshot, conn } = useContestStream({ audience: "public" });

  if (!snapshot) {
    return (
      <div className="w-screen h-screen flex items-center justify-center text-ink-300">
        <div className="text-center">
          <div className="text-2xl font-black mb-2">連線中…</div>
          <div className="text-sm">與後端建立資料串流</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen p-5 flex flex-col gap-5 stage-grid">
      <Header
        status={snapshot.status}
        startTime={snapshot.start_time}
        endTime={snapshot.end_time}
        connected={conn.connected}
      />
      <div className="flex-1 grid grid-cols-[360px_1fr_360px] gap-5 min-h-0">
        <Leaderboard rows={snapshot.leaderboard} problems={snapshot.problems} />
        <ProgressTrack rows={snapshot.leaderboard} status={snapshot.status} />
        <EventFeed events={snapshot.events} problems={snapshot.problems} />
      </div>
    </div>
  );
}
