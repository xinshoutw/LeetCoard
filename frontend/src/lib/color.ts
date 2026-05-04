// Mirror of backend `_hash_color`. Same hue for the same username.

export function hashHue(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = (h * 31 + username.charCodeAt(i)) >>> 0;
  }
  // SHA-1 first 6 hex would match exactly; this fallback is good enough for UI tint.
  return h % 360;
}

export function userColor(username: string, fallback?: string | null): string {
  if (fallback) return fallback;
  return `oklch(72% 0.18 ${hashHue(username)})`;
}

export function difficultyColor(diff: "easy" | "medium" | "hard"): string {
  switch (diff) {
    case "easy":
      return "#34A853"; // g-green
    case "medium":
      return "#FBBC04"; // g-yellow
    case "hard":
      return "#EA4335"; // g-red
  }
}
