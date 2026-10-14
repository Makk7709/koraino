import type {
  ArticleStatus,
  Category,
  Channel,
  CollectionRunStatus,
  Criterion,
  EvidenceLevel,
  LinkedInStatus,
  NewsletterStatus,
  Role,
  SignalStatus,
  SourceAccess,
  SourceType,
  Theme,
  WordPressMode,
  WordPressRemoteStatus,
} from "@/lib/api/types";

/** Tons de couleur de la maquette (pastilles, badges, icônes). */
export type Tone = "rose" | "orange" | "amber" | "green" | "blue" | "purple" | "teal" | "gray";

export const TONE_CLASSES: Record<Tone, { bg: string; fg: string; solid: string }> = {
  rose: { bg: "bg-kora-rose-bg", fg: "text-kora-rose", solid: "bg-kora-rose" },
  orange: { bg: "bg-kora-orange-bg", fg: "text-kora-orange", solid: "bg-kora-orange" },
  amber: { bg: "bg-kora-amber-bg", fg: "text-kora-amber", solid: "bg-kora-amber" },
  green: { bg: "bg-kora-green-bg", fg: "text-kora-green", solid: "bg-kora-green" },
  blue: { bg: "bg-kora-blue-bg", fg: "text-kora-blue", solid: "bg-kora-blue" },
  purple: { bg: "bg-kora-purple-bg", fg: "text-kora-purple", solid: "bg-kora-purple" },
  teal: { bg: "bg-kora-teal-bg", fg: "text-kora-teal", solid: "bg-kora-teal" },
  gray: { bg: "bg-muted", fg: "text-muted-foreground", solid: "bg-muted-foreground" },
};

export const SIGNAL_STATUS: Record<SignalStatus, { label: string; tone: Tone }> = {
  nouveau: { label: "Nouveau", tone: "rose" },
  a_traiter: { label: "À traiter", tone: "orange" },
  en_revue: { label: "En revue", tone: "blue" },
  surveille: { label: "Surveillé", tone: "purple" },
  traite: { label: "Traité", tone: "green" },
  rejete: { label: "Rejeté", tone: "gray" },
};

export const ARTICLE_STATUS: Record<ArticleStatus, { label: string; tone: Tone }> = {
  brouillon: { label: "Brouillon", tone: "gray" },
  en_revue: { label: "En revue", tone: "blue" },
  approuve: { label: "Prêt à publier", tone: "green" },
  programme: { label: "Programmé", tone: "teal" },
  publie: { label: "Publié", tone: "teal" },
  rejete: { label: "Rejeté", tone: "rose" },
};

export const LINKEDIN_STATUS: Record<LinkedInStatus, { label: string; tone: Tone }> = {
  brouillon: { label: "Brouillon", tone: "gray" },
  a_valider: { label: "À valider", tone: "amber" },
  approuve: { label: "Approuvé", tone: "green" },
  exporte: { label: "Exporté", tone: "teal" },
  publie: { label: "Publié", tone: "teal" },
};

export const NEWSLETTER_STATUS: Record<NewsletterStatus, { label: string; tone: Tone }> = {
  composition: { label: "En composition", tone: "amber" },
  approuvee: { label: "Approuvée", tone: "green" },
  exportee: { label: "Exportée", tone: "teal" },
};

export const CATEGORY: Record<Category, { label: string; tone: Tone }> = {
  financement: { label: "Levée de fonds", tone: "purple" },
  acquisition: { label: "Acquisition", tone: "blue" },
  contrat: { label: "Contrat", tone: "teal" },
  partenariat: { label: "Partenariat", tone: "teal" },
  innovation: { label: "Innovation", tone: "purple" },
  produit: { label: "Nouveau produit", tone: "green" },
  brevet: { label: "Brevet", tone: "blue" },
  recrutement: { label: "Recrutement", tone: "orange" },
  croissance: { label: "Croissance", tone: "green" },
  international: { label: "International", tone: "blue" },
  distinction: { label: "Distinction & prix", tone: "amber" },
  recherche: { label: "Recherche", tone: "purple" },
};

export const THEME: Record<Theme, { label: string; tone: Tone }> = {
  deeptech_quantique: { label: "Deeptech & quantique", tone: "rose" },
  ia_industrie: { label: "IA & industrie", tone: "blue" },
  transition_energetique: { label: "Transition énergétique", tone: "green" },
  talents_rh: { label: "Talents & RH", tone: "purple" },
  sante_biotech: { label: "Santé & biotech", tone: "teal" },
  mobilite: { label: "Mobilité", tone: "orange" },
  numerique: { label: "Numérique", tone: "blue" },
};

