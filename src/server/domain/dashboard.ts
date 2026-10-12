import type {
  ActivityPoint,
  Category,
  Dashboard,
  DashboardGroup,
  DashboardGroupItem,
  KpiCard,
  Theme,
} from "@/lib/api/types";
import type {
  ArticleRecord,
  CompanyRecord,
  LinkedInPostRecord,
  NewsletterRecord,
  SignalRecord,
  SourceRecord,
} from "../store/records";
import { dayStart } from "./dates";
import { truncate } from "./text";

/** Seuil de score (0–100) d'un sujet prioritaire. */
export const PRIORITY_SCORE = 80;

type Tone = NonNullable<DashboardGroupItem["tone"]>;

const THEME_ORDER: Theme[] = [
  "deeptech_quantique",
  "ia_industrie",
  "transition_energetique",
  "talents_rh",
  "sante_biotech",
  "mobilite",
  "numerique",
];

const THEME_META: Record<Theme, { label: string; icon: string; tone: Tone }> = {
  deeptech_quantique: { label: "Deeptech & quantique", icon: "atom", tone: "rose" },
  ia_industrie: { label: "IA & industrie", icon: "cpu", tone: "blue" },
  transition_energetique: { label: "Transition énergétique", icon: "leaf", tone: "green" },
  talents_rh: { label: "Talents & RH", icon: "users", tone: "purple" },
  sante_biotech: { label: "Santé & biotech", icon: "heart", tone: "teal" },
  mobilite: { label: "Mobilité", icon: "car", tone: "orange" },
  numerique: { label: "Numérique", icon: "monitor", tone: "blue" },
};

const CATEGORY_ORDER: Category[] = [
  "international",
  "partenariat",
  "financement",
  "produit",
  "distinction",
  "innovation",
  "croissance",
  "acquisition",
  "contrat",
  "brevet",
  "recrutement",
  "recherche",
];

const CATEGORY_GROUP_LABEL: Record<Category, string> = {
  financement: "Levées de fonds",
  partenariat: "Partenariats stratégiques",
  produit: "Nouveaux produits",
  innovation: "Innovation produit",
  croissance: "Croissance & international",
  international: "International",
  distinction: "Distinctions & prix",
  acquisition: "Acquisitions",
  contrat: "Contrats",
  brevet: "Brevets",
  recrutement: "Recrutements",
  recherche: "Recherche",
};

const WATCH_META: Record<Category, { icon: string; tone: Tone }> = {
  international: { icon: "globe", tone: "blue" },
  partenariat: { icon: "handshake", tone: "teal" },
  financement: { icon: "lightbulb", tone: "amber" },
  produit: { icon: "cog", tone: "green" },
  innovation: { icon: "rocket", tone: "purple" },
  distinction: { icon: "trophy", tone: "amber" },
  croissance: { icon: "rocket", tone: "teal" },
  acquisition: { icon: "building", tone: "blue" },
  contrat: { icon: "file", tone: "blue" },
  brevet: { icon: "shield", tone: "purple" },
  recrutement: { icon: "users", tone: "purple" },
  recherche: { icon: "flask", tone: "teal" },
};

const DONE_META: Partial<Record<Category, { icon: string; tone: Tone }>> = {
  financement: { icon: "check", tone: "green" },
  distinction: { icon: "trophy", tone: "green" },
  innovation: { icon: "cog", tone: "teal" },
  croissance: { icon: "cog", tone: "purple" },
};

/** Clés d'icônes utilisées par le dashboard (le front les associe à ses pictogrammes). */
export const DASHBOARD_ICONS = [
  ...new Set([
    ...Object.values(THEME_META).map((m) => m.icon),
    ...Object.values(WATCH_META).map((m) => m.icon),
    ...Object.values(DONE_META).map((m) => m!.icon),
  ]),
];

export interface DashboardInput {
  now: Date;
  from?: Date | null;
  to?: Date | null;
  companies: CompanyRecord[];
  signals: SignalRecord[];
  articles: ArticleRecord[];
  linkedin: LinkedInPostRecord[];
  newsletters: NewsletterRecord[];
  sources: SourceRecord[];
  paidCallsSuspended: boolean;
}

/** Variation en % (arrondie) : "+12%", "-5%", "0%". */
export function percentTrend(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const p = Math.round(((current - previous) / previous) * 100);
  return p > 0 ? `+${p}%` : p < 0 ? `${p}%` : "0%";
}

/** Variation absolue : "+2", "-1", "0". */
export function deltaTrend(current: number, previous: number): string {
  const d = current - previous;
  return d > 0 ? `+${d}` : d < 0 ? `${d}` : "0";
}

