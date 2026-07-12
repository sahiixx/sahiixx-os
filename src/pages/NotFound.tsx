import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
      <h1 className="font-display text-6xl text-red-primary">404</h1>
      <p className="font-mono text-text-secondary">SYSTEM ERROR: ROUTE NOT FOUND</p>
      <Link to="/hub" className="font-mono text-sm text-red-primary hover:text-red-glow">RETURN TO HUB</Link>
    </div>
  );
}
