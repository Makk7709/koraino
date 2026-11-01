import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiEnhancer } from "@/server/adapters/openai";

const input = {
  title: "Pasqal expands a partnership",
  text: "Pasqal and its partner expand a long-term agreement.",
};
const base = "Résumé généré par un gabarit.";
const improved = "Résumé journalistique de l'accord industriel, sans faits supplémentaires.";

function credentials() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-fake");
  vi.stubEnv("AI_API_KEY", "test-openai-fake");
  vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "true");
  vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", "0.05");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("KORA — Haiku editorial, GPT-4.1 mini backup", () => {
  it("improves summaries with Haiku without calling OpenAI", async () => {
    credentials();
    const mock = vi.fn(async (..._args: unknown[]) =>
      Response.json({
        content: [{ type: "text", text: improved }],
        stop_reason: "end_turn",
      }),
    );
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().enhanceSummary(input, base)).toBe(improved);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(String(mock.mock.calls[0]?.[0])).toContain("api.anthropic.com");
    const body = JSON.parse(String((mock.mock.calls[0]?.[1] as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(body["model"]).toBe("claude-haiku-5-5");
  });

  it("uses GPT-4.1 mini only after a transient primary error", async () => {
    credentials();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Service unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: improved } }] }));
    vi.stubGlobal("fetch", mock);
    await expect(new OpenAiEnhancer().enhanceSummary(input, base)).rejects.toThrow(
      "AI_PROVIDER_BILLING_UNCERTAIN",
    );
    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[1]?.[0])).toContain("api.openai.com");
    const body = JSON.parse(String((mock.mock.calls[1]?.[1] as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(body["model"]).toBe("gpt-4.1-mini");
  });

  it("never bypasses a financial 429 through OpenAI", async () => {
    credentials();
    const mock = vi.fn(async () =>
      Response.json(
        {
          error: {
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
            details: { error_code: "enforced_spend_limit_reached" },
          },
        },
        { status: 429 },
      ),
    );
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().enhanceSummary(input, base)).toBe(base);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does not directly call OpenAI when Haiku credentials are absent", async () => {
    credentials();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    expect(await new OpenAiEnhancer().enhanceSummary(input, base)).toBe(base);
    expect(mock).not.toHaveBeenCalled();
  });
  it("ne masque pas un timeout si aucun fournisseur ne répond", async () => {
    credentials();
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network timeout");
      }),
    );
    await expect(new OpenAiEnhancer().enhanceSummary(input, base)).rejects.toThrow(
      "AI_PROVIDER_BILLING_UNCERTAIN",
    );
  });

  it("conserve une incertitude quand Haiku et OpenAI échouent après envoi", async () => {
    credentials();
    const mock = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", mock);
    await expect(new OpenAiEnhancer().enhanceSummary(input, base)).rejects.toThrow(
      "AI_PROVIDER_BILLING_UNCERTAIN",
    );
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("conserve le repli éditorial pour un refus financier explicite", async () => {
    credentials();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Payment required", { status: 402 })),
    );
    expect(await new OpenAiEnhancer().enhanceSummary(input, base)).toBe(base);
  });
});
