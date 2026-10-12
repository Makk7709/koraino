import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallAsAppUserParams } from "@/integrations/lovable/appUserConnector";
import { LINKEDIN_SCOPES } from "@/server/handlers/connectors";
import { publishWithConnectionKey } from "@/server/linkedin/publish";
import {
  buildUgcPostBody,
  MAX_COMMENTARY_LENGTH,
  postUrl,
  prepareCommentary,
  PUBLISH_SCOPES,
  readPostId,
  USERINFO_SCOPES,
  validateCommentary,
} from "@/server/linkedin/ugcPost";

const KEY = "lovack_secret_test_key_123";
const SUB = "782bbtaQ";
const POST_URN = "urn:li:share:7383000000000000001";
const POST_URL = `https://www.linkedin.com/feed/update/${POST_URN}`;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const userinfo = (body: unknown = { sub: SUB, name: "Sophie Martin" }) => jsonResponse(200, body);

const created = (headers: Record<string, string> = { "x-restli-id": POST_URN }, body = "") =>
  new Response(body, { status: 201, headers });

/** Passerelle simulée : rejoue les réponses dans l'ordre et consigne appels et journaux. */
function gateway(...replies: Array<Response | Error>) {
  const calls: CallAsAppUserParams[] = [];
  const logs: string[] = [];
  const deps = {
    callAsAppUser: async (params: CallAsAppUserParams) => {
      calls.push(params);
      const next = replies.shift();
      if (!next) throw new Error("appel passerelle inattendu");
      if (next instanceof Error) throw next;
      return next;
    },
    log: (line: string) => {
      logs.push(line);
    },
  };
  return { calls, logs, deps };
}

