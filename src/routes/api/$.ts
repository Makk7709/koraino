import { createFileRoute } from "@tanstack/react-router";
import { handleApiRequest } from "@/server/router";

/** API métier KORA : toutes les requêtes /api/* sont traitées par le routeur serveur. */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request }) => handleApiRequest(request),
    },
  },
});
