import { describe, expect, it } from "vitest";
import { isAuthPage, loginHref, safeRedirect } from "@/lib/auth/redirect";

describe("safeRedirect", () => {
  it.each([
    ["/", "/"],
    ["/signaux", "/signaux"],
    ["/signaux?id=s1&tab=detail", "/signaux?id=s1&tab=detail"],
    ["/parametres?tab=utilisateurs#comptes", "/parametres?tab=utilisateurs#comptes"],
    ["/articles/../veille", "/veille"],
  ])("accepte le chemin interne %s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  it.each([
    ["URL absolue", "https://evil.example/phish"],
    ["URL relative au protocole", "//evil.example"],
    ["barre oblique inverse", "/\\evil.example"],
    ["barre oblique inverse seule", "\\\\evil.example"],
    ["tabulation retirée par le navigateur", "/\t/evil.example"],
    ["retour à la ligne", "/\n/evil.example"],
    ["pseudo-protocole", "javascript:alert(1)"],
    ["chemin relatif", "signaux"],
    ["chaîne vide", ""],
    ["page de connexion (boucle)", "/connexion"],
    ["page nouveau mot de passe", "/connexion/nouveau-mot-de-passe"],
    ["API", "/api/export/signals"],
  ])("refuse %s", (_label, input) => {
    expect(safeRedirect(input)).toBe("/");
  });

  it("refuse les valeurs non textuelles et applique le repli fourni", () => {
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect(42, "")).toBe("");
    expect(safeRedirect(["/signaux"], "/veille")).toBe("/veille");
    expect(safeRedirect("//evil.example", "")).toBe("");
  });
});

describe("loginHref", () => {
  it("encode le chemin courant dans le paramètre redirect", () => {
    expect(loginHref("/signaux?id=s1")).toBe("/connexion?redirect=%2Fsignaux%3Fid%3Ds1");
  });

  it("omet le paramètre pour l'accueil ou une destination refusée", () => {
    expect(loginHref("/")).toBe("/connexion");
    expect(loginHref("//evil.example")).toBe("/connexion");
    expect(loginHref(null)).toBe("/connexion");
  });
});

describe("isAuthPage", () => {
  it("reconnaît les pages de connexion uniquement", () => {
    expect(isAuthPage("/connexion")).toBe(true);
    expect(isAuthPage("/connexion/")).toBe(true);
    expect(isAuthPage("/connexion/nouveau-mot-de-passe")).toBe(true);
    expect(isAuthPage("/connexions")).toBe(false);
    expect(isAuthPage("/")).toBe(false);
  });
});
