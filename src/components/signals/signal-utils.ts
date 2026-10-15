import { CATEGORY, SIGNAL_STATUS, THEME, type Tone } from "@/components/kora/labels";
import type {
  Category,
  ObservationVia,
  Signal,
  SignalListQuery,
  SignalStatus,
  Theme,
} from "@/lib/api/types";

export const SIGNAL_STATUSES = Object.keys(SIGNAL_STATUS) as SignalStatus[];
export const THEMES = Object.keys(THEME) as Theme[];
export const CATEGORIES = Object.keys(CATEGORY) as Category[];

export const isSignalStatus = (v: unknown): v is SignalStatus =>
  typeof v === "string" && v in SIGNAL_STATUS;
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && v in THEME;
export const isCategory = (v: unknown): v is Category => typeof v === "string" && v in CATEGORY;

/** Date affichée d'un signal : publication, sinon date de l'événement ; null = « Date inconnue ». */
export function signalDate(s: Pick<Signal, "publishedAt" | "eventDate">): string | null {
  return s.publishedAt ?? s.eventDate;
}

export const VIA_LABEL: Record<ObservationVia, string> = {
  flux: "flux de la source",
  google_news: "Google News",
  perplexity: "Perplexity",
};

/** Ordre « récent » : date affichée, sinon date de collecte ; identique au tri serveur. */
export function byNewsDate(a: Signal, b: Signal): number {
  const t = (s: Signal) => Date.parse(signalDate(s) ?? s.collectedAt);
  return (
    t(b) - t(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)
  );
}

/** Ton d'un tag éditorial : celui de la catégorie ou de la thématique homonyme, bleu sinon. */
export function tagTone(tag: string): Tone {
  const t = tag.trim().toLowerCase();
  for (const c of CATEGORIES) if (CATEGORY[c].label.toLowerCase() === t) return CATEGORY[c].tone;
  for (const th of THEMES) if (THEME[th].label.toLowerCase() === t) return THEME[th].tone;
  return "blue";
}

/** Supprime les clés `undefined` (compatible `exactOptionalPropertyTypes`). */
export function compact<T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== "") out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export function signalQuery(q: {
  status?: SignalListQuery["status"] | undefined;
  companyId?: string | undefined;
  outlet?: string | undefined;
  category?: Category | undefined;
  theme?: Theme | undefined;
  q?: string | undefined;
  sort?: SignalListQuery["sort"] | undefined;
  limit?: number | undefined;
}): SignalListQuery {
  return compact(q);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}
