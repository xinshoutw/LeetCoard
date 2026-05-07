// Direct calls to leetcode-api-pied. The upstream sends
// `Access-Control-Allow-Origin: *`, so the browser can hit it without a
// backend proxy.

const BASE = "https://leetcode-api-pied.vercel.app";

export interface LcSearchHit {
  title: string;
  title_slug: string;
  frontend_id: string | null;
}

export interface LcProblemDetail {
  title: string;
  title_slug: string;
  difficulty: "easy" | "medium" | "hard";
  frontend_id: string | null;
}

function pickFrontendId(d: Record<string, unknown>): string | null {
  const raw = d.questionFrontendId ?? d.frontend_id ?? d.questionId ?? d.id;
  return raw == null ? null : String(raw);
}

export async function searchProblems(query: string, limit = 12): Promise<LcSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await fetch(`${BASE}/search?query=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  const out: LcSearchHit[] = [];
  for (const item of arr.slice(0, limit)) {
    if (!item || typeof item !== "object") continue;
    const slug = (item.title_slug ?? item.titleSlug) as string | undefined;
    const title = item.title as string | undefined;
    if (!slug || !title) continue;
    out.push({ title, title_slug: slug, frontend_id: pickFrontendId(item) });
  }
  return out;
}

export async function getProblemDetail(slug: string): Promise<LcProblemDetail | null> {
  const res = await fetch(`${BASE}/problem/${encodeURIComponent(slug)}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || typeof data !== "object") return null;
  const raw = String(data.difficulty ?? "").toLowerCase();
  if (raw !== "easy" && raw !== "medium" && raw !== "hard") return null;
  return {
    title_slug: slug,
    title: (data.title as string | undefined) ?? slug,
    difficulty: raw,
    frontend_id: pickFrontendId(data),
  };
}
