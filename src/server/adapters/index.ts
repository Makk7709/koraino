import {
  ExportOnlyLinkedIn,
  SimulatedWordPress,
  type LinkedInClient,
  type WordPressClient,
} from "./channels";
import { SimulatedCollector, type Collector } from "./collector";
import { TemplateTextModel, type TextModel } from "./text-model";

/** Adaptateurs tiers : remplaçables sans toucher au domaine (modèle, collecte, canaux). */
export interface Adapters {
  textModel: TextModel;
  collector: Collector;
  wordpress: WordPressClient;
  linkedin: LinkedInClient;
}

const KEY = "__koraAdapters__";

function defaults(): Adapters {
  return {
    textModel: new TemplateTextModel(),
    collector: new SimulatedCollector(),
    wordpress: new SimulatedWordPress(),
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
