import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicEnhancer } from "@/server/adapters/anthropic";
import { ApiMeter, anthropicCostEur } from "@/server/domain/pricing";

beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-credential"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function reply(text: string, stopReason = "end_turn") {
  return Response.json({
    content: [{ type: "thinking" }, { type: "text", text }],
    usage: { input_tokens: 1000, output_tokens: 100 },
    stop_reason: stopReason,
  });
}

describe("Haiku 5.5 editorial adapter", () => {
  it("calls Haiku 5.5 directly with the personal key, preserving summary limits and measuring usage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reply("Une actualité vérifiée concernant l’entreprise grenobloise."));
    vi.stubGlobal("fetch", fetchMock);
    const meter = new ApiMeter();
    const output = await new AnthropicEnhancer().enhanceSummary(
      { title: "Actualité", text: "Fait vérifié" },
      "gabarit",
      meter,
    );
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("No provider call");
    expect(call[0]).toBe("https://api.anthropic.com/v1/messages");
    const init = call[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.max_tokens).toBe(220);
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(new Headers(init.headers).get("x-api-key")).toBe("test-anthropic-credential");
    expect(output).toContain("actualité vérifiée");
    expect(meter.costEur).toBeCloseTo(0.00015, 8);
  });

  it("labels classifications with the actual Haiku model", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          reply(
            JSON.stringify({
              category: "partenariat",
              importance: 70,
              reason: "Partenariat annoncé",
            }),
          ),
        ),
    );
    const result = await new AnthropicEnhancer().classify({
      title: "Partenariat",
      text: "Accord signé",
      companyName: "Kalray",
    });
    expect(result?.model).toBe("claude-haiku-5-5");
    expect(result?.importance).toBe(70);
  });

  it("preserves unverified markers and does not retry refused generations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reply("Un texte sans signalement de vérification."));
    vi.stubGlobal("fetch", fetchMock);
    const ai = new AnthropicEnhancer();
    const input = { title: "Annonce", text: "[À vérifier] Accord" };
    expect(await ai.enhanceSummary(input, "[À vérifier] gabarit")).toBe("[À vérifier] gabarit");
    fetchMock.mockResolvedValue(reply("Refus", "refusal"));
    expect(await ai.enhanceSummary(input, "gabarit")).toBe("gabarit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accounts for the published long-context pricing tier", () => {
    expect(anthropicCostEur(100_000, 1000)).toBeCloseTo(0.0105, 8);
    expect(anthropicCostEur(100_001, 1000)).toBeCloseTo(0.0525005, 8);
  });
});
