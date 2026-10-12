import { describe, it, expect } from "vitest";
import { editorialScore, WEIGHTS } from "./kora-store";
describe("score éditorial", () => {
  it("poids sommant à 100 %", () => expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100));
  it("reste entre 0 et 100", () => {
    expect(editorialScore({ importance: 100, nouveaute: 100, territoire: 100, lecteurs: 100, diffusion: 100 })).toBe(100);
    expect(editorialScore({ importance: 0, nouveaute: 0, territoire: 0, lecteurs: 0, diffusion: 0 })).toBe(0);
  });
});
