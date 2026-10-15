import { Info, Linkedin, Loader2, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Banner } from "@/components/articles/ui";
import { GhostButton, PrimaryButton } from "@/components/kora/primitives";
import {
  errorMessage,
  useLinkedInComplete,
  useLinkedInConnection,
  useLinkedInLink,
  useLinkedInUnlink,
} from "@/lib/api/hooks";
import {
  LINKEDIN_UNAVAILABLE,
  NO_CODE,
  OAUTH_FAILED,
  OAUTH_FAILURES,
  POPUP_BLOCKED,
} from "./connection";

/** Attend la fin du consentement OAuth dans le popup (message same-origin uniquement). */
function waitForOAuthCompletion(popup: Window): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "linkedin" ||
        (event.data?.type !== "appUserConnectorOAuthComplete" &&
          event.data?.type !== "appUserConnectorOAuthFailed")
      ) {
        return;
      }
      cleanup();
      if (event.data.type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      const reason = typeof event.data.error === "string" ? event.data.error : "";
      reject(new Error(OAUTH_FAILURES[reason] ?? OAUTH_FAILED));
    };
    window.addEventListener("message", onMessage);
    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("Fenêtre LinkedIn fermée avant la fin de la connexion."));
    }, 500);
  });
}

function toastError(error: unknown) {
  import("sonner").then(({ toast }) => toast.error(errorMessage(error)));
}

/**
 * Carte de connexion du compte LinkedIn de l'utilisateur courant. Chaque
 * utilisateur relie son propre compte ; les publications partent ensuite de
 * son compte. Sans connexion, l'export manuel reste disponible.
 */
export function ConnectionCard() {
  const connection = useLinkedInConnection();
  const startConnect = useLinkedInLink();
  const complete = useLinkedInComplete();
  const disconnect = useLinkedInUnlink();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function onConnect() {
    // Sans nom (une fenêtre nommée peut être ciblée par une autre page) mais sans `noopener` :
    // la page de retour a besoin de `window.opener` pour rendre le code.
    const popup = window.open("", "_blank", "width=600,height=720");
    if (!popup) {
      toastError(new Error(POPUP_BLOCKED));
      return;
    }
    setBusy(true);
    let code: string | null;
    let state: string;
    try {
      const started = await startConnect.mutateAsync(undefined);
      state = started.state;
      const completion = waitForOAuthCompletion(popup);
      popup.location.href = started.authorizationUrl;
      code = await completion;
    } catch (error) {
      popup.close();
      setBusy(false);
      toastError(error);
      return;
    }
    try {
      if (!code) throw new Error(NO_CODE);
      await complete.mutateAsync({ code, state });
      await qc.invalidateQueries({ queryKey: ["kora", "linkedinConnection"] });
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  }

  const onDisconnect = () => disconnect.mutate(undefined);

  const data = connection.data;
  const unavailable = data?.error === LINKEDIN_UNAVAILABLE;
  return (
    <Banner tone="info" icon={Info} className="mb-4 flex items-center justify-between gap-4">
      <span className="min-w-0 text-sm">
        {connection.isPending ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Connexion LinkedIn…
          </span>
        ) : data?.connected ? (
          <>
            Compte LinkedIn connecté
            {data.name ? <strong className="ml-1 font-medium">{data.name}</strong> : null} — les
            publications partiront de ce compte.
          </>
        ) : data?.reconnectRequired ? (
          <>
            Votre accès LinkedIn doit être renouvelé. Reconnectez votre compte pour publier à
            nouveau.
          </>
        ) : unavailable ? (
          <>
            Votre compte LinkedIn est relié, mais LinkedIn ne répond pas pour le moment : réessayez
            dans quelques minutes.
          </>
        ) : connection.isError ? (
          <>{errorMessage(connection.error)}</>
        ) : (
          <>
            Aucun compte LinkedIn relié : la publication reste un export manuel. Connectez votre
            compte pour publier directement.
          </>
        )}
      </span>
      {busy ? null : data?.connected ? (
        <GhostButton onClick={onDisconnect}>
          <LogOut className="size-4" /> Déconnecter
        </GhostButton>
      ) : unavailable ? (
        <span className="flex shrink-0 gap-2">
          <GhostButton onClick={() => void connection.refetch()} disabled={connection.isFetching}>
            <RefreshCw className="size-4" /> Réessayer
          </GhostButton>
          <GhostButton onClick={onDisconnect}>
            <LogOut className="size-4" /> Déconnecter
          </GhostButton>
        </span>
      ) : (
        <PrimaryButton onClick={() => void onConnect()}>
          {data?.reconnectRequired ? (
            <RefreshCw className="size-4" />
          ) : (
            <Linkedin className="size-4" />
          )}
          {data?.reconnectRequired ? "Reconnecter LinkedIn" : "Connecter mon compte LinkedIn"}
        </PrimaryButton>
      )}
    </Banner>
  );
}
