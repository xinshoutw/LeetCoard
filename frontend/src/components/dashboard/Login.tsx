import { useState } from "react";

interface Props {
  error: string | null;
  onSubmit: (token: string) => void;
}

export default function Login({ error, onSubmit }: Props) {
  const [v, setV] = useState("");

  return (
    <div className="w-screen h-screen flex items-center justify-center stage-grid">
      <form
        className="surface rounded-3xl p-8 w-[420px] shadow-glow"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) onSubmit(v.trim());
        }}
      >
        <div className="flex items-center gap-3 mb-6">
          <Logo />
          <div>
            <div className="text-[10px] tracking-widest text-ink-300">GDG ON CAMPUS · NTUST</div>
            <h1 className="text-xl font-black">Admin 登入</h1>
          </div>
        </div>
        <label className="block text-xs text-ink-300 mb-2">管理員 Token</label>
        <input
          type="password"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="貼上 .env 中的 ADMIN_TOKEN"
          className="w-full px-3 py-2 rounded bg-stage-900/50 border border-white/10 outline-none focus:border-g-blue text-ink-100 font-mono"
        />
        {error && <div className="mt-3 text-sm text-g-red">{error}</div>}
        <button
          type="submit"
          className="mt-6 w-full py-2.5 rounded-xl bg-g-blue text-white font-bold hover:brightness-110 transition"
        >
          登入
        </button>
      </form>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width={36} height={36}>
      <circle cx="10" cy="11" r="4" fill="#4285F4" />
      <circle cx="22" cy="11" r="4" fill="#EA4335" />
      <circle cx="10" cy="22" r="4" fill="#FBBC04" />
      <circle cx="22" cy="22" r="4" fill="#34A853" />
    </svg>
  );
}
