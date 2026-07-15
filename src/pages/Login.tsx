import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLogin } from "@/hooks/useSahiixxData";
import { setSession } from "@/lib/auth";
import { LiveDot } from "@/components/ui";

export default function Login() {
  const [email, setEmail] = useState("admin@sahiixx.os");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const login = useLogin();
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await login.mutateAsync({
        email,
        password,
        client: "web-login",
      } as any);
      if (result.success && result.token) {
        setSession(result.token, result.user);
        navigate("/hub");
      } else {
        setError(result.success === false ? result.error : "Login failed");
      }
    } catch (e: any) {
      const msg = e?.message ?? "Login failed — backend unreachable.";
      setError(
        msg.includes("TOO_MANY") || msg.includes("Too many")
          ? "Too many attempts. Wait a few minutes and try again."
          : msg,
      );
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 sm:p-8 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 os-grid opacity-[0.06]" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,26,26,0.08)_0%,transparent_55%)]"
        aria-hidden
      />

      <form
        onSubmit={onSubmit}
        className="relative border border-surface-hover bg-surface/90 backdrop-blur-sm p-6 sm:p-8 rounded-lg w-full max-w-sm space-y-5 shadow-[0_0_60px_-20px_rgba(255,26,26,0.25)]"
      >
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-red-primary/60 to-transparent" />

        <div className="text-center space-y-2">
          <h1 className="font-display text-2xl tracking-[0.3em] text-red-primary">
            SAHIIXX OS
          </h1>
          <p className="font-mono text-[10px] text-text-muted tracking-[0.35em]">
            AUTHENTICATE
          </p>
          <div className="flex justify-center pt-1">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-text-secondary border border-surface-hover rounded px-2 py-0.5">
              <LiveDot ok />
              EDGE · PAGES
            </span>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="font-mono text-[10px] text-text-secondary tracking-[0.25em]">
            EMAIL
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className="w-full bg-void border border-surface-hover rounded px-3 py-2.5 font-mono text-sm text-text-primary focus:border-red-primary/70 focus:ring-1 focus:ring-red-primary/30 outline-none transition-colors"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="font-mono text-[10px] text-text-secondary tracking-[0.25em]">
            PASSWORD
          </span>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-void border border-surface-hover rounded px-3 py-2.5 pr-16 font-mono text-sm text-text-primary focus:border-red-primary/70 focus:ring-1 focus:ring-red-primary/30 outline-none transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-text-muted hover:text-text-secondary px-1"
            >
              {showPw ? "HIDE" : "SHOW"}
            </button>
          </div>
        </label>

        {error && (
          <div
            role="alert"
            className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={login.isPending || !email || !password}
          className="w-full bg-red-primary text-black font-mono text-sm tracking-[0.25em] py-2.5 rounded hover:bg-red-glow transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {login.isPending ? "AUTHENTICATING…" : "LOGIN"}
        </button>

        <p className="font-mono text-[10px] text-text-muted text-center leading-relaxed">
          Session JWT · 12h · rate-limited
          <br />
          <Link to="/" className="text-text-secondary hover:text-red-primary underline-offset-2 hover:underline">
            ← boot sequence
          </Link>
        </p>
      </form>
    </div>
  );
}