function direction(trend: string): KpiCard["trendDirection"] {
  return trend.startsWith("+") ? "up" : trend.startsWith("-") ? "down" : "flat";
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const between = (iso: string | null | undefined, from: number, to: number) => {
  const t = time(iso);
  return t >= from && t <= to;
};

function isPriority(s: SignalRecord): boolean {
  return (s.status === "nouveau" || s.status === "a_traiter") && s.score.total >= PRIORITY_SCORE;
}

/**
 * Tableau de bord calculé à partir des données (aucune valeur codée en dur).
 * Fenêtres en jours calendaires (heure locale) : période par défaut = 30 derniers jours,
 * « 7 jours » = aujourd'hui + 6 jours précédents, comparés aux 7 jours d'avant.
 */
export function computeDashboard(input: DashboardInput): Dashboard {
  const { now } = input;
  const from = input.from ? dayStart(input.from) : dayStart(now, 29);
  const to = input.to
    ? new Date(dayStart(input.to, -1).getTime() - 1)
    : new Date(dayStart(now, -1).getTime() - 1);
  const days = Math.max(1, Math.round((dayStart(to, -1).getTime() - from.getTime()) / 86_400_000));
  const prevFrom = dayStart(from, days).getTime();
  const prevTo = from.getTime() - 1;
  const ref = new Date(Math.min(to.getTime(), now.getTime()));
  const R = ref.getTime();
  const F = from.getTime();
  const T = to.getTime();
  const last7 = dayStart(ref, 6).getTime();
  const prev7 = dayStart(ref, 13).getTime();

  /* 8 tranches hebdomadaires se terminant à `ref` (mini-histogrammes). */
  const buckets = Array.from({ length: 8 }, (_, k) => {
    const start = dayStart(ref, (7 - k) * 7 + 6).getTime();
    const end = Math.min(dayStart(ref, (7 - k) * 7 - 1).getTime() - 1, R);
    return { start, end };
  });
  const spark = (dates: (string | null | undefined)[]) =>
    buckets.map((b) => dates.filter((d) => between(d, b.start, b.end)).length);

  const { signals, articles, linkedin, companies } = input;
  const inPeriod = signals.filter((s) => between(s.createdAt, F, T));

  /* KPI */
  const companiesNow = companies.filter((c) => time(c.createdAt) <= R).length;
  const companiesBefore = companies.filter((c) => time(c.createdAt) < F).length;
  const companiesTrend = percentTrend(companiesNow, companiesBefore);

  const signals7 = signals.filter((s) => between(s.createdAt, last7, R)).length;
  const signalsPrev7 = signals.filter((s) => between(s.createdAt, prev7, last7 - 1)).length;
  const signalsTrend = percentTrend(signals7, signalsPrev7);

  const priority = inPeriod.filter(isPriority);
  const high = signals.filter((s) => s.score.total >= PRIORITY_SCORE);
  const priorityTrend = deltaTrend(
    high.filter((s) => between(s.createdAt, last7, R)).length,
    high.filter((s) => between(s.createdAt, prev7, last7 - 1)).length,
  );

  const drafts = articles.filter((a) => a.wordpress.status === "brouillon");
  const synced = articles.filter(
    (a) => a.wordpress.status === "brouillon" || a.wordpress.status === "publie",
  );
  const draftsTrend = deltaTrend(
    drafts.filter((a) => between(a.wordpress.lastSyncAt, last7, R)).length,
    drafts.filter((a) => between(a.wordpress.lastSyncAt, prev7, last7 - 1)).length,
  );

  const toValidate = linkedin.filter((p) => p.status === "a_valider");
  const linkedinTrend = percentTrend(
    linkedin.filter((p) => between(p.createdAt, last7, R)).length,
    linkedin.filter((p) => between(p.createdAt, prev7, last7 - 1)).length,
  );

  const kpis: KpiCard[] = [
    {
      key: "companies",
      value: companiesNow,
      label: "entreprises suivies",
      trend: companiesTrend,
      trendDirection: direction(companiesTrend),
      spark: buckets.map((b) => companies.filter((c) => time(c.createdAt) <= b.end).length),
    },
    {
      key: "signals",
      value: signals7,
      label: "signaux détectés",
      trend: signalsTrend,
      trendDirection: direction(signalsTrend),
      spark: spark(signals.map((s) => s.createdAt)),
    },
    {
      key: "priority_topics",
      value: priority.length,
      label: "sujets prioritaires",
      trend: priorityTrend,
      trendDirection: direction(priorityTrend),
      spark: spark(high.map((s) => s.createdAt)),
    },
    {
      key: "wordpress_drafts",
      value: drafts.length,
      label: "brouillons WordPress",
      trend: draftsTrend,
      trendDirection: direction(draftsTrend),
      spark: spark(synced.map((a) => a.wordpress.lastSyncAt)),
    },
    {
      key: "linkedin_to_validate",
      value: toValidate.length,
      label: "posts LinkedIn à valider",
      trend: linkedinTrend,
      trendDirection: direction(linkedinTrend),
      spark: spark(linkedin.map((p) => p.createdAt)),
    },
  ];

  /* Groupes */
  const countBy = <K extends string>(
    list: SignalRecord[],
    key: (s: SignalRecord) => K | undefined,
  ) => {
    const m = new Map<K, number>();
    for (const s of list) {
      const k = key(s);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const byTheme = countBy(priority, (s) => s.themes[0]);
  const prioritaires: DashboardGroup = {
    key: "prioritaires",
    label: "Sujets prioritaires",
    total: priority.length,
    items: THEME_ORDER.filter((t) => byTheme.has(t))
      .map((t) => ({
        key: t,
        label: THEME_META[t].label,
        count: byTheme.get(t)!,
        icon: THEME_META[t].icon,
        tone: THEME_META[t].tone,
      }))
      .sort((a, b) => b.count - a.count || THEME_ORDER.indexOf(a.key) - THEME_ORDER.indexOf(b.key))
      .slice(0, 4)
      .sort((a, b) => THEME_ORDER.indexOf(a.key) - THEME_ORDER.indexOf(b.key)),
  };

  const categoryGroup = (
    key: DashboardGroup["key"],
    label: string,
    list: SignalRecord[],
    meta: (c: Category) => { icon: string; tone: Tone },
  ): DashboardGroup => {
    const counts = countBy(list, (s) => s.category);
    const items = CATEGORY_ORDER.filter((c) => counts.has(c))
      .map((c) => ({ key: c, label: CATEGORY_GROUP_LABEL[c], count: counts.get(c)!, ...meta(c) }))
      .sort(
        (a, b) =>
          b.count - a.count || CATEGORY_ORDER.indexOf(a.key) - CATEGORY_ORDER.indexOf(b.key),
      )
      .slice(0, 4)
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.key) - CATEGORY_ORDER.indexOf(b.key));
    return { key, label, total: list.length, items };
  };
  const watched = inPeriod.filter((s) => s.status === "surveille");
  const done = inPeriod.filter((s) => s.status === "traite");
  const groups: DashboardGroup[] = [
    prioritaires,
    categoryGroup("a_surveiller", "Signaux à surveiller", watched, (c) => WATCH_META[c]),
    categoryGroup(
      "traites",
      "Sujets déjà traités",
      done,
      (c) => DONE_META[c] ?? { icon: "check", tone: "green" },
    ),
  ];

  /* Activité éditoriale (points quotidiens) */
  const published = articles.filter((a) => between(a.publishedAt, F, T));
  const points: ActivityPoint[] = [];
  for (let i = 0; i < days; i++) {
    const start = dayStart(from, -i);
    const s = start.getTime();
    const e = dayStart(from, -(i + 1)).getTime() - 1;
    points.push({
      date: start.toISOString(),
      signals: inPeriod.filter((x) => between(x.createdAt, s, e)).length,
      articles: published.filter((a) => between(a.publishedAt, s, e)).length,
    });
  }
  const previousSignals = signals.filter((s) => between(s.createdAt, prevFrom, prevTo)).length;

  /* Cartes basses */
  const latestDraft = [...drafts].sort((a, b) => time(b.updatedAt) - time(a.updatedAt))[0];
  const draftReady =
    !!latestDraft &&
    latestDraft.status === "approuve" &&
    latestDraft.approvals.some(
      (a) => a.valid && a.channel === "wordpress" && a.version === latestDraft.currentVersion,
    );

  const latestPost = [...toValidate].sort((a, b) => time(b.updatedAt) - time(a.updatedAt))[0];
  const variant =
    latestPost?.variants.find((v) => v.id === latestPost.selectedVariantId) ??
    latestPost?.variants[0];

  const edition = input.newsletters
    .filter((n) => n.status !== "exportee")
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  const topPriority = [...priority].sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];

  const activeSources = input.sources.filter((s) => s.access !== "desactivee").length;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    kpis,
    groups,
    activity: {
      points,
      totalSignals: inPeriod.length,
      totalArticles: published.length,
      trend: percentTrend(inPeriod.length, previousSignals),
    },
    latestWordpressDraft: latestDraft
      ? {
          articleId: latestDraft.id,
          title: latestDraft.title,
          updatedAt: latestDraft.updatedAt,
          ready: draftReady,
        }
      : null,
    latestLinkedInPost:
      latestPost && variant
        ? {
            postId: latestPost.id,
            excerpt: truncate(variant.text.split(/\n\s*\n/)[0] ?? variant.text, 160),
            updatedAt: latestPost.updatedAt,
            status: latestPost.status,
          }
        : null,
    newsletter: edition
      ? {
          editionId: edition.id,
          title: edition.title,
          selectedCount: edition.items.length,
          scheduledFor: edition.scheduledFor,
          includeNext: !!topPriority && edition.items.some((i) => i.signalId === topPriority.id),
          signalId: topPriority?.id ?? null,
        }
      : null,
    engine: {
      active: !input.paidCallsSuspended,
      sourcesCount: activeSources,
      features: [
        `Veille multi-sources (${Math.max(50, Math.floor(activeSources / 50) * 50)}+ sources)`,
        "Analyse sémantique et scoring",
        "Détection de signaux faibles",
      ],
    },
  };
}
