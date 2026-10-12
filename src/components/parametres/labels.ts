import {
  Ban,
  BookA,
  Building2,
  Eye,
  FileText,
  Gauge,
  HardDrive,
  Landmark,
  Lightbulb,
  Linkedin,
  ListTree,
  Mail,
  MapPin,
  Megaphone,
  MessageSquareQuote,
  Radio,
  Ruler,
  ScrollText,
  Search,
  Sparkles,
  Stamp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/components/kora/labels";
import type {
  AuditEvent,
  Criterion,
  ExportEntity,
  QuotaMeter,
  Role,
  RuleKind,
} from "@/lib/api/types";

export const CRITERIA: Criterion[] = [
  "importance",
  "nouveaute",
  "territoire",
  "lecteurs",
  "diffusion",
];

export const CRITERION_META: Record<
  Criterion,
  { tone: Tone; icon: LucideIcon; hint: string; short: string }
> = {
  importance: {
    tone: "rose",
    icon: Landmark,
    short: "Imp.",
    hint: "Portée économique ou stratégique de l'événement.",
  },
  nouveaute: {
    tone: "orange",
    icon: Sparkles,
    short: "Nouv.",
    hint: "Information inédite, non encore traitée par Inovallée.",
  },
  territoire: {
    tone: "teal",
    icon: MapPin,
    short: "Terr.",
    hint: "Lien avec l'écosystème Inovallée et le territoire grenoblois.",
  },
  lecteurs: {
    tone: "blue",
    icon: Users,
    short: "Lect.",
    hint: "Intérêt attendu pour les lecteurs et la communauté.",
  },
  diffusion: {
    tone: "purple",
    icon: Megaphone,
    short: "Diff.",
    hint: "Potentiel de reprise sur WordPress, LinkedIn et newsletter.",
  },
};

export const RULE_KINDS: RuleKind[] = ["ton", "longueur", "structure", "vocabulaire", "interdit"];

export const RULE_KIND: Record<
  RuleKind,
  { label: string; tone: Tone; icon: LucideIcon; hint: string }
> = {
  ton: {
    label: "Ton",
    tone: "teal",
    icon: MessageSquareQuote,
    hint: "Registre, posture, voix d'Inovallée.",
  },
  longueur: {
    label: "Longueur",
    tone: "blue",
    icon: Ruler,
    hint: "Calibrage des titres, chapôs et corps.",
  },
  structure: {
    label: "Structure",
    tone: "purple",
    icon: ListTree,
    hint: "Plan, intertitres, ordre des informations.",
  },
  vocabulaire: {
    label: "Vocabulaire",
    tone: "green",
    icon: BookA,
    hint: "Termes préférés, graphies, sigles.",
  },
  interdit: {
    label: "Interdits",
    tone: "rose",
    icon: Ban,
    hint: "Formulations et pratiques à proscrire.",
  },
};

export const ROLE_TONE: Record<Role, Tone> = {
  admin: "purple",
  redacteur: "blue",
  validateur: "green",
  lecteur: "gray",
};

export const AUDIT_ENTITY: Record<AuditEvent["entity"], { label: string; tone: Tone }> = {
  company: { label: "Entreprise", tone: "teal" },
  source: { label: "Source", tone: "blue" },
  signal: { label: "Signal", tone: "amber" },
  article: { label: "Article", tone: "blue" },
  linkedin: { label: "LinkedIn", tone: "blue" },
  newsletter: { label: "Newsletter", tone: "teal" },
  rule: { label: "Règle éditoriale", tone: "green" },
  grid: { label: "Grille de score", tone: "purple" },
  import: { label: "Import humain", tone: "orange" },
  publication: { label: "Publication", tone: "green" },
  user: { label: "Utilisateur", tone: "purple" },
  quota: { label: "Quota", tone: "rose" },
};

export const EXPORT_ENTITY: Record<
  ExportEntity,
  { label: string; description: string; icon: LucideIcon; tone: Tone }
> = {
  companies: {
    label: "Entreprises",
    description: "Registre, alias, domaines officiels, secteurs, priorités.",
    icon: Building2,
    tone: "teal",
  },
  sources: {
    label: "Sources",
    description: "Type, URL, fréquence, statut d'accès, dernière réussite, motifs d'échec.",
    icon: Radio,
    tone: "blue",
  },
  signals: {
    label: "Signaux",
    description: "Sujets détectés, catégories, statuts et motifs de rejet.",
    icon: Lightbulb,
    tone: "amber",
  },
  observations: {
    label: "Observations",
    description: "Provenance, dates de collecte, de publication et d'événement.",
    icon: Eye,
    tone: "purple",
  },
  scores: {
    label: "Scores",
    description: "Sous-notes, motifs et version de grille appliquée.",
    icon: Gauge,
    tone: "rose",
  },
  rules: {
    label: "Règles éditoriales",
    description: "Editorial DNA versionné, propositions et décisions.",
    icon: BookA,
    tone: "green",
  },
  decisions: {
    label: "Décisions",
    description: "Approbations, rejets, validateurs, versions et canaux.",
    icon: Stamp,
    tone: "orange",
  },
  articles: {
    label: "Articles",
    description: "Versions, auteurs nommés, statuts et identifiants de publication.",
    icon: FileText,
    tone: "blue",
  },
  audit: {
    label: "Journal d'audit",
    description: "Actions horodatées, acteurs et entités concernées.",
    icon: ScrollText,
    tone: "gray",
  },
};

export const METER_ICON: Record<QuotaMeter["key"], LucideIcon> = {
  api_budget_eur: Wallet,
  search_queries: Search,
  observations: Eye,
  articles: FileText,
  linkedin_posts: Linkedin,
  newsletters: Mail,
  companies: Building2,
  sources: Radio,
  storage_gb: HardDrive,
};

export const METER_DIGITS: Partial<Record<QuotaMeter["key"], number>> = {
  api_budget_eur: 2,
  storage_gb: 1,
};