/** État du contenu côté WordPress (panneau de diffusion, dashboard, calendrier). */
export const WORDPRESS_STATUS: Record<
  WordPressRemoteStatus,
  { label: string; tone: Tone; hint: string }
> = {
  aucun: {
    label: "Aucun brouillon WordPress",
    tone: "gray",
    hint: "Rien n'a encore été envoyé à WordPress.",
  },
  brouillon: {
    label: "Brouillon WordPress",
    tone: "blue",
    hint: "Brouillon invisible du public : la mise en ligne se fait dans WordPress.",
  },
  en_attente: {
    label: "En attente de relecture",
    tone: "amber",
    hint: "Soumis à relecture dans WordPress, pas encore en ligne.",
  },
  programme: {
    label: "Programmé sur WordPress",
    tone: "teal",
    hint: "Programmé dans WordPress : KORA ne modifie plus ce contenu.",
  },
  publie: {
    label: "Publié sur WordPress",
    tone: "green",
    hint: "En ligne sur le site : toute modification se fait dans WordPress.",
  },
  supprime: {
    label: "Supprimé sur WordPress",
    tone: "rose",
    hint: "Mis à la corbeille ou supprimé sur le site : un nouvel envoi recréera un brouillon.",
  },
};

export const WORDPRESS_MODE: Record<WordPressMode, { label: string; tone: Tone }> = {
  reel: { label: "Site configuré", tone: "green" },
  simule: { label: "Mode démonstration", tone: "amber" },
  non_configure: { label: "Non configuré", tone: "rose" },
};

export const CHANNEL: Record<Channel, { label: string }> = {
  wordpress: { label: "WordPress" },
  linkedin: { label: "LinkedIn" },
  newsletter: { label: "Newsletter" },
};

export const ROLE: Record<Role, string> = {
  admin: "Administrateur",
  redacteur: "Rédacteur",
  validateur: "Validateur",
  lecteur: "Lecteur",
};

export const CRITERION: Record<Criterion, string> = {
  importance: "Importance",
  nouveaute: "Nouveauté",
  territoire: "Adéquation territoriale",
  lecteurs: "Intérêt lecteurs",
  diffusion: "Potentiel de diffusion",
};

export const EVIDENCE: Record<EvidenceLevel, { label: string; tone: Tone }> = {
  solide: { label: "Dossier solide", tone: "green" },
  a_consolider: { label: "À consolider", tone: "amber" },
  fragile: { label: "Fragile", tone: "rose" },
};

export const SOURCE_TYPE: Record<SourceType, string> = {
  site_officiel: "Site officiel",
  actualites: "Page actualités",
  communiques: "Communiqués",
  rss: "Flux RSS",
  recherche_web: "Recherche web",
  newsletter_import: "Newsletter importée",
};

export const SOURCE_ACCESS: Record<SourceAccess, { label: string; tone: Tone }> = {
  ok: { label: "Opérationnelle", tone: "green" },
  erreur: { label: "En échec", tone: "rose" },
  en_attente: { label: "En attente", tone: "amber" },
  desactivee: { label: "Désactivée", tone: "gray" },
};

export const RUN_STATUS: Record<CollectionRunStatus, { label: string; tone: Tone }> = {
  succes: { label: "Succès", tone: "green" },
  succes_sans_actualite: { label: "Succès · aucune actualité", tone: "teal" },
  echec: { label: "Échec", tone: "rose" },
  bloque_quota: { label: "Bloquée (quota)", tone: "amber" },
};

/** Score 0–100 → affichage sur 10 avec une décimale (92 → "9.2"). */
export function scoreOn10(total: number): string {
  return (Math.round(total) / 10).toFixed(1);
}

/** Couleur de la pastille Score IA (maquette : ≥ 9 rose, ≥ 7.5 orange, ≥ 6 ambre). */
export function scoreTone(total: number): Tone {
  if (total >= 90) return "rose";
  if (total >= 75) return "orange";
  if (total >= 60) return "amber";
  return "gray";
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dateShortFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** "26 mars 2025" ; « Date inconnue » si null (aucune date inventée). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Date inconnue";
  return dateFmt.format(new Date(iso));
}

/** "12 oct. 2026" pour les colonnes étroites ; « Date inconnue » si null. */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "Date inconnue";
  return dateShortFmt.format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFmt.format(new Date(iso));
}

/** "il y a 2 heures" */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });
  if (Math.abs(diff) < 60) return "à l'instant";
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}
