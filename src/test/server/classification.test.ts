import { describe, expect, it } from "vitest";
import { classifyCategory } from "@/server/domain/clustering";

describe("classification par indices lexicaux", () => {
  it("tranche par le poids des indices, pas par le premier mot rencontré", () => {
    expect(
      classifyCategory("Pasqal lève 100 millions d'euros auprès d'investisseurs européens"),
    ).toBe("financement");
    expect(
      classifyCategory("Kalray remporte un contrat de 12 M€ avec un industriel allemand"),
    ).toBe("contrat");
    expect(
      classifyCategory("Alpao signe un partenariat avec le CEA sur l'optique adaptative"),
    ).toBe("partenariat");
    expect(classifyCategory("Arturia lance une nouvelle version de son synthétiseur")).toBe(
      "produit",
    );
    expect(classifyCategory("Verkor inaugure sa nouvelle usine et double ses effectifs")).toBe(
      "croissance",
    );
    expect(classifyCategory("Koelis s'implante aux États-Unis avec une filiale à Boston")).toBe(
      "international",
    );
    expect(classifyCategory("Cytoo lauréate du prix de l'innovation du salon")).toBe("distinction");
    expect(classifyCategory("Probayes recrute vingt ingénieurs en apprentissage automatique")).toBe(
      "recrutement",
    );
    expect(classifyCategory("Diamsens dépose un brevet sur ses capteurs")).toBe("brevet");
    expect(
      classifyCategory("Naver Labs publie une étude avec des chercheurs de l'université"),
    ).toBe("recherche");
  });

  it("ne se laisse plus décider par un mot ambigu", () => {
    // « prix » seul (tarif) n'est plus une distinction ; « double » seul n'est plus une croissance.
    expect(classifyCategory("Le prix du capteur baisse, une technologie innovante")).toBe(
      "innovation",
    );
    expect(classifyCategory("Un double capteur innovant dévoilé au salon")).toBe("innovation");
    // « fonds » seul ne suffit pas face à un contrat explicite.
    expect(classifyCategory("Fonds européens : Kalray remporte un contrat avec l'ESA")).toBe(
      "contrat",
    );
    // « recherche » seul ne l'emporte pas sur un recrutement explicite.
    expect(classifyCategory("À la recherche de talents, Talnia recrute dix postes")).toBe(
      "recrutement",
    );
  });

  it("retombe sur « innovation » sans indice, et normalise accents et apostrophes", () => {
    expect(classifyCategory("Une annonce sans mot-clé particulier")).toBe("innovation");
    expect(classifyCategory("LEVÉE DE FONDS record pour Yona Robotics")).toBe("financement");
    expect(classifyCategory("Appel d’offres remporté par Keolabs")).toBe("contrat");
  });
});
