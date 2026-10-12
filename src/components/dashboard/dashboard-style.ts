import {
  Activity,
  Atom,
  BadgeEuro,
  Building2,
  ChartNoAxesCombined,
  CircleCheck,
  ClipboardList,
  Cog,
  Cpu,
  FileText,
  FlaskConical,
  Globe,
  Handshake,
  HeartPulse,
  Leaf,
  Lightbulb,
  Rocket,
  Tag,
  Trophy,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/components/kora/labels";
import type { DashboardGroup, KpiCard } from "@/lib/api/types";

/** Clés `icon` renvoyées par l'API → icônes lucide (fallback : étiquette). */
const GROUP_ICONS: Record<string, LucideIcon> = {
  atom: Atom,
  quantum: Atom,
  deeptech: ClipboardList,
  clipboard: ClipboardList,
  cpu: Cpu,
  ai: Cpu,
  leaf: Leaf,
  energy: Leaf,
  users: Users,
  people: Users,
  globe: Globe,
  international: Globe,
  handshake: Handshake,
  lightbulb: Lightbulb,
  bulb: Lightbulb,
  euro: BadgeEuro,
  cog: Cog,
  gear: Cog,
  settings: Cog,
  check: CircleCheck,
  "check-circle": CircleCheck,
  trophy: Trophy,
  award: Trophy,
  rocket: Rocket,
  growth: ChartNoAxesCombined,
  chart: ChartNoAxesCombined,
  flask: FlaskConical,
  research: FlaskConical,
  health: HeartPulse,
  truck: Truck,
  mobility: Truck,
};

export function groupIcon(key: string): LucideIcon {
  return GROUP_ICONS[key.toLowerCase()] ?? Tag;
}

/**
 * Styles des 3 cartes de regroupement, relevés sur la maquette :
 * badge plein, tuiles par position, compteurs pastel.
 */
export const GROUP_STYLE: Record<
  DashboardGroup["key"],
  { title: string; badge: Tone; tiles: Tone[]; counts: Tone[] }
> = {
  prioritaires: {
    title: "Sujets prioritaires",
    badge: "rose",
    tiles: ["rose", "blue", "green", "purple"],
    counts: ["rose", "rose", "rose", "blue"],
  },
  a_surveiller: {
    title: "Signaux à surveiller",
    badge: "orange",
    tiles: ["blue", "teal", "amber", "green"],
    counts: ["green", "green", "green", "green"],
  },
  traites: {
    title: "Sujets déjà traités",
    badge: "green",
    tiles: ["green", "green", "teal", "purple"],
    counts: ["blue", "blue", "blue", "blue"],
  },
};

export const GROUP_ORDER: DashboardGroup["key"][] = ["prioritaires", "a_surveiller", "traites"];

export function pick<T>(list: T[], i: number, fallback: T): T {
  return list.length ? (list[i % list.length] ?? fallback) : fallback;
}

/** KPI : icône, ton, libellé de repli et destination. */
export const KPI_STYLE: Record<
  KpiCard["key"],
  { icon: LucideIcon | "linkedin"; tone: Tone; label: string; href: string }
> = {
  companies: { icon: Building2, tone: "teal", label: "entreprises suivies", href: "/entreprises" },
  signals: { icon: Activity, tone: "rose", label: "signaux détectés", href: "/signaux" },
  priority_topics: {
    icon: Lightbulb,
    tone: "amber",
    label: "sujets prioritaires",
    href: "/signaux?status=prioritaires",
  },
  wordpress_drafts: {
    icon: FileText,
    tone: "blue",
    label: "brouillons WordPress",
    href: "/articles",
  },
  linkedin_to_validate: {
    icon: "linkedin",
    tone: "blue",
    label: "posts LinkedIn à valider",
    href: "/linkedin",
  },
};

export const KPI_ORDER: KpiCard["key"][] = [
  "companies",
  "signals",
  "priority_topics",
  "wordpress_drafts",
  "linkedin_to_validate",
];

/** Couleurs hexadécimales des tons (graphiques recharts). */
export const TONE_HEX: Record<Tone, string> = {
  rose: "#e5446d",
  orange: "#e8711c",
  amber: "#e09a0b",
  green: "#16a34a",
  blue: "#2b7fd8",
  purple: "#7c4ddb",
  teal: "#0e8a9b",
  gray: "#64748b",
};

/** Variantes lumineuses pour les panneaux sombres. */
export const TONE_GLOW: Record<Tone, string> = {
  rose: "#ff7a9a",
  orange: "#ff9d4d",
  amber: "#ffc93d",
  green: "#3ee08a",
  blue: "#5aa8ff",
  purple: "#a98bff",
  teal: "#5ed3d8",
  gray: "#a5b4c8",
};

/** Variables CSS des fonds pastel (dégradés des cartes KPI). */
export const TONE_BG_VAR: Record<Tone, string> = {
  rose: "var(--kora-rose-bg)",
  orange: "var(--kora-orange-bg)",
  amber: "var(--kora-amber-bg)",
  green: "var(--kora-green-bg)",
  blue: "var(--kora-blue-bg)",
  purple: "var(--kora-purple-bg)",
  teal: "var(--kora-teal-bg)",
  gray: "var(--muted)",
};
