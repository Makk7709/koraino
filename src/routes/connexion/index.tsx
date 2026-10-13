import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FlaskConical, ShieldAlert, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthSpinner } from "@/components/auth/AuthLoading";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { ResetRequestForm } from "@/components/auth/ResetRequestForm";
import { Notice } from "@/components/veille/kit";
import { qk } from "@/lib/api/hooks";
import { safeRedirect } from "@/lib/auth/redirect";
import { refreshAuthMode, useAuth } from "@/lib/auth/session";

export const Route = createFileRoute("/connexion/")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: safeRedirect(s["redirect"], "") || undefined,
  }),
  head: () => ({
    meta: [{ title: "Connexion — Inovallée Newsroom IA" }, { name: "robots", content: "noindex" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const target = safeRedirect(redirect);
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const left = useRef(false);

  useEffect(() => {
    void refreshAuthMode();
  }, []);

  const signedIn = auth.mode === "supabase" && !!auth.session && auth.verification === "ok";
  useEffect(() => {
    if (!signedIn || left.current) return;
    left.current = true;
    qc.removeQueries({ queryKey: ["kora"] });
    if (auth.user) qc.setQueryData(qk.me, auth.user);
    void navigate({ href: target, replace: true });
  }, [signedIn, auth.user, qc, navigate, target]);

  const checking =
    auth.status === "loading" ||
    signedIn ||
    (!!auth.session && auth.verification === "pending" && !submitting);

  if (checking) {
    return (
      <AuthPageShell title="Connexion" subtitle="Accès réservé aux équipes Inovallée.">
        <AuthSpinner className="py-10" />
      </AuthPageShell>
    );
  }

  if (auth.mode === "demo") {
    return (
      <AuthPageShell title="Mode démonstration" subtitle="Aucune connexion n'est nécessaire.">
        <div className="space-y-4">
          <Notice tone="blue" icon={FlaskConical}>
            Cette instance fonctionne avec des profils de démonstration : changez de profil depuis
            le menu utilisateur, en haut à droite de l&apos;application.
          </Notice>
          <Link
            to="/"
            className="kora-btn-primary inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-[13px] font-semibold"
          >
            Accéder au dashboard
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  if (view === "reset") {
    return (
      <AuthPageShell
        title="Mot de passe oublié"
        subtitle="Recevez par e-mail un lien pour choisir un nouveau mot de passe."
      >
        <ResetRequestForm email={email} onEmailChange={setEmail} onBack={() => setView("login")} />
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell
      title="Connexion"
      subtitle="Accédez à la newsroom avec le compte qui vous a été attribué."
    >
      <div className="space-y-4">
        {auth.notice && (
          <div role="alert">
            <Notice
              tone={auth.notice.code === "account_not_authorized" ? "rose" : "amber"}
              icon={ShieldAlert}
              title={
                auth.notice.code === "account_not_authorized"
                  ? "Compte non autorisé"
                  : "Vous avez été déconnecté"
              }
            >
              {auth.notice.message}
            </Notice>
          </div>
        )}
        <LoginForm
          email={email}
          onEmailChange={setEmail}
          onForgot={() => setView("reset")}
          onPendingChange={setSubmitting}
        />
        <p className="flex items-start gap-2 border-t border-border/80 pt-4 text-[11.5px] text-muted-foreground">
          <UserPlus className="mt-px size-3.5 shrink-0" />
          Les comptes sont créés sur invitation par un administrateur KORA : il n&apos;existe pas
          d&apos;inscription libre.
        </p>
      </div>
    </AuthPageShell>
  );
}
