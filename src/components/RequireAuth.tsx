import { Navigate } from "react-router-dom";
import { isAuthenticated } from "@/lib/auth";

/** Wraps protected routes. Redirects to /login when no token is stored. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}