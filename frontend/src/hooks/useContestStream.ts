import { useEffect, useReducer, useRef } from "react";
import { API_BASE, streamUrl } from "../lib/api";
import type {
  AdminSnapshot,
  LeaderboardRow,
  PublicSnapshot,
  SubmissionEventPayload,
} from "../lib/types";

interface ConnState {
  connected: boolean;
  error: string | null;
  reconnects: number;
  serverNow: string | null;
}

type Snapshot = PublicSnapshot | AdminSnapshot;

type Action =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "leaderboard"; leaderboard: LeaderboardRow[] }
  | { type: "submission_event"; event: SubmissionEventPayload }
  | { type: "contest_status"; status: PublicSnapshot["status"]; start: string | null; end: string | null }
  | { type: "times"; start: string | null; end: string | null }
  | { type: "problems"; problems: PublicSnapshot["problems"] }
  | { type: "reset"; snapshot: Snapshot }
  | { type: "conn"; conn: Partial<ConnState> };

interface State {
  snapshot: Snapshot | null;
  conn: ConnState;
}

const initial: State = {
  snapshot: null,
  conn: { connected: false, error: null, reconnects: 0, serverNow: null },
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "snapshot":
      return { ...state, snapshot: action.snapshot, conn: { ...state.conn, serverNow: action.snapshot.server_time } };
    case "leaderboard":
      if (!state.snapshot) return state;
      return { ...state, snapshot: { ...state.snapshot, leaderboard: action.leaderboard } };
    case "submission_event": {
      if (!state.snapshot) return state;
      const events = [...state.snapshot.events, action.event].slice(-200);
      return { ...state, snapshot: { ...state.snapshot, events } };
    }
    case "contest_status": {
      if (!state.snapshot) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          status: action.status,
          start_time: action.start,
          end_time: action.end,
        },
      };
    }
    case "times": {
      if (!state.snapshot) return state;
      return { ...state, snapshot: { ...state.snapshot, start_time: action.start, end_time: action.end } };
    }
    case "problems": {
      if (!state.snapshot) return state;
      return { ...state, snapshot: { ...state.snapshot, problems: action.problems } };
    }
    case "reset":
      return { ...state, snapshot: action.snapshot };
    case "conn":
      return { ...state, conn: { ...state.conn, ...action.conn } };
  }
}

export interface UseStreamOpts {
  audience: "public" | "admin";
  token?: string | null;
}

export function useContestStream(opts: UseStreamOpts) {
  const [state, dispatch] = useReducer(reducer, initial);
  const reconnectRef = useRef<number | null>(null);
  const reconnectCountRef = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    const open = () => {
      const path = opts.audience === "admin" ? "/api/admin/stream" : "/api/stream";
      const params: Record<string, string> = {};
      if (opts.audience === "admin" && opts.token) params.token = opts.token;
      const url = streamUrl(path, params);

      // Resync via REST snapshot first to avoid stale UI on reconnect.
      void fetch(`${API_BASE}${opts.audience === "admin" ? "/api/admin/snapshot" : "/api/snapshot"}`, {
        headers: opts.audience === "admin" && opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((snap) => {
          if (snap && !cancelled) dispatch({ type: "snapshot", snapshot: snap });
        })
        .catch(() => undefined);

      es = new EventSource(url);
      es.onopen = () => dispatch({ type: "conn", conn: { connected: true, error: null } });
      es.onerror = () => {
        dispatch({ type: "conn", conn: { connected: false, error: "stream error" } });
        es?.close();
        if (!cancelled) {
          if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
          reconnectRef.current = window.setTimeout(() => {
            reconnectCountRef.current += 1;
            dispatch({ type: "conn", conn: { reconnects: reconnectCountRef.current } });
            open();
          }, 1500 + Math.random() * 1500);
        }
      };

      es.addEventListener("snapshot", (e) =>
        dispatch({ type: "snapshot", snapshot: JSON.parse((e as MessageEvent).data) }),
      );
      es.addEventListener("leaderboard_update", (e) => {
        const { leaderboard } = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "leaderboard", leaderboard });
      });
      es.addEventListener("submission_event", (e) =>
        dispatch({ type: "submission_event", event: JSON.parse((e as MessageEvent).data) }),
      );
      es.addEventListener("contest_status", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "contest_status", status: d.status, start: d.start_time, end: d.end_time });
      });
      es.addEventListener("times_updated", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "times", start: d.start_time, end: d.end_time });
      });
      es.addEventListener("problems_updated", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "problems", problems: d.problems });
      });
      es.addEventListener("contest_reset", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        dispatch({ type: "reset", snapshot: d.snapshot });
      });
      es.addEventListener("ping", () => undefined);
    };

    open();

    return () => {
      cancelled = true;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      es?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.audience, opts.token]);

  return { snapshot: state.snapshot, conn: state.conn };
}
