import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiEnhancer } from "@/server/adapters/openai";

const input = {
  title: "Pasqal extends its partnership with Openchip",
  text: "Pasqal and Openchip extend their industrial partnership for 12 months.",
  companyName: "Pasqal",
};
const result = { category: "partenariat", importance: 78, reason: "Partenariat prolongé" };

function configure() {
  vi.stubEnv("ANTHROPIC_API_KEY", "haiku-cle-fictive");
  vi.stubEnv("AI_API_KEY", "openai-cle-fictive");
  vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "true");
  vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", "0.005");
}

const haikuSuccess = () =>
  Response.json({ content: [{ type: "text", text: JSON.stringify(result) }] });
const openaiSuccess = () =>
  Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("KORA — Claude Haiku 5.5 principal, GPT-4o mini en repli", () => {
  it("utilise Haiku en premier et pas OpenAI s'il répond", async () => {
    configure();
    const mock = vi.fn(async (..._args: unknown[]) => haikuSuccess());
    vi.stubGlobal("fetch", mock);
    const assessment = await new OpenAiEnhancer().classify(input);
    expect(assessment).toMatchObject({ category: "partenariat", model: "claude-haiku-5-5" });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(String(mock.mock.calls[0]?.[0])).toContain("api.anthropic.com");
    const body = JSON.parse(String((mock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
  });

  it("bascule sur GPT-4o mini après un HTTP 503 de Haiku", async () => {
    configure();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Service unavailable", { status: 503 }))
      .mockResolvedValueOnce(openaiSuccess());
    vi.stubGlobal("fetch", mock);
    const assessment = await new OpenAiEnhancer().classify(input);
    expect(assessment).toMatchObject({ category: "partenariat", model: "gpt-4o-mini" });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[1]?.[0])).toContain("api.openai.com");
    const body = JSON.parse(String((mock.mock.calls[1]?.[1] as RequestInit).body));
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("retourne null si les deux fournisseurs échouent", async () => {
    configure();
    const mock = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().classify(input)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("ne bascule pas sur une erreur HTTP 402 de facturation", async () => {
    configure();
    const mock = vi.fn(async () => new Response("Payment required", { status: 402 }));
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().classify(input)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("ne bascule pas sur une erreur d'authentification 401", async () => {
    configure();
    const mock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().classify(input)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("bascule sur un HTTP 429 correspondant à rate_limit_error", async () => {
    configure();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { type: "rate_limit_error" } }, { status: 429 }),
      )
      .mockResolvedValueOnce(openaiSuccess());
    vi.stubGlobal("fetch", mock);
    expect((await new OpenAiEnhancer().classify(input))?.model).toBe("gpt-4o-mini");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("ne bascule pas sur un HTTP 429 de crédits épuisés", async () => {
    configure();
    const mock = vi.fn(async () =>
      Response.json({ error: { code: "credit_balance_exhausted" } }, { status: 429 }),
    );
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().classify(input)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("ne bascule pas quand KORA_AI_FALLBACK_ENABLED=false", async () => {
    configure();
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "false");
    const mock = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().classify(input)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("ne bascule pas sans réserve de budget définie", async () => {
    configure();
    vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", "");
    const mock = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().classify(input)).toBeNull();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("ne contacte pas GPT-4o mini sans clé Haiku", async () => {
    configure();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const mock = vi.fn(async () => openaiSuccess());
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().classify(input)).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("bascule si Haiku répond avec un JSON éditorial invalide", async () => {
    configure();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ content: [{ type: "text", text: "invalid" }] }))
      .mockResolvedValueOnce(openaiSuccess());
    vi.stubGlobal("fetch", mock);
    expect((await new OpenAiEnhancer().classify(input))?.model).toBe("gpt-4o-mini");
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
