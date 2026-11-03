import { describe, it, expect } from "vitest";

import { toCsv } from "../../../server/domain/csv";


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

  it("neutralise les formules contenues dans un tableau de chaînes", () => {
    const rows = [
      {
        etiquettes: ['=HYPERLINK("https://malicious.com")'],
      },
    ];

    const result = toCsv(["etiquettes"], rows);

    expect(result).toContain("'=HYPERLINK");
  });
  it("neutralise les chaînes commençant par =", () => {
    const result = toCsv(["nom"], [{ nom: "=SUM(A1:A2)" }]);

    expect(result).toContain("'=SUM");
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

  it("neutralise une formule précédée d'un espace", () => {
    const result = toCsv(
      ["valeur"],
      [{ valeur: " =HYPERLINK(...)" }]
    );
  
    expect(result).toContain("' =HYPERLINK");
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

  it("conserve les nombres négatifs", () => {
    const result = toCsv(["prix"], [{ prix: -42 }]);
    expect(result).toContain("-42");
    expect(result).not.toContain("'-42");
  });
  
  it("neutralise les chaînes commençant par un moins", () => {
    const result = toCsv(["valeur"], [{ valeur: "-42" }]);
    expect(result).toContain("'-42");
  });

  it("conserve les valeurs numériques dans les objets", () => {
    const result = toCsv(
      ["informations"],
      [{ informations: { prix: -42, quantite: 10 } }]
    );
  
    expect(result).toContain("-42");
    expect(result).not.toContain("'-42");
  });
  it("conserve la sérialisation JSON des objets", () => {
    const result = toCsv(
      ["informations"],
      [{ informations: { nom: "Alice", age: 30 } }]
    );
  
    expect(result).toContain(
      '"{""nom"":""Alice"",""age"":30}"'
    );
  });
  it("conserve la sérialisation JSON des tableaux imbriqués", () => {
    const result = toCsv(
      ["valeurs"],
      [{ valeurs: ["normal", ["texte", "autre"]] }]
    );
  
    expect(result).toContain('normal | [""texte"",""autre""]');
  });
  it("conserve les dates lors de leur sérialisation JSON", () => {
    const date = new Date("2026-11-03T10:00:00.000Z");
  
    const result = toCsv(["date"], [{ date }]);
  
    expect(result).toContain(date.toISOString());
  });
});
