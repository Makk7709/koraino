import { postUrl } from "./ugcPost";

/**
 * Traduction des refus LinkedIn / passerelle en messages utilisateur.
 * Codes documentés : https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api
 * (section « Common Creation Errors »).
 */

export type LinkedInStep = "identification" | "publication";

export type LinkedInFailure =
  | { kind: "reconnect_required"; message: string }
  | {
      kind: "api_error";
      message: string;
      /** Le post existe peut-être déjà sur LinkedIn : vérifier le fil avant toute nouvelle tentative. */
      verifyBeforeRetry?: true;
    };

const RECONNECT = "reconnectez votre compte depuis la page LinkedIn";
const RECONNECT_SENTENCE = "Reconnectez votre compte depuis la page LinkedIn";

interface ErrorBody {
  /** Type d'erreur de la passerelle Lovable (`credential_*` = autorisation à renouveler). */
  type: string | undefined;
  message: string | undefined;
  code: string | undefined;
}

function parseErrorBody(text: string): ErrorBody {
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // corps non JSON (page HTML d'un proxy, réponse vide…)
  }
  const field = (name: string) => {
    const value =
      body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  return { type: field("type"), message: field("message"), code: field("code") };
}

/** Extrait d'une réponse sur une ligne, borné (journaux et messages). */
export function excerpt(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function retryDelay(headers: Headers): string {
  const seconds = Number(headers.get("retry-after") ?? "");
  return Number.isFinite(seconds) && seconds > 0
    ? `dans ${Math.ceil(seconds / 60)} min environ`
    : "plus tard";
}

function action(step: LinkedInStep): string {
  return step === "publication" ? "la publication" : "l'identification";
}

/** Réponse HTTP non 2xx (de LinkedIn ou de la passerelle) => résultat pour l'appelant. */
export function mapFailure(
  step: LinkedInStep,
  status: number,
  bodyText: string,
  headers: Headers,
): LinkedInFailure {
  const body = parseErrorBody(bodyText);
  const detail = body.message ? ` : « ${excerpt(body.message, 200)} »` : "";

  if (status === 401) {
    if (body.type === "credential_scopes_stale") {
      return {
        kind: "reconnect_required",
        message:
          step === "publication"
            ? `KORA n'a pas l'autorisation de publier des posts sur votre compte LinkedIn : ${RECONNECT} en acceptant la publication de posts en votre nom.`
            : `Les autorisations LinkedIn accordées à KORA sont incomplètes (identité du compte) : ${RECONNECT}.`,
      };
    }
    return {
      kind: "reconnect_required",
      message: `Votre autorisation LinkedIn a expiré ou a été révoquée : ${RECONNECT}.`,
    };
  }

  if (status === 403) {
    return {
      kind: "reconnect_required",
      message:
        step === "publication"
          ? `LinkedIn refuse la publication : l'autorisation de publier des posts en votre nom (w_member_social) n'est pas accordée à KORA. ${RECONNECT_SENTENCE} en acceptant cette autorisation ; si le refus persiste, le produit « Share on LinkedIn » doit être activé sur l'application LinkedIn de KORA.`
          : `LinkedIn refuse l'accès à l'identité de votre compte (autorisations openid et profile). ${RECONNECT_SENTENCE} ; si le refus persiste, le produit « Sign In with LinkedIn using OpenID Connect » doit être activé sur l'application LinkedIn de KORA.`,
    };
  }

  if (
    step === "publication" &&
    status >= 400 &&
    status < 500 &&
    /duplicate/i.test(`${body.code ?? ""} ${body.message ?? ""}`)
  ) {
    const urn = /urn:li:(?:share|ugcPost):\d+/.exec(body.message ?? "")?.[0];
    const url = urn ? postUrl(urn) : null;
    return {
      kind: "api_error",
      message: `LinkedIn refuse ce post : un contenu identique a déjà été publié récemment sur ce compte${url ? ` (${url})` : ""}. Vérifiez votre fil LinkedIn avant de republier, ou modifiez le texte.`,
      verifyBeforeRetry: true,
    };
  }

  if (status === 429) {
    return {
      kind: "api_error",
      message: `LinkedIn limite temporairement les requêtes de ce compte (quota quotidien atteint ou appels trop rapprochés) : réessayez ${retryDelay(headers)}.`,
    };
  }

  if (status >= 500) {
    return step === "publication"
      ? {
          kind: "api_error",
          message: `LinkedIn est momentanément indisponible (erreur ${status}) : le post a peut-être été publié malgré tout. Vérifiez votre fil LinkedIn avant de réessayer.`,
          verifyBeforeRetry: true,
        }
      : {
          kind: "api_error",
          message: `LinkedIn est momentanément indisponible (erreur ${status}) : réessayez dans quelques minutes.`,
        };
  }

  if (status === 409) {
    return {
      kind: "api_error",
      message:
        "LinkedIn signale un conflit d'écriture temporaire (erreur 409) : réessayez dans quelques instants.",
    };
  }

  if (step === "publication" && (status === 400 || status === 422)) {
    return {
      kind: "api_error",
      message: `LinkedIn a refusé le contenu du post (erreur ${status})${detail}.`,
    };
  }

  return {
    kind: "api_error",
    message: `LinkedIn a refusé ${action(step)} (erreur ${status})${detail}.`,
  };
}

/** Exception avant toute réponse (réseau, délai dépassé). */
export function networkFailure(step: LinkedInStep): LinkedInFailure {
  return step === "publication"
    ? {
        kind: "api_error",
        message:
          "La connexion à LinkedIn a été interrompue pendant la publication : le post a peut-être été publié. Vérifiez votre fil LinkedIn avant de réessayer.",
        verifyBeforeRetry: true,
      }
    : {
        kind: "api_error",
        message:
          "Impossible de joindre LinkedIn pour identifier votre compte : réessayez dans quelques minutes.",
      };
}

/** Réponse 2xx inexploitable. */
export function unreadableResponse(step: LinkedInStep, status: number): LinkedInFailure {
  return step === "publication"
    ? {
        kind: "api_error",
        message: `LinkedIn a accepté la publication (${status}) sans renvoyer l'identifiant du post : vérifiez votre fil LinkedIn avant de réessayer.`,
        verifyBeforeRetry: true,
      }
    : {
        kind: "api_error",
        message: `Réponse illisible de LinkedIn lors de l'identification : réessayez ; si l'erreur persiste, ${RECONNECT}.`,
      };
}

export function missingMemberId(): LinkedInFailure {
  return {
    kind: "api_error",
    message: `LinkedIn n'a pas renvoyé l'identifiant de votre compte : ${RECONNECT}.`,
  };
}
