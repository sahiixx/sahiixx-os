import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLogin } from "@/hooks/useSahiixxData";
import { setSession } from "@/lib/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await login.mutateAsync({ email, password });
      if (result.success && result.token) {
        setSession(result.token, result.user);
        navigate("/hub");
      } else {
        setError(result.success === false ? result.error : "Login failed");
      }
    } catch (e: any) {
      setError(e?.message ?? "Login failed — backend unreachable.");
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8">
      <form
        onSubmit={onSubmit}
        className="border border-surface-hover bg-surface p-8 rounded-lg w-full max-w-sm space-y-4"
      >
        <h1 className="font-display text-2xl tracking-widest text-red-primary text-center">
          SAHIIXX OS
        </h1>
        <p className="font-mono text-xs text-text-secondary text-center tracking-wider">
          AUTHENTICATE TO PROCEED
        </p>

        <label className="block">
          <span className="font-mono text-xs text-text-secondary tracking-wider">EMAIL</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-red-primary outline-none"
          />
        </label>

        <label className="block">
          <span className="font-mono text-xs text-text-secondary tracking-wider">PASSWORD</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full bg-void border border-surface-hover rounded px-3 py-2 font-mono text-sm text-text-primary focus:border-red-primary outline-none"
          />
        </label>

        {error && (
          <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="w-full bg-red-primary text-black font-mono text-sm tracking-widest py-2 rounded hover:bg-red-glow transition-colors disabled:opacity-50"
        >
          {login.isPending ? "AUTHENTICATING..." : "LOGIN"}
        </button>

        <p className="font-mono text-[10px] text-text-muted text-center">
          Dev default: admin@sahiixx.os / sahiixx
        </p>
      </form>
    </div>
  );
}