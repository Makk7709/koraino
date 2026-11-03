import { describe, it, expect } from "vitest";

import { toCsv } from "../../../server/domain/csv";

describe("toCsv", () => {
  it("neutralise les formules contenues dans un tableau de chaînes", () => {
    const rows = [
      {
        etiquettes: ['=HYPERLINK("https://malicious.com")'],
      },
    ];

    const result = toCsv(["etiquettes"], rows);

    expect(result).toContain("'=HYPERLINK");
  });
});
describe("toCsv - sécurité des formules", () => {
  it.each([
    ["=", ["=HYPERLINK(...)"]],
    ["+", ["+123"]],
    ["-", ["-123"]],
    ["@", ["@SUM(...)"]],
  ])("neutralise les tableaux commençant par %s", (_, value) => {
    const result = toCsv(["etiquettes"], [{ etiquettes: value }]);

    expect(result).toContain("'");
  });

  it("neutralise les chaînes commençant par =", () => {
    const result = toCsv(["nom"], [{ nom: "=SUM(A1:A2)" }]);

    expect(result).toContain("'=SUM");
  });
});

describe("toCsv - conservation des données", () => {
  it("conserve les chaînes normales", () => {
    const result = toCsv(["nom"], [{ nom: "Bonjour" }]);

    expect(result).toContain("Bonjour");
  });

  it("conserve les nombres", () => {
    const result = toCsv(["age"], [{ age: 123 }]);

    expect(result).toContain("123");
  });

  it("convertit null en cellule vide", () => {
    const result = toCsv(["nom"], [{ nom: null }]);

    expect(result).toBe("nom\r\n\r\n");
  });

  it("neutralise une formule dans le premier élément d'un tableau", () => {
    const result = toCsv(["etiquettes"], [{ etiquettes: ["=HYPERLINK(...)", "administration"] }]);

    expect(result).toContain("'=HYPERLINK");
    expect(result).toContain("administration");
  });

  it("neutralise une formule précédée d'une tabulation", () => {
    const result = toCsv(["nom"], [{ nom: "\t=HYPERLINK(...)" }]);

    expect(result).toContain("'");
  });

  it("ne double pas la neutralisation d'une chaîne déjà neutralisée", () => {
    const result = toCsv(["nom"], [{ nom: "'=HYPERLINK(...)" }]);

    expect(result).toBe("nom\r\n'=HYPERLINK(...)\r\n");
  });
});
