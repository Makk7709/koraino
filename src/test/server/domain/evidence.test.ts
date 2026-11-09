
import { describe, expect, it } from "vitest";
import { computeEvidence, isCompanyHost } from "@/server/domain/evidence";
import type { Observation } from "@/lib/api/types";

const company = {
  name: "Pasqal",
  domain: "pasqal.com",
};

const NOW = new Date("2026-11-09T12:00:00.000Z");

function createObservation(url: string): Observation {
  const hostname = new URL(url).hostname;

  return {
    id: "observation-1",
    signalId: null,
    sourceId: null,
    companyId: null,
    outlet: {
      name: "Test source",
      domain: hostname,
      brand: {
        initials: "TS",
        bg: "#ffffff",
        fg: "#000000",
      },
    },
    url,
    title: "Actualité Pasqal",
    excerpt: "Une actualité concernant Pasqal.",
    collectedAt: NOW.toISOString(),
    publishedAt: NOW.toISOString(),
    eventDate: null,
    matchConfidence: 90,
    isSyndicated: false,
  };
}

describe("computeEvidence - reconnaissance des domaines directs", () => {
  it("reconnaît le domaine exact", () => {
    const observation = createObservation(
      "https://pasqal.com/news",
    );

    const result = computeEvidence(
      [observation],
      company,
      NOW,
    );

    expect(result.directSource).toBe(true);
  });

  it("reconnaît le sous-domaine www", () => {
    const observation = createObservation(
      "https://www.pasqal.com/news",
    );

    const result = computeEvidence(
      [observation],
      company,
      NOW,
    );

    expect(result.directSource).toBe(true);
  });

  it("reconnaît un sous-domaine légitime", () => {
    const observation = createObservation(
      "https://api.pasqal.com/news",
    );

    const result = computeEvidence(
      [observation],
      company,
      NOW,
    );

    expect(result.directSource).toBe(true);
  });

  it("rejette un domaine contenant le nom de l'entreprise sans lui appartenir", () => {
    const observation = createObservation(
      "https://notpasqal.com/news",
    );

    const result = computeEvidence(
      [observation],
      company,
      NOW,
    );

    expect(result.directSource).toBe(false);
  });
});

describe("isCompanyHost", () => {
    it("reconnaît le domaine exact", () => {
      expect(isCompanyHost("pasqal.com", "pasqal.com")).toBe(true);
    });
  
    it("reconnaît un sous-domaine", () => {
      expect(isCompanyHost("blog.pasqal.com", "pasqal.com")).toBe(true);
    });

    it("reconnaît un domaine d'entreprise précédé de www", () => {
      expect(isCompanyHost("pasqal.com", "www.pasqal.com")).toBe(true);
    });
  
    it("refuse un domaine contenant simplement le nom de l'entreprise", () => {
      expect(isCompanyHost("notpasqal.com", "pasqal.com")).toBe(false);
    });
  
    it("refuse un domaine d'entreprise vide", () => {
      expect(isCompanyHost("pasqal.com", "")).toBe(false);
    });
  });
