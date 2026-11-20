import { OpenAiEnhancer, type ChatOptions } from "./openai";
import { anthropicCostEur, type ApiMeter } from "../domain/pricing";

export const ANTHROPIC_MODEL = "claude-haiku-5-5";

interface MessageResponse {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export async function anthropicChat(
  system: string,
  user: string,
  opts: ChatOptions = {},
  meter?: ApiMeter,
): Promise<string | null> {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) return null;
  const maxTokens = opts.maxTokens ?? 2500;
  const uncertainCost = () =>
    anthropicCostEur(Math.ceil((system.length + user.length) / 2), maxTokens);
  let billed = false;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      const body = (await response.text()).split(key).join("[redacted]");
      console.error(`Anthropic request failed [${response.status}]: ${body}`);
      return null;
    }
    billed = true;
    const data = (await response.json()) as MessageResponse;
    const input = data.usage?.input_tokens;
    const output = data.usage?.output_tokens;
    meter?.add(
      typeof input === "number" && typeof output === "number"
        ? anthropicCostEur(input, output)
        : uncertainCost(),
    );
    if (data.stop_reason === "refusal" || data.stop_reason === "max_tokens") return null;
    return (
      data.content
        ?.filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n")
        .trim() || null
    );
  } catch (error) {
    if (billed || (error instanceof Error && error.name === "TimeoutError"))
      meter?.add(uncertainCost());
    return null;
  }
}

/** Reuses the same editorial prompts and source safeguards with Anthropic transport. */
export class AnthropicEnhancer extends OpenAiEnhancer {
  constructor() {
    super(anthropicChat, ANTHROPIC_MODEL);
  }
}
