
import { describe, expect, it } from "vitest";
import { computeEvidence } from "@/server/domain/evidence";
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
