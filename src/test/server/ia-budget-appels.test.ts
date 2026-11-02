import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiEnhancer } from "@/server/adapters/openai";

const input = {
  title: "Pasqal extends its partnership with Openchip",
  text: "Pasqal and Openchip extend their partnership.",
  companyName: "Pasqal",
};
const valid = {
  category: "partenariat",
  importance: 78,
  reason: "Partenariat prolongé",
};

function configure() {
  vi.stubEnv("ANTHROPIC_API_KEY", "haiku-test-fictif");
  vi.stubEnv("AI_API_KEY", "openai-test-fictif");
  vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "true");
  vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", "0.005");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("KORA — nombre de tentatives pour le budget API global", () => {
  it("compte une tentative quand Haiku réussit", async () => {
    configure();
    const fetchMock = vi.fn(async () =>
      Response.json({ content: [{ type: "text", text: JSON.stringify(valid) }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAiEnhancer().classifyWithUsage(input);
    expect(result).toMatchObject({ primaryCalls: 1, fallbackCalls: 0 });
    expect(result.assessment?.model).toBe("claude-haiku-5-5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("compte les deux tentatives lorsque les deux modèles échouent", async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAiEnhancer().classifyWithUsage(input);
    expect(result).toMatchObject({ primaryCalls: 1, fallbackCalls: 1, assessment: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ne compte pas de secours lorsque celui-ci est désactivé", async () => {
    configure();
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "false");
    const fetchMock = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAiEnhancer().classifyWithUsage(input);
    expect(result).toMatchObject({ primaryCalls: 1, fallbackCalls: 0, assessment: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
