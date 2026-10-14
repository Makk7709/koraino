import { createWordPressClient } from "../wordpress/client";
import { ExportOnlyLinkedIn, type LinkedInClient, type WordPressClient } from "./channels";
import { RealCollector, SimulatedCollector, type Collector } from "./collector";
import { OpenAiEnhancer, type AiTextEnhancer } from "./openai";
import { TemplateTextModel, type TextModel } from "./text-model";

/** Adaptateurs tiers : remplaçables sans toucher au domaine (modèle, collecte, canaux). */
export interface Adapters {
  textModel: TextModel;
  /** Amélioration IA des textes (OpenAI) — absente sans clé AI_API_KEY. */
  ai: AiTextEnhancer | null;
  collector: Collector;
  /** Selon `WORDPRESS_*` : site réel, simulation (tests, démonstration) ou non configuré. */
  wordpress: WordPressClient;
  linkedin: LinkedInClient;
}

const KEY = "__koraAdapters__";

function defaults(): Adapters {
  return {
    textModel: new TemplateTextModel(),
    // Désactivé sous Vitest : les tests restent déterministes et hors réseau.
    ai: process.env["AI_API_KEY"] && !process.env["VITEST"] ? new OpenAiEnhancer() : null,
    collector: process.env["VITEST"] ? new SimulatedCollector() : new RealCollector(),
    wordpress: createWordPressClient(),
    linkedin: new ExportOnlyLinkedIn(),
  };
}

export function adapters(): Adapters {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) g[KEY] = defaults();
  return g[KEY] as Adapters;
}

export function setAdapters(partial: Partial<Adapters>): void {
  const g = globalThis as Record<string, unknown>;
  g[KEY] = { ...adapters(), ...partial };
}

export function resetAdapters(): void {
  (globalThis as Record<string, unknown>)[KEY] = defaults();
}

/** Résumé : gabarit par défaut, amélioré par l'IA quand une clé est configurée. */
export async function enhanceSummary(input: { title: string; text: string }): Promise<string> {
  const base = adapters().textModel.summarize(input);
  return (await adapters().ai?.enhanceSummary(input, base)) ?? base;
}
