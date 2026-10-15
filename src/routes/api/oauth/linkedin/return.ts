import { createFileRoute } from "@tanstack/react-router";

/**
 * Page de retour OAuth LinkedIn (App User Connector). Endpoint public sans
 * session : le popup d'autorisation ne peut pas charger une route protégée.
 * Il analyse les paramètres côté serveur et transmet le code à usage unique
 * (jamais la clé de connexion) à la fenêtre ouvrante via postMessage.
 */
export const Route = createFileRoute("/api/oauth/linkedin/return")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const connectorId = url.searchParams.get("connector_id") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const success = url.searchParams.get("success") === "true";
        const offlineAccessAllowed = url.searchParams.get("offline_access_allowed");
        const error = url.searchParams.get("error");

        // Sans accès hors ligne, la passerelle ne délivre aucune clé : KORA ne pourrait pas publier.
        const result =
          success && offlineAccessAllowed === "false"
            ? { success: false, connectorId, error: "offline_access_disabled" }
            : success && code
              ? { success: true, connectorId, code }
              : {
                  success: false,
                  connectorId,
                  error: error ?? (success ? "Missing code" : "OAuth failed"),
                };

        const escapeHtml = (str: string) =>
          str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

        const safeJson = JSON.stringify(result).replace(/<\//g, "<\\/");

        const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Connexion LinkedIn…</title></head>
<body>
  <p>${result.success ? "Connexion réussie, fermeture…" : "Échec : " + escapeHtml(result.error ?? "Erreur inconnue")}</p>
  <script>
    const result = ${safeJson};
    const type = result.success ? "appUserConnectorOAuthComplete" : "appUserConnectorOAuthFailed";
    const message = {
      type,
      connectorId: result.connectorId,
      code: result.code ?? null,
      error: result.error ?? null
    };
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(message, window.location.origin);
    }
    window.close();
  </script>
</body>
</html>`;

        // L'URL porte le code à usage unique : ni cache, ni fuite par l'en-tête Referer.
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      },
    },
  },
});