function sentText(call: CallAsAppUserParams | undefined): string {
  const body = JSON.parse(String(call?.init?.body));
  return body.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LinkedIn : corps de requête Share on LinkedIn (/v2/ugcPosts)", () => {
  it("identifie le membre puis envoie exactement le corps documenté", async () => {
    const { calls, deps } = gateway(userinfo(), created());
    const result = await publishWithConnectionKey(
      KEY,
      "Bonjour Grenoble !\n\n#Innovation #Inovallée",
      deps,
    );
    expect(result).toEqual({ kind: "published", remoteId: POST_URN, url: POST_URL });
    expect(calls).toHaveLength(2);

    const [me, post] = calls;
    expect(me).toMatchObject({
      gatewayBaseUrl: "https://connector-gateway.lovable.dev",
      connectionAPIKey: KEY,
      connectorId: "linkedin",
      path: "/v2/userinfo",
      requiredScopes: ["openid", "profile"],
    });
    expect(me!.init?.method).toBe("GET");
    expect(me!.init?.body).toBeUndefined();

    expect(post).toMatchObject({
      gatewayBaseUrl: "https://connector-gateway.lovable.dev",
      connectionAPIKey: KEY,
      connectorId: "linkedin",
      path: "/v2/ugcPosts",
      requiredScopes: ["w_member_social"],
    });
    expect(post!.init?.method).toBe("POST");
    const headers = new Headers(post!.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-restli-protocol-version")).toBe("2.0.0");
    expect(headers.has("linkedin-version")).toBe(false);
    expect(post!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(post!.init?.body).toBe(
      '{"author":"urn:li:person:782bbtaQ","lifecycleState":"PUBLISHED","specificContent":{"com.linkedin.ugc.ShareContent":{"shareCommentary":{"text":"Bonjour Grenoble !\\n\\n#Innovation #Inovallée"},"shareMediaCategory":"NONE"}},"visibility":{"com.linkedin.ugc.MemberNetworkVisibility":"PUBLIC"}}',
    );
  });

  it("passe par la passerelle Lovable avec la clé de connexion et les en-têtes Rest.li", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "lovable-test-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/v2/userinfo") ? userinfo() : created(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishWithConnectionKey(KEY, "Bonjour", { log: () => {} });
    expect(result.kind).toBe("published");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [meUrl, meInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(meUrl).toBe("https://connector-gateway.lovable.dev/linkedin/v2/userinfo");
    expect(new Headers(meInit.headers).get("x-lovable-required-scopes")).toBe("openid profile");

    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://connector-gateway.lovable.dev/linkedin/v2/ugcPosts");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer lovable-test-key");
    expect(headers.get("x-connection-api-key")).toBe(KEY);
    expect(headers.get("x-lovable-required-scopes")).toBe("w_member_social");
    expect(headers.get("x-restli-protocol-version")).toBe("2.0.0");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it.each([
    ["accents", "Créée à Grenoble, l’équipe s’agrandit : ça déménage à Inovallée — « bravo » !"],
    ["retours à la ligne", "Ligne 1\nLigne 2\n\nLigne 4\n\n\nFin"],
    ["hashtags", "Lancement réussi.\n\n#Innovation #Inovallée #DeepTech #IA"],
    [
      "caractères réservés du format little",
      "Résultats (18 %) [bêta] {v2} <html> @Kora | *gras* _souligné_ ~barré~ \\ fin #tag",
    ],
    ["émojis et guillemets", "Cap sur 2027 🚀 \"citation\" 'apostrophe' & co"],
  ])("transmet le texte tel quel, sans échappement (%s)", async (_label, text) => {
    const { calls, deps } = gateway(userinfo(), created());
    const result = await publishWithConnectionKey(KEY, text, deps);
    expect(result.kind).toBe("published");
    expect(sentText(calls[1])).toBe(text);
  });

  it("normalise le texte : Unicode NFC, fins de ligne Windows, espaces en bordure", async () => {
    const { calls, deps } = gateway(userinfo(), created());
    await publishWithConnectionKey(KEY, "  \nInovalle\u0301e\r\n\r\n#Tag \n\n", deps);
    expect(sentText(calls[1])).toBe("Inovallée\n\n#Tag");
  });

  it("refuse un texte vide ou trop long sans appeler LinkedIn", async () => {
    const empty = gateway();
    expect(await publishWithConnectionKey(KEY, " \n\n ", empty.deps)).toEqual({
      kind: "api_error",
      message: "Le texte du post est vide : rien à publier sur LinkedIn.",
    });
    expect(empty.calls).toHaveLength(0);

    const tooLong = gateway();
    const text = `${"a".repeat(MAX_COMMENTARY_LENGTH - 12)}\n\n#Innovation`;
    const result = await publishWithConnectionKey(KEY, text, tooLong.deps);
    expect(result.kind).toBe("api_error");
    expect(result.kind === "api_error" && result.message).toMatch(
      /3\s001 caractères : LinkedIn en accepte 3\s000 au maximum/,
    );
    expect(tooLong.calls).toHaveLength(0);
  });

  it("accepte exactement 3 000 caractères", async () => {
    const { calls, deps } = gateway(userinfo(), created());
    const text = "é".repeat(MAX_COMMENTARY_LENGTH);
    expect((await publishWithConnectionKey(KEY, text, deps)).kind).toBe("published");
    expect(sentText(calls[1])).toHaveLength(3000);
  });
});

describe("LinkedIn : identifiant du post créé", () => {
  it("lit l'en-tête x-restli-id quelle que soit sa casse, même encodé", async () => {
    const encoded = gateway(
      userinfo(),
      created({ "X-RestLi-Id": "urn%3Ali%3AugcPost%3A7383000000000000002" }),
    );
    expect(await publishWithConnectionKey(KEY, "Bonjour", encoded.deps)).toEqual({
      kind: "published",
      remoteId: "urn:li:ugcPost:7383000000000000002",
      url: "https://www.linkedin.com/feed/update/urn:li:ugcPost:7383000000000000002",
    });
  });

  it("à défaut d'en-tête, lit le champ id du corps", async () => {
    const { deps } = gateway(
      userinfo(),
      created({ "content-type": "application/json" }, JSON.stringify({ id: POST_URN })),
    );
    expect(await publishWithConnectionKey(KEY, "Bonjour", deps)).toEqual({
      kind: "published",
      remoteId: POST_URN,
      url: POST_URL,
    });
  });

  it("garde un identifiant non URN sans inventer d'URL", async () => {
    const { deps } = gateway(userinfo(), created({ "x-restli-id": "7383000000000000003" }));
    expect(await publishWithConnectionKey(KEY, "Bonjour", deps)).toEqual({
      kind: "published",
      remoteId: "7383000000000000003",
    });
  });

  it.each([
    ["corps vide", ""],
    ["corps HTML", "<html><body>OK</body></html>"],
    ["JSON sans id", '{"status":"created"}'],
  ])("réponse 201 sans identifiant (%s) : vérification demandée", async (_label, body) => {
    const { deps, logs } = gateway(userinfo(), created({}, body));
    const result = await publishWithConnectionKey(KEY, "Bonjour", deps);
    expect(result).toMatchObject({ kind: "api_error", verifyBeforeRetry: true });
    expect(result.kind === "api_error" && result.message).toMatch(/vérifiez votre fil LinkedIn/);
    expect(logs.join("\n")).toMatch(/publication → HTTP 201 sans identifiant/);
  });
});

describe("LinkedIn : identification /v2/userinfo", () => {
  it.each([
    ["sans sub", { name: "Sophie Martin" }],
    ["sub vide", { sub: "" }],
    ["sub non textuel", { sub: 42 }],
    ["sub hors format", { sub: "abc,def)" }],
    ["corps null", null],
  ])("%s : api_error, aucune publication tentée", async (_label, body) => {
    const { calls, deps } = gateway(userinfo(body));
    const result = await publishWithConnectionKey(KEY, "Bonjour", deps);
    expect(result).toEqual({
      kind: "api_error",
      message:
        "LinkedIn n'a pas renvoyé l'identifiant de votre compte : reconnectez votre compte depuis la page LinkedIn.",
    });
    expect(calls).toHaveLength(1);
  });

  it("réponse illisible : api_error explicite", async () => {
    const { calls, deps } = gateway(new Response("<html>maintenance</html>", { status: 200 }));
    const result = await publishWithConnectionKey(KEY, "Bonjour", deps);
    expect(result.kind).toBe("api_error");
    expect(result.kind === "api_error" && result.message).toMatch(/Réponse illisible de LinkedIn/);
    expect(calls).toHaveLength(1);
  });

  it("jeton expiré côté passerelle : reconnect_required, aucune publication tentée", async () => {
    const { calls, deps } = gateway(
      jsonResponse(401, { type: "credential_refresh_token_expired", message: "Refresh failed" }),
    );
    expect(await publishWithConnectionKey(KEY, "Bonjour", deps)).toEqual({
      kind: "reconnect_required",
      message:
        "Votre autorisation LinkedIn a expiré ou a été révoquée : reconnectez votre compte depuis la page LinkedIn.",
    });
    expect(calls).toHaveLength(1);
  });

  it("403 : reconnect_required qui cite les autorisations d'identité", async () => {
    const { deps } = gateway(jsonResponse(403, { status: 403, message: "ACCESS_DENIED" }));
    const result = await publishWithConnectionKey(KEY, "Bonjour", deps);
    expect(result.kind).toBe("reconnect_required");
    expect(result.kind === "reconnect_required" && result.message).toMatch(
      /openid et profile.*Sign In with LinkedIn using OpenID Connect/,
    );
  });

  it("503 : api_error sans demande de vérification (rien n'a été publié)", async () => {
    const { calls, deps } = gateway(new Response("Service Unavailable", { status: 503 }));
    expect(await publishWithConnectionKey(KEY, "Bonjour", deps)).toEqual({
      kind: "api_error",
      message:
        "LinkedIn est momentanément indisponible (erreur 503) : réessayez dans quelques minutes.",
    });
    expect(calls).toHaveLength(1);
  });

  it("passerelle injoignable : api_error sans demande de vérification", async () => {
    const { deps } = gateway(new TypeError("fetch failed"));
    const result = await publishWithConnectionKey(KEY, "Bonjour", deps);
    expect(result).toEqual({
      kind: "api_error",
      message:
        "Impossible de joindre LinkedIn pour identifier votre compte : réessayez dans quelques minutes.",
    });
  });
});

describe("LinkedIn : erreurs de publication", () => {
  async function publishFailing(reply: Response | Error) {
    const g = gateway(userinfo(), reply);
    const result = await publishWithConnectionKey(KEY, "Bonjour Grenoble !", g.deps);
    return { result, ...g };
  }

  it("401 jeton révoqué (LinkedIn) : reconnect_required", async () => {
    const { result } = await publishFailing(
      jsonResponse(401, {
        serviceErrorCode: 65601,
        message: "The token used in the request has been revoked by the user",
        status: 401,
      }),
    );
    expect(result).toEqual({
      kind: "reconnect_required",
      message:
        "Votre autorisation LinkedIn a expiré ou a été révoquée : reconnectez votre compte depuis la page LinkedIn.",
    });
  });

  it("401 scope manquant (passerelle) : reconnect_required sur l'autorisation de publier", async () => {
    const { result } = await publishFailing(
      jsonResponse(401, { type: "credential_scopes_stale", message: "missing w_member_social" }),
    );
    expect(result).toEqual({
      kind: "reconnect_required",
      message:
        "KORA n'a pas l'autorisation de publier des posts sur votre compte LinkedIn : reconnectez votre compte depuis la page LinkedIn en acceptant la publication de posts en votre nom.",
    });
  });

  it("403 permissions insuffisantes : reconnect_required avec message explicite", async () => {
    const { result } = await publishFailing(
      jsonResponse(403, {
        serviceErrorCode: 100,
        message: "Not enough permissions to access: ugcPosts.CREATE.NO_VERSION",
        status: 403,
      }),
    );
    expect(result.kind).toBe("reconnect_required");
    expect(result.kind === "reconnect_required" && result.message).toMatch(
      /autorisation de publier des posts en votre nom \(w_member_social\).*« Share on LinkedIn »/,
    );
  });

  it("422 contenu dupliqué : api_error avec lien vers le post existant", async () => {
    const { result } = await publishFailing(
      jsonResponse(422, {
        message: "Content is a duplicate of urn:li:share:7383000000000000009",
        status: 422,
      }),
    );
    expect(result).toEqual({
      kind: "api_error",
      message:
        "LinkedIn refuse ce post : un contenu identique a déjà été publié récemment sur ce compte (https://www.linkedin.com/feed/update/urn:li:share:7383000000000000009). Vérifiez votre fil LinkedIn avant de republier, ou modifiez le texte.",
      verifyBeforeRetry: true,
    });
  });

  it("422 validation : api_error qui reprend le motif LinkedIn", async () => {
    const { result } = await publishFailing(
      jsonResponse(422, {
        message:
          "ERROR :: /specificContent/com.linkedin.ugc.ShareContent/shareCommentary :: invalid",
        status: 422,
      }),
    );
    expect(result).toEqual({
      kind: "api_error",
      message:
        "LinkedIn a refusé le contenu du post (erreur 422) : « ERROR :: /specificContent/com.linkedin.ugc.ShareContent/shareCommentary :: invalid ».",
    });
  });

  it("429 : api_error avec délai indiqué par Retry-After", async () => {
    const { result } = await publishFailing(
      jsonResponse(
        429,
        { message: "UGC action was blocked because a share limit has been reached", status: 429 },
        { "retry-after": "120" },
      ),
    );
    expect(result).toEqual({
      kind: "api_error",
      message:
        "LinkedIn limite temporairement les requêtes de ce compte (quota quotidien atteint ou appels trop rapprochés) : réessayez dans 2 min environ.",
    });
    const noHeader = await publishFailing(jsonResponse(429, { status: 429 }));
    expect(noHeader.result.kind === "api_error" && noHeader.result.message).toMatch(
      /réessayez plus tard\.$/,
    );
  });

  it.each([500, 502, 503, 504])(
    "%i : api_error, le post a peut-être été publié",
    async (status) => {
      const { result } = await publishFailing(new Response("<html>Bad gateway</html>", { status }));
      expect(result).toEqual({
        kind: "api_error",
        message: `LinkedIn est momentanément indisponible (erreur ${status}) : le post a peut-être été publié malgré tout. Vérifiez votre fil LinkedIn avant de réessayer.`,
        verifyBeforeRetry: true,
      });
    },
  );

  it("409 conflit d'écriture : api_error, nouvelle tentative possible", async () => {
    const { result } = await publishFailing(
      jsonResponse(409, { message: "Write conflict due to an internal UGC error.", status: 409 }),
    );
    expect(result).toEqual({
      kind: "api_error",
      message:
        "LinkedIn signale un conflit d'écriture temporaire (erreur 409) : réessayez dans quelques instants.",
    });
  });

  it("404 non JSON (chemin non relayé) : api_error avec le statut", async () => {
    const { result } = await publishFailing(new Response("Not Found", { status: 404 }));
    expect(result).toEqual({
      kind: "api_error",
      message: "LinkedIn a refusé la publication (erreur 404).",
    });
  });

  it.each([
    ["coupure réseau", new TypeError("fetch failed")],
    ["délai dépassé", new DOMException("The operation was aborted due to timeout", "TimeoutError")],
  ])("%s pendant la publication : vérification demandée", async (_label, error) => {
    const { result, logs } = await publishFailing(error);
    expect(result).toMatchObject({ kind: "api_error", verifyBeforeRetry: true });
    expect(logs.join("\n")).toMatch(/\[linkedin\] publication POST \/v2\/ugcPosts : échec réseau/);
  });
});

describe("LinkedIn : journalisation serveur", () => {
  it("consigne le statut et un extrait du corps", async () => {
    const { logs, deps } = gateway(
      userinfo(),
      jsonResponse(422, { message: "Error validating the post", status: 422 }),
    );
    await publishWithConnectionKey(KEY, "Bonjour", deps);
    expect(logs).toEqual([
      '[linkedin] publication POST /v2/ugcPosts → HTTP 422 : {"message":"Error validating the post","status":422}',
    ]);
  });

  it("ne journalise ni ne renvoie jamais la clé de connexion", async () => {
    const echo = `Invalid header X-Connection-Api-Key: ${KEY} / Authorization: Bearer abc.def`;
    const cases: Array<Response | Error> = [
      jsonResponse(422, { message: echo, status: 422 }),
      new Response(echo, { status: 500 }),
      new Error(`connect ECONNREFUSED (${KEY})`),
    ];
    for (const reply of cases) {
      const { logs, deps } = gateway(userinfo(), reply);
      const result = await publishWithConnectionKey(KEY, "Bonjour", deps);
      const visible = `${logs.join("\n")}\n${JSON.stringify(result)}`;
      expect(logs.length).toBeGreaterThan(0);
      expect(visible).not.toContain(KEY);
      expect(visible).not.toContain("abc.def");
    }
  });

  it("utilise console.error par défaut", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = gateway(userinfo(), new Response("boom", { status: 500 }));
    await publishWithConnectionKey(KEY, "Bonjour", { callAsAppUser: deps.callAsAppUser });
    expect(spy).toHaveBeenCalledWith("[linkedin] publication POST /v2/ugcPosts → HTTP 500 : boom");
  });
});

describe("LinkedIn : fonctions pures", () => {
  it("les scopes exigés par appel font partie des scopes demandés au consentement", () => {
    expect(LINKEDIN_SCOPES).toEqual(
      expect.arrayContaining([...USERINFO_SCOPES, ...PUBLISH_SCOPES]),
    );
  });

  it("buildUgcPostBody suit l'exemple « Create a Text Share »", () => {
    expect(buildUgcPostBody("8675309", "Hello World!")).toEqual({
      author: "urn:li:person:8675309",
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: "Hello World!" },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    });
  });

  it("validateCommentary compte en unités UTF-16, comme LinkedIn", () => {
    expect(validateCommentary("a".repeat(3000))).toBeNull();
    expect(validateCommentary("🚀".repeat(1500))).toBeNull();
    expect(validateCommentary("🚀".repeat(1501))).toMatch(/3\s002 caractères/);
    expect(validateCommentary(prepareCommentary("\t\r\n"))).toMatch(/vide/);
  });

  it("readPostId et postUrl", () => {
    expect(readPostId(new Headers({ "x-restli-id": ` ${POST_URN} ` }), "")).toBe(POST_URN);
    expect(readPostId(new Headers(), '{"id":"urn:li:share:1"}')).toBe("urn:li:share:1");
    expect(readPostId(new Headers({ "x-restli-id": "urn%3Ali%3Ashare%3A2" }), "")).toBe(
      "urn:li:share:2",
    );
    expect(readPostId(new Headers({ "x-restli-id": "%E0%A4%A" }), "")).toBe("%E0%A4%A");
    expect(readPostId(new Headers(), "null")).toBeNull();
    expect(postUrl("urn:li:activity:123")).toBe(
      "https://www.linkedin.com/feed/update/urn:li:activity:123",
    );
    expect(postUrl("urn:li:person:abc")).toBeNull();
    expect(postUrl("urn:li:share:1/../../x")).toBeNull();
  });
});
