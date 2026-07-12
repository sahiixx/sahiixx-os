import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "@/lib/auth";

const lines = [
  "> INITIALIZING SAHIIXX OS v4.0...",
  "> CONNECTING TO NEON POSTGRES...",
  "> LOADING MODULES...",
  "> NEXUS DEAL ENGINE ████████████ OK",
  "> GOLDMINE PROTOCOL ████████████ OK",
  "> SARA CONTENT FACTORY ████████████ OK",
  "> SIGNAL FEED ████████████ OK",
  "> GAPCLAW AGENT BUILDER ████████████ OK",
  "> ALL SYSTEMS OPERATIONAL",
  "",
  "> ENTERING COMMAND CENTER...",
];

export default function Boot() {
  const [visible, setVisible] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((v) => {
        if (v >= lines.length) {
          clearInterval(timer);
          setTimeout(() => navigate(isAuthenticated() ? "/hub" : "/login"), 800);
          return v;
        }
        return v + 1;
      });
    }, 300);
    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-8">
      <div className="font-mono text-sm max-w-xl w-full space-y-1">
        {lines.slice(0, visible).map((line, i) => (
          <div
            key={i}
            className={`${
              line.includes("OK") ? "text-success" : "text-red-primary"
            } animate-fade-up`}
          >
            {line}
          </div>
        ))}
        {visible < lines.length && (
          <span className="inline-block w-2 h-4 bg-red-primary animate-cursor-blink" />
        )}
      </div>
    </div>
  );
}
