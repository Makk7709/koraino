import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { FlaskConical, LinkIcon, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthSpinner } from "@/components/auth/AuthLoading";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { NewPasswordForm } from "@/components/auth/NewPasswordForm";
import { Notice } from "@/components/veille/kit";
import type { AuthCallbackInfo } from "@/lib/auth/callback";
import { callbackErrorMessage } from "@/lib/auth/messages";
import { getAuthCallbackInfo, useAuth } from "@/lib/auth/session";

export const Route = createFileRoute("/connexion/nouveau-mot-de-passe")({
  head: () => ({
    meta: [
      { title: "Choisir un mot de passe — Inovallée Newsroom IA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewPasswordPage,
});

const PRIMARY_LINK =
  "kora-btn-primary inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-[13px] font-semibold";

function NewPasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Lu après l'hydratation : le fragment d'URL n'existe pas côté serveur.
  const [callback, setCallback] = useState<AuthCallbackInfo | null>(null);
  useEffect(() => setCallback(getAuthCallbackInfo()), []);

  const invite = callback?.type === "invite";
  const title = invite ? "Activez votre compte" : "Nouveau mot de passe";
  const subtitle = invite
    ? "Bienvenue sur KORA : choisissez le mot de passe de votre compte."
    : "Choisissez un nouveau mot de passe pour votre compte KORA.";

  if (callback?.error) {
    return (
      <AuthPageShell title="Lien expiré ou invalide">
        <div className="space-y-4">
          <div role="alert">
            <Notice tone="amber" icon={LinkIcon}>
              {callbackErrorMessage(callback.error.code)}
            </Notice>
          </div>
          <p className="text-[12.5px] text-kora-ink-soft">
            Pour une réinitialisation, demandez un nouveau lien avec « Mot de passe oublié ? » sur
            la page de connexion. Pour une invitation, demandez à un administrateur KORA de vous la
            renvoyer.
          </p>
          <Link to="/connexion" className={PRIMARY_LINK}>
            Aller à la page de connexion
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  if (!callback || auth.status === "loading") {
    return (
      <AuthPageShell title={title}>
        <AuthSpinner label="Vérification du lien…" className="py-10" />
      </AuthPageShell>
    );
  }

  if (auth.mode === "demo") {
    return (
      <AuthPageShell title="Mode démonstration">
        <div className="space-y-4">
          <Notice tone="blue" icon={FlaskConical}>
            Les mots de passe ne sont pas utilisés avec les profils de démonstration.
          </Notice>
          <Link to="/" className={PRIMARY_LINK}>
            Accéder au dashboard
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  if (!auth.session) {
    const refused = auth.notice?.code === "account_not_authorized";
    return (
      <AuthPageShell title={refused ? "Compte non autorisé" : "Lien expiré ou invalide"}>
        <div className="space-y-4">
          <div role="alert">
            <Notice tone={refused ? "rose" : "amber"} icon={refused ? ShieldAlert : LinkIcon}>
              {refused
                ? auth.notice?.message
                : "Ce lien a expiré, a déjà été utilisé ou n'a pas pu être vérifié. Demandez un nouveau lien depuis la page de connexion (« Mot de passe oublié ? ») ou auprès d'un administrateur."}
            </Notice>
          </div>
          <Link to="/connexion" className={PRIMARY_LINK}>
            Aller à la page de connexion
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  if (auth.verification === "pending") {
    return (
      <AuthPageShell title={title}>
        <AuthSpinner label="Vérification du compte…" className="py-10" />
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title={title} subtitle={subtitle}>
      <NewPasswordForm
        email={auth.session.user.email ?? auth.user?.email ?? ""}
        submitLabel={invite ? "Activer mon compte" : "Enregistrer le mot de passe"}
        onDone={() => {
          toast.success(
            invite ? "Compte activé : bienvenue sur KORA." : "Nouveau mot de passe enregistré.",
          );
          qc.removeQueries({ queryKey: ["kora"] });
          void navigate({ to: "/", replace: true });
        }}
      />
    </AuthPageShell>
  );
}
