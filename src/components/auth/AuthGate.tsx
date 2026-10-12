import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { isAuthPage, loginHref, NEW_PASSWORD_PATH } from "@/lib/auth/redirect";
import { takeMisroutedCallback, useAuth } from "@/lib/auth/session";
import { AuthLoading } from "./AuthLoading";

/**
 * Garde de l'application : en mode supabase, aucune page n'est rendue sans session
 * validée par le serveur. Le serveur reste l'autorité (chaque route vérifie le jeton).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useRouterState({ select: (s) => s.location });
  const supabaseMode = auth.status === "ready" && auth.mode === "supabase";
  const mustLogin = supabaseMode && !auth.session;

  useEffect(() => {
    if (!supabaseMode || isAuthPage(location.pathname)) return;
    if (takeMisroutedCallback(location.pathname)) {
      void navigate({ to: NEW_PASSWORD_PATH, replace: true });
      return;
    }
    if (!mustLogin) return;
    qc.removeQueries({ queryKey: ["kora"] });
    void navigate({ href: loginHref(location.href), replace: true });
  }, [supabaseMode, mustLogin, location.pathname, location.href, navigate, qc]);

  const allowed =
    auth.status === "ready" &&
    (auth.mode === "demo" || (!!auth.session && auth.verification !== "pending"));
  if (!allowed) return <AuthLoading />;
  return <>{children}</>;
}
