import { THEME, type Tone } from "@/components/kora/labels";
import type { CompanyPriority, Theme } from "@/lib/api/types";

export const PRIORITY: Record<CompanyPriority, { label: string; tone: Tone }> = {
  haute: { label: "Haute", tone: "rose" },
  normale: { label: "Normale", tone: "blue" },
  basse: { label: "Basse", tone: "gray" },
};

export const PRIORITY_OPTIONS = (Object.keys(PRIORITY) as CompanyPriority[]).map((value) => ({
  value,
  label: `Priorité ${PRIORITY[value].label.toLowerCase()}`,
}));

export const THEMES = Object.keys(THEME) as Theme[];

export const THEME_OPTIONS = THEMES.map((value) => ({ value, label: THEME[value].label }));
