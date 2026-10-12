import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api/types";
import { setAuthModeForTests } from "@/server/auth/mode";
import { verifyAccessToken } from "@/server/auth/token";
import { HttpError } from "@/server/http";
import { handleApiRequest } from "@/server/router";
import { setup, teardown } from "./helpers";

/** Vérification réelle via supabase-js `getClaims`, hors ligne : JWKS servi par un `fetch` simulé. */
const SUPABASE_URL = "https://kora-test.supabase.invalid";
const PUBLISHABLE_KEY = "sb_publishable_test";
const KID = "cle-test";
const SUB = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

let signing: CryptoKeyPair;
let publicJwk: JsonWebKey;
let jwksReachable = true;

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!jwksReachable) throw new TypeError("fetch failed");
  if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) {
    return Response.json({ keys: [{ ...publicJwk, kid: KID, alg: "ES256", use: "sig" }] });
  }
  return new Response("introuvable", { status: 404 });
});

const b64url = (data: Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? new TextEncoder().encode(data) : data).toString(
    "base64url",
  );

async function jwt(
  payload: Record<string, unknown>,
  key = signing.privateKey,
  kid = KID,
  alg = "ES256",
) {
  const head = b64url(JSON.stringify({ alg, typ: "JWT", kid }));
  const body = b64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown> = {}) => ({
  sub: SUB,
  email: "Sophie.Martin@Inovallee.com",
  role: "authenticated",
  aud: "authenticated",
  iat: nowSec(),
  exp: nowSec() + 600,
  ...extra,
});

beforeAll(async () => {
  signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  publicJwk = await crypto.subtle.exportKey("jwk", signing.publicKey);
  vi.stubEnv("SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fetchMock);
});
beforeEach(() => {
  jwksReachable = true;
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("vérification des jetons Supabase (getClaims)", () => {
  it("renvoie sub, e-mail en minuscules et expiration d'un jeton valide", async () => {
    const payload = claims();
    await expect(verifyAccessToken(await jwt(payload))).resolves.toEqual({
      sub: SUB,
      email: "sophie.martin@inovallee.com",
      exp: payload.exp,
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe(PUBLISHABLE_KEY);
    expect(headers.get("authorization")).not.toBe(`Bearer ${PUBLISHABLE_KEY}`);
  });

  it("rejette les jetons expirés, falsifiés, anonymes ou sans sujet", async () => {
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const { sub: _sub, ...withoutSub } = claims();
    for (const token of [
      await jwt(claims({ exp: nowSec() - 10 })),
      await jwt(claims(), other.privateKey),
      await jwt(claims({ is_anonymous: true })),
      await jwt(withoutSub),
      "pas-un-jwt",
    ]) {
      await expect(verifyAccessToken(token)).resolves.toBeNull();
    }
  });

  it("rejette (null, jamais d'exception) un jeton à l'algorithme inattendu", async () => {
    for (const alg of ["ES384", "RS256", "PS256", "EdDSA"]) {
      await expect(
        verifyAccessToken(await jwt(claims(), signing.privateKey, KID, alg)),
        alg,
      ).resolves.toBeNull();
    }
  });

  it("n'accepte que les jetons d'utilisateur connecté (role et aud « authenticated »)", async () => {
    const { role: _role, ...withoutRole } = claims();
    const { aud: _aud, ...withoutAud } = claims();
    for (const payload of [
      claims({ role: "service_role" }),
      claims({ role: "anon" }),
      claims({ aud: "autre" }),
      claims({ aud: ["autre"] }),
      withoutRole,
      withoutAud,
    ]) {
      await expect(
        verifyAccessToken(await jwt(payload)),
        JSON.stringify(payload),
      ).resolves.toBeNull();
    }
    await expect(
      verifyAccessToken(await jwt(claims({ aud: ["authenticated", "autre"] }))),
    ).resolves.toMatchObject({ sub: SUB });
  });

  it("via le routeur : 401 et non 500 pour un algorithme inattendu ou un rôle non autorisé", async () => {
    setup();
    setAuthModeForTests("supabase");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const token of [
        await jwt(claims(), signing.privateKey, KID, "ES384"),
        await jwt(claims({ role: "service_role" })),
      ]) {
        const res = await handleApiRequest(
          new Request("https://kora.example/api/me", {
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        expect(res.status).toBe(401);
        expect(((await res.json()) as ApiErrorBody).error.code).toBe("unauthenticated");
      }
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      setAuthModeForTests(null);
      teardown();
    }
  });

  it("répond 503 quand les clés de signature sont injoignables", async () => {
    jwksReachable = false;
    const error = await verifyAccessToken(
      await jwt(claims(), signing.privateKey, "autre-cle"),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect((error as HttpError).code).toBe("auth_unavailable");
  });
});
