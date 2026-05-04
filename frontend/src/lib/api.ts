// In dev, Vite proxies `/api` to localhost:8080.
// In production (Cloudflare Pages), `_redirects` maps `/api/*` to the
// upstream API host, so the frontend always uses the relative path.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export async function api<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = { ...authHeaders(token ?? null), ...(rest.headers ?? {}) };
  const resp = await fetch(url, { ...rest, headers });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new ApiError(resp.status, detail || resp.statusText);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function streamUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
