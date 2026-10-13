import { supabase } from "@/integrations/supabase/client";
import { getAuthMode, peekAuthMode } from "./mode";
import { AUTH_NOTICES, rememberAuthNotice } from "./notice";
import { currentBrowserPath, isAuthPage, loginHref } from "./redirect";
import type { AuthNotice } from "./types";

/** Jeton d'accès Supabase courant (`null` en mode démo, sans session ou côté serveur). */
export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if ((await getAuthMode()) !== "supabase") return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

let navigate = (href: string) => window.location.assign(href);
let redirecting = false;

/**
 * Session refusée par une route métier (401, ou 403 `account_not_authorized` pour un compte
 * retiré de KORA). On la retire localement (sinon la page de connexion la réutiliserait et
 * bouclerait) puis on recharge `/connexion?redirect=…`, une seule fois par page.
 */
export async function handleUnauthenticated(
  reason: AuthNotice["code"] = "unauthenticated",
): Promise<void> {
  if (typeof window === "undefined" || redirecting) return;
  const path = currentBrowserPath() ?? "/";
  if (isAuthPage(window.location.pathname)) return;
  redirecting = true;
  rememberAuthNotice(AUTH_NOTICES[reason]);
  if (peekAuthMode() === "supabase") {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // la redirection suffit : la page de connexion revérifie la session
    }
  }
  navigate(loginHref(path));
}

export function setLoginNavigatorForTests(fn: ((href: string) => void) | null): void {
  navigate = fn ?? ((href: string) => window.location.assign(href));
  redirecting = false;
}
