import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSP_HEADER, contentSecurityPolicy, withSecurityHeaders } from "@/server/securityHeaders";

const html = (init: ResponseInit = {}) =>
  new Response("<!doctype html><title>KORA</title>", {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://projet.supabase.invalid/");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("en-têtes de sécurité des réponses du serveur", () => {
  it("une page reçoit nosniff et la politique de sécurité du contenu", () => {
    const res = withSecurityHeaders(html());
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get(CSP_HEADER)).toBe(contentSecurityPolicy());
  });

  it("une réponse JSON reçoit nosniff, sans politique de contenu", () => {
    const res = withSecurityHeaders(Response.json({ ok: true }));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.has(CSP_HEADER)).toBe(false);
  });

  it("le statut et le corps de la réponse sont conservés", async () => {
    const res = withSecurityHeaders(html({ status: 404 }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("<!doctype html><title>KORA</title>");
  });

  it("un en-tête déjà posé par une route n'est pas remplacé", () => {
    const res = withSecurityHeaders(html({ headers: { [CSP_HEADER]: "default-src 'none'" } }));
    expect(res.headers.get(CSP_HEADER)).toBe("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("une réponse aux en-têtes immuables est copiée avec ses en-têtes", () => {
    const redirect = Response.redirect("https://kora.example.test/connexion", 302);
    expect(() => redirect.headers.set("x-test", "1")).toThrow();

    const res = withSecurityHeaders(redirect);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://kora.example.test/connexion");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("politique de sécurité du contenu", () => {
  const directives = () =>
    Object.fromEntries(
      contentSecurityPolicy()
        .split("; ")
        .map((d) => {
          const [name = "", ...values] = d.split(" ");
          return [name, values];
        }),
    );

  it("tout est limité à l'origine de l'application par défaut", () => {
    expect(directives()["default-src"]).toEqual(["'self'"]);
    expect(directives()["object-src"]).toEqual(["'none'"]);
    expect(directives()["base-uri"]).toEqual(["'self'"]);
    expect(directives()["form-action"]).toEqual(["'self'"]);
  });

  it("aucun script d'une autre origine n'est autorisé", () => {
    expect(directives()["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("les polices Google sont les seules ressources de style et de police externes", () => {
    expect(directives()["style-src"]).toContain("https://fonts.googleapis.com");
    expect(directives()["font-src"]).toEqual(["'self'", "https://fonts.gstatic.com"]);
  });

  it("le navigateur ne peut appeler que l'application et la base Supabase du projet", () => {
    expect(directives()["connect-src"]).toEqual(["'self'", "https://projet.supabase.invalid"]);
  });

  it("sans base Supabase (démonstration), seuls les appels à l'application sont permis", () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(directives()["connect-src"]).toEqual(["'self'"]);
  });

  it("une adresse Supabase invalide est ignorée", () => {
    vi.stubEnv("SUPABASE_URL", "pas une adresse");
    expect(directives()["connect-src"]).toEqual(["'self'"]);
  });

  it("seuls l'application et l'éditeur Lovable peuvent l'afficher dans un cadre", () => {
    expect(directives()["frame-ancestors"]).toEqual([
      "'self'",
      "https://lovable.dev",
      "https://*.lovable.dev",
    ]);
  });
});
