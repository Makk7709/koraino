import type {
  Approval,
  ArticleVersion,
  AuditEvent,
  Category,
  CollectionRun,
  Criterion,
  EditorialExample,
  FactCheck,
  Notification,
  Observation,
  Outlet,
  PublicationAttempt,
  Signal,
  SignalStatus,
  Theme,
  User,
} from "@/lib/api/types";
import { TemplateTextModel } from "../adapters/text-model";
import { DEFAULT_LIMITS } from "../domain/budget";
import { dayStart, DAY, HOUR, monthStart, mondayOf, isoDay } from "../domain/dates";
import { analyzeCorrections, collectCorrections, KORA_AUTHOR } from "../domain/dna";
import { markSyndication } from "../domain/evidence";
import { applyAccepted, buildProposals } from "../domain/imports";
import { assess, CRITERIA, computeTotal, DEFAULT_WEIGHTS } from "../domain/scoring";
import { firstSentence, initials, slugify, truncate } from "../domain/text";
import { idempotencyKey, MODIFIED_AFTER_APPROVAL } from "../domain/workflow";
import {
  BRAND_COLORS,
  CATEGORY_LABEL,
  CITIES,
  COUNTRIES,
  EVENT_TEMPLATES,
  LOCAL_OUTLETS,
  NAME_PREFIXES,
  NAME_SUFFIXES,
  NATIONAL_MEDIA,
  OUTLETS,
  PRIZES,
  TERRITORIES,
  THEME_TAGS,
  type EventText,
  type SuffixSpec,
} from "./catalog";
import { createRng } from "./prng";
import type {
  ArticleRecord,
  CompanyRecord,
  GridRecord,
  ImportRecord,
  LinkedInPostRecord,
  NewsletterRecord,
  ObservationRecord,
  RuleProposalRecord,
  RuleRecord,
  Settings,
  SignalRecord,
  SourceRecord,
  UsageEntry,
} from "./records";

export interface SeedData {
  settings: Settings;
  users: User[];
  companies: CompanyRecord[];
  sources: SourceRecord[];
  runs: CollectionRun[];
  observations: ObservationRecord[];
  signals: SignalRecord[];
  grids: GridRecord[];
  articles: ArticleRecord[];
  publications: PublicationAttempt[];
  imports: ImportRecord[];
  linkedin: LinkedInPostRecord[];
  newsletters: NewsletterRecord[];
  rules: RuleRecord[];
  examples: EditorialExample[];
  ruleProposals: RuleProposalRecord[];
  usage: UsageEntry[];
  audit: AuditEvent[];
  notifications: Notification[];
}

export const USERS = {
  sophie: {
    id: "u_sophie",
    name: "Sophie Martin",
    email: "sophie.martin@inovallee.com",
    team: "Équipe Communication",
    roles: ["admin", "redacteur", "validateur"],
    avatarUrl: null,
  },
  lucas: {
    id: "u_lucas",
    name: "Lucas Bernard",
    email: "lucas.bernard@inovallee.com",
    team: "Équipe Communication",
    roles: ["redacteur"],
    avatarUrl: null,
  },
  claire: {
    id: "u_claire",
    name: "Claire Dubois",
    email: "claire.dubois@inovallee.com",
    team: "Direction",
    roles: ["validateur"],
    avatarUrl: null,
  },
  marc: {
    id: "u_marc",
    name: "Marc Lefèvre",
    email: "marc.lefevre@inovallee.com",
    team: "Développement économique",
    roles: ["lecteur"],
    avatarUrl: null,
  },
} satisfies Record<string, User>;

export const DEFAULT_USER_ID = USERS.sophie.id;
export const WORKSPACE_ID = "ws_inovallee";

const pad = (n: number, w = 4) => String(n).padStart(w, "0");
const iso = (d: Date | number) => new Date(d).toISOString();

const REJECT_REASONS = [
  "Hors périmètre éditorial",
  "Doublon d'un sujet déjà traité",
  "Information trop mineure pour le lectorat",
  "Source jugée insuffisante",
  "Actualité trop ancienne",
];

interface SignalSpec {
  id?: string;
  d: number;
  createdAt?: Date;
  status: SignalStatus;
  category: Category;
  theme?: Theme;
  company?: CompanyRecord;
  unattached?: boolean;
  score: number;
  contradictory?: boolean;
  unknownDate?: boolean;
  articleTag?: string;
  fixed?: FixedSignal;
}

/** Signal décrit à la main (entreprises de la maquette). */
interface FixedSignal {
  title: string;
  summary: string;
  tags: string[];
  themes: Theme[];
  matchConfidence: number;
  subScores: Record<Criterion, number>;
  whyInteresting?: string[];
  angle?: { text: string; tags: string[] };
  readingMinutes: number;
  observations: {
    outlet: Outlet;
    url: string;
    title: string;
    excerpt: string;
    sourceId: string | null;
    publishedOffsetMin: number;
  }[];
}

export function buildSeed(now: Date): SeedData {
  const rng = createRng(20261012);
  const model = new TemplateTextModel();
  const nowMs = now.getTime();
  const minutesAgo = (m: number) => new Date(nowMs - m * 60_000);
  const latestSafe = nowMs - 3 * HOUR;

  /** Instant déterministe dans le jour situé `d` jours avant aujourd'hui (heure locale). */
  const atDay = (d: number, frac: number, cap = true): Date => {
    const start = dayStart(now, d).getTime();
    const end = d === 0 ? nowMs : dayStart(now, d - 1).getTime();
    let t = start + frac * (end - start);
    if (cap && t > latestSafe) t = Math.max(start, latestSafe - rng.int(0, 60) * 60_000);
    return new Date(Math.min(t, nowMs));
  };

  /* ---------------------------------------------------------------- */
  /* Utilisateurs, grille                                              */
  /* ---------------------------------------------------------------- */
  const users: User[] = Object.values(USERS);
  const grid: GridRecord = {
    id: "grid_v1",
    version: 1,
    weights: { ...DEFAULT_WEIGHTS },
    createdAt: iso(nowMs - 120 * DAY),
    createdBy: USERS.sophie.name,
    active: true,
    note: "Grille initiale validée au cadrage",
  };

  /* ---------------------------------------------------------------- */
  /* Registre : entreprises                                            */
  /* ---------------------------------------------------------------- */
  const real: CompanyRecord[] = [
    {
      id: "co_pasqal",
      name: "Pasqal",
      aliases: ["Pasqal SAS"],
      domain: "pasqal.com",
      sector: "Informatique quantique",
      territory: "Grenoble",
      priority: "haute",
      themes: ["deeptech_quantique"],
      brand: { initials: "PQ", bg: "#0b2b30", fg: "#c8f560" },
      createdAt: iso(nowMs - 420 * DAY),
      fictional: false,
    },
    {
      id: "co_verkor",
      name: "Verkor",
      aliases: ["Verkor SAS"],
      domain: "verkor.com",
      sector: "Batteries bas carbone",
      territory: "Grenoble",
      priority: "haute",
      themes: ["transition_energetique", "mobilite"],
      brand: { initials: "VK", bg: "#ffffff", fg: "#0f5c4a" },
      createdAt: iso(nowMs - 410 * DAY),
      fictional: false,
    },
    {
      id: "co_wattpark",
      name: "Wattpark",
      aliases: ["Watt Park"],
      domain: "wattpark.fr",
      sector: "Mobilité électrique",
      territory: "Grenoble",
      priority: "haute",
      themes: ["transition_energetique", "mobilite"],
      brand: { initials: "W", bg: "#ffffff", fg: "#3fb84a" },
      createdAt: iso(nowMs - 380 * DAY),
      fictional: false,
    },
    {
      id: "co_sinano",
      name: "SiNANO Institute",
      aliases: ["SiNANO"],
      domain: "sinano.eu",
      sector: "Nanoélectronique",
      territory: "Grenoble",
      priority: "haute",
      themes: ["deeptech_quantique"],
      brand: { initials: "SN", bg: "#ffffff", fg: "#e3263a" },
      createdAt: iso(nowMs - 360 * DAY),
      fictional: false,
    },
    {
      id: "co_araymond",
      name: "ARaymond",
      aliases: ["A. Raymond", "ARaymond Network"],
      domain: "araymond.com",
      sector: "Solutions de fixation",
      territory: "Grenoble",
      priority: "haute",
      themes: ["mobilite", "ia_industrie"],
      brand: { initials: "AR", bg: "#ffffff", fg: "#1d6fd1" },
      createdAt: iso(nowMs - 400 * DAY),
      fictional: false,
    },
  ];
  const [pasqal, verkor, wattpark, sinano, araymond] = real as [
    CompanyRecord,
    CompanyRecord,
    CompanyRecord,
    CompanyRecord,
    CompanyRecord,
  ];

  const combos: { prefix: string; spec: SuffixSpec }[] = [];
  for (const prefix of NAME_PREFIXES)
    for (const spec of NAME_SUFFIXES) combos.push({ prefix, spec });
  rng.shuffle(combos);
  const prefixUse = new Map<string, number>();
  const suffixUse = new Map<string, number>();
  const fictional: CompanyRecord[] = [];
  const specOf = new Map<string, SuffixSpec>();
  for (const { prefix, spec } of combos) {
    if (fictional.length >= 145) break;
    if ((prefixUse.get(prefix) ?? 0) >= 4 || (suffixUse.get(spec.s) ?? 0) >= 6) continue;
    prefixUse.set(prefix, (prefixUse.get(prefix) ?? 0) + 1);
    suffixUse.set(spec.s, (suffixUse.get(spec.s) ?? 0) + 1);
    const name = `${prefix} ${spec.s}`;
    const roll = rng.next();
    const color = rng.pick(BRAND_COLORS);
    const company: CompanyRecord = {
      id: `co_${slugify(name)}`,
      name,
      aliases: [`${name} SAS`],
      domain: `${slugify(prefix)}-${slugify(spec.s)}.fr`,
      sector: spec.sector,
      territory: rng.pick(TERRITORIES),
      priority: roll < 0.2 ? "haute" : roll < 0.8 ? "normale" : "basse",
      themes: [...spec.themes],
      brand: { initials: initials(name), bg: color.bg, fg: color.fg },
      createdAt: "",
      fictional: true,
    };
    specOf.set(company.id, spec);
    fictional.push(company);
  }
  // 16 entreprises ajoutées sur les 30 derniers jours, les autres plus anciennes.
  const recentIdx = new Set<number>();
  while (recentIdx.size < 16) recentIdx.add(rng.int(0, fictional.length - 1));
  const recentDays = [1, 2, 3, 4, 6, 8, 9, 11, 13, 15, 17, 19, 21, 24, 26, 28];
  let rIdx = 0;
  fictional.forEach((c, i) => {
    if (recentIdx.has(i)) c.createdAt = iso(atDay(recentDays[rIdx++]!, rng.next()));
    else c.createdAt = iso(nowMs - rng.int(35, 900) * DAY - rng.int(0, 20) * HOUR);
  });
  const companies = [...real, ...fictional];
  const oldFictional = fictional.filter((_, i) => !recentIdx.has(i));
  const byFirstTheme = (t: Theme) => oldFictional.filter((c) => c.themes[0] === t);

  /* ---------------------------------------------------------------- */
  /* Sources                                                           */
  /* ---------------------------------------------------------------- */
  const sources: SourceRecord[] = [];
  const sourcesByCompany = new Map<string, SourceRecord[]>();
  const addSource = (
    company: CompanyRecord,
    type: SourceRecord["type"],
    label: string,
    url: string,
    extra: Partial<SourceRecord> = {},
  ) => {
    const lastRun = nowMs - rng.int(1, 20) * HOUR - rng.int(0, 59) * 60_000;
    const s: SourceRecord = {
      id: `src_${pad(sources.length + 1)}`,
      companyId: company.id,
      type,
      label,
      url,
      frequency: type === "recherche_web" ? "hebdomadaire" : "quotidienne",
      access: "ok",
      lastRunAt: iso(lastRun),
      lastSuccessAt: iso(lastRun),
      failureCode: null,
      failureReason: null,
      attempts: 0,
      createdAt: iso(Date.parse(company.createdAt) + HOUR),
      runCount: rng.int(10, 120),
      simulation: { mode: "auto" },
      ...extra,
    };
    sources.push(s);
    sourcesByCompany.set(company.id, [...(sourcesByCompany.get(company.id) ?? []), s]);
    return s;
  };
  const search = (c: CompanyRecord) =>
    `https://websearch.korev.ai/?q=${encodeURIComponent(c.name)}`;
  addSource(pasqal, "site_officiel", "Site officiel", "https://www.pasqal.com");
  const pasqalCp = addSource(
    pasqal,
    "communiques",
    "Communiqués de presse",
    "https://www.pasqal.com/fr/actualites",
  );
  addSource(pasqal, "recherche_web", "Recherche web", search(pasqal));
  addSource(verkor, "site_officiel", "Site officiel", "https://www.verkor.com");
  const verkorCp = addSource(
    verkor,
    "communiques",
    "Communiqués de presse",
    "https://www.verkor.com/presse",
  );
  const wattSite = addSource(wattpark, "site_officiel", "Site officiel", "https://www.wattpark.fr");
  addSource(wattpark, "rss", "Flux RSS actualités", "https://www.wattpark.fr/feed");
  addSource(sinano, "site_officiel", "Site officiel", "https://www.sinano.eu");
  addSource(sinano, "actualites", "Page actualités", "https://www.sinano.eu/news");
  addSource(araymond, "site_officiel", "Site officiel", "https://www.araymond.com");
  addSource(araymond, "communiques", "Communiqués de presse", "https://www.araymond.com/fr/presse");
  addSource(araymond, "recherche_web", "Recherche web", search(araymond));

  const second: SourceRecord["type"][] = ["communiques", "rss", "recherche_web"];
  const twoSources = new Set<number>();
  while (twoSources.size < 103) twoSources.add(rng.int(0, fictional.length - 1));
  fictional.forEach((c, i) => {
    const firstType = rng.chance(0.5) ? "actualites" : "site_officiel";
    addSource(
      c,
      firstType,
      firstType === "actualites" ? "Page actualités" : "Site officiel",
      firstType === "actualites" ? `https://www.${c.domain}/actualites` : `https://www.${c.domain}`,
    );
    if (twoSources.has(i)) {
      const t = rng.pick(second);
      addSource(
        c,
        t,
        t === "communiques" ? "Communiqués de presse" : t === "rss" ? "Flux RSS" : "Recherche web",
        t === "communiques"
          ? `https://www.${c.domain}/presse`
          : t === "rss"
            ? `https://www.${c.domain}/feed.xml`
            : search(c),
      );
    }
  });

  const failures = [
    { code: "HTTP_403", reason: "Accès refusé par le serveur (HTTP 403) après 3 essais" },
    { code: "TIMEOUT", reason: "Délai de réponse dépassé (30 s) après 3 essais" },
    { code: "HTTP_404", reason: "Page actualités introuvable (HTTP 404) après 3 essais" },
    { code: "TLS_ERROR", reason: "Certificat TLS invalide ou expiré après 3 essais" },
  ];
  const failingSources: SourceRecord[] = [];
  failures.forEach((f, i) => {
    const c = oldFictional[10 + i * 17]!;
    const s = sourcesByCompany.get(c.id)![0]!;
    s.access = "erreur";
    s.failureCode = f.code;
    s.failureReason = f.reason;
    s.attempts = 3;
    s.lastRunAt = iso(nowMs - (2 + i * 2) * HOUR);
    s.lastSuccessAt = iso(nowMs - (4 + i * 3) * DAY);
    s.simulation = { mode: "fail", code: f.code, reason: f.reason };
    failingSources.push(s);
  });
  fictional.forEach((c, i) => {
    if (!recentIdx.has(i)) return;
    const created = Date.parse(c.createdAt);
    for (const s of sourcesByCompany.get(c.id) ?? []) {
      if (nowMs - created < 3 * DAY) {
        s.access = "en_attente";
        s.lastRunAt = null;
        s.lastSuccessAt = null;
        s.runCount = 0;
      }
    }
  });
  const disabled = sourcesByCompany.get(oldFictional[90]!.id)!;
  disabled[disabled.length - 1]!.access = "desactivee";

  /* ---------------------------------------------------------------- */
  /* Observations & signaux                                            */
  /* ---------------------------------------------------------------- */
  const observations: ObservationRecord[] = [];
  const signals: SignalRecord[] = [];
  const signalTag = new Map<string, string>();
  let sigN = 0;

  const eventParams = (company: CompanyRecord, amount?: number, displayName?: string) => {
    const spec = specOf.get(company.id) ?? NAME_SUFFIXES[0]!;
    let partner = rng.pick(oldFictional).name;
    if (partner === company.name) partner = rng.pick(oldFictional).name;
    return {
      company: displayName ?? company.name,
      partner,
      amount: amount ?? rng.int(2, 38),
      count: rng.int(8, 60),
      topic: spec.topic,
      product: rng.pick(spec.products),
      country: rng.pick(COUNTRIES),
      city: rng.pick(CITIES),
      prize: rng.pick(PRIZES),
    };
  };

  const prefixOf = (c: CompanyRecord) => c.name.split(" ")[0]!;
  const pickCompany = (spec: SignalSpec): CompanyRecord => {
    if (spec.company) return spec.company;
    if (spec.theme) return rng.pick(byFirstTheme(spec.theme));
    if (spec.unattached) {
      return rng.pick(oldFictional.filter((c) => (prefixUse.get(prefixOf(c)) ?? 0) >= 2));
    }
    return rng.pick(oldFictional);
  };

  const fitScores = (target: number, base: Record<Criterion, number>) => {
    const s = { ...base };
    const delta = target - computeTotal(s, DEFAULT_WEIGHTS);
    for (const c of CRITERIA) s[c] = Math.max(0, Math.min(100, s[c] + delta + rng.int(-3, 3)));
    for (let i = 0; i < 200; i++) {
      const diff = target - computeTotal(s, DEFAULT_WEIGHTS);
      if (diff === 0) break;
      const c = CRITERIA[i % CRITERIA.length]!;
      const step = Math.sign(diff);
      if ((step > 0 && s[c] < 100) || (step < 0 && s[c] > 0)) s[c] += step;
    }
    return s;
  };

  const makeSignal = (spec: SignalSpec): SignalRecord => {
    sigN += 1;
    const id = spec.id ?? `sig_${pad(sigN)}`;
    const createdAt = spec.createdAt ?? atDay(spec.d, 0.1 + rng.next() * 0.8);
    const created = createdAt.getTime();
    const company = spec.fixed ? spec.company! : pickCompany(spec);
    const obsList: Observation[] = [];

    const pushObs = (o: Omit<Observation, "id" | "signalId" | "isSyndicated">) => {
      const ob: Observation = {
        ...o,
        id: `obs_${pad(observations.length + obsList.length + 1)}`,
        signalId: id,
        isSyndicated: false,
      };
      obsList.push(ob);
      return ob;
    };

    let text: EventText;
    let themes: Theme[];
    let tags: string[];
    let matchConfidence: number;
    const companyId = spec.unattached ? null : company.id;

    if (spec.fixed) {
      const f = spec.fixed;
      text = { title: f.title, summary: f.summary, communique: f.summary, media: f.summary };
      themes = [...f.themes];
      tags = [...f.tags];
      matchConfidence = f.matchConfidence;
      f.observations.forEach((o, i) => {
        const collected = created + i * 7 * 60_000;
        const published = created - o.publishedOffsetMin * 60_000;
        pushObs({
          sourceId: o.sourceId,
          companyId: company.id,
          outlet: o.outlet,
          url: o.url,
          title: o.title,
          excerpt: o.excerpt,
          collectedAt: iso(Math.min(collected, nowMs)),
          publishedAt: iso(published),
          eventDate: iso(published),
          matchConfidence: o.outlet.domain === company.domain ? 97 : f.matchConfidence,
        });
      });
    } else {
      const amount = rng.int(2, 38);
      const params = eventParams(company, amount, spec.unattached ? prefixOf(company) : undefined);
      text = EVENT_TEMPLATES[spec.category](params);
      const alt = spec.contradictory
        ? EVENT_TEMPLATES[spec.category]({ ...params, amount: amount + 3 })
        : text;
      themes = spec.unattached ? [] : [...company.themes];
      tags = [
        ...new Set([CATEGORY_LABEL[spec.category], ...company.themes.map((t) => THEME_TAGS[t])]),
      ].slice(0, 3);
      matchConfidence = spec.unattached ? rng.int(40, 55) : rng.int(66, 96);

      const companySource = (sourcesByCompany.get(company.id) ?? [])[0] ?? null;
      const webSource =
        (sourcesByCompany.get(company.id) ?? []).find((s) => s.type === "recherche_web") ?? null;
      const shape = spec.contradictory ? 3 : spec.unattached ? rng.pick([1, 4]) : rng.int(0, 5);
      const unknown = !!spec.unknownDate;
      const published = (offsetH: number) => (unknown ? null : iso(created - offsetH * HOUR));
      const slug = slugify(text.title);
      const direct = () => {
        const publishedAt = published(rng.int(1, 14));
        return pushObs({
          sourceId: companySource?.id ?? null,
          companyId,
          outlet: { name: company.name, domain: company.domain, brand: company.brand },
          url: `https://www.${company.domain}/actualites/${slug}`,
          title: text.title,
          excerpt: text.communique,
          collectedAt: iso(created),
          publishedAt,
          eventDate: publishedAt,
          matchConfidence: 97,
        });
      };
      const media = (excerpt: string, offsetMin: number, national = false, title = text.title) => {
        const outlet = rng.pick(national ? NATIONAL_MEDIA : LOCAL_OUTLETS);
        return pushObs({
          sourceId: spec.unattached ? null : (webSource?.id ?? null),
          companyId,
          outlet,
          url: `https://www.${outlet.domain}/economie/${slug}-${rng.int(10000, 99999)}`,
          title,
          excerpt,
          collectedAt: iso(Math.min(created + offsetMin * 60_000, nowMs)),
          publishedAt: published(rng.int(1, 18)),
          eventDate: null,
          matchConfidence,
        });
      };
      if (shape === 0) direct();
      else if (shape === 1) media(text.media, 0, rng.chance(0.3));
      else if (shape === 2) {
        direct();
        media(text.media, rng.int(20, 300), rng.chance(0.4));
      } else if (shape === 3) {
        direct();
        media(alt.media, rng.int(20, 300), rng.chance(0.4), alt.title);
        media(text.communique, rng.int(301, 600));
      } else if (shape === 4) {
        media(text.media, 0, true);
        media(text.media, rng.int(30, 400));
      } else {
        direct();
        media(text.communique, rng.int(30, 400));
      }
    }

    const marked = markSyndication(obsList);
    observations.push(...marked);
    const primary =
      marked.find((o) => o.outlet.domain !== company.domain && !o.isSyndicated) ?? marked[0]!;
    const publishedTimes = marked
      .map((o) => o.publishedAt)
      .filter((p): p is string => !!p)
      .sort();
    const eventDates = marked
      .map((o) => o.eventDate)
      .filter((p): p is string => !!p)
      .sort();

    const base = assess({
      category: spec.category,
      title: text.title,
      text: text.summary,
      company: spec.unattached ? null : company,
      observations: marked,
      priorSameCategory: false,
      eventLagDays: spec.unknownDate ? null : 0,
    });
    const subScores = spec.fixed ? spec.fixed.subScores : fitScores(spec.score, base.subScores);
    const score = {
      total: computeTotal(subScores, DEFAULT_WEIGHTS),
      gridVersion: 1,
      subScores,
      reasons: base.reasons,
    };
    const notes = model.editorialNotes({
      category: spec.category,
      companyName: spec.unattached ? null : company.name,
      score,
    });
    const decided = spec.status !== "nouveau";
    const updated = decided ? Math.min(created + rng.int(1, 30) * HOUR, latestSafe) : created;

    const signal: SignalRecord = {
      id,
      companyId,
      title: text.title,
      summary: text.summary,
      category: spec.category,
      themes,
      tags,
      status: spec.status,
      statusReason: spec.status === "rejete" ? rng.pick(REJECT_REASONS) : null,
      observationIds: marked.map((o) => o.id),
      primaryOutlet: primary.outlet,
      primaryUrl: primary.url,
      collectedAt: marked[0]!.collectedAt,
      publishedAt: publishedTimes[0] ?? null,
      eventDate: eventDates[0] ?? null,
      matchConfidence,
      score,
      whyInteresting: spec.fixed?.whyInteresting ?? notes.whyInteresting,
      suggestedAngle: spec.fixed?.angle ?? notes.suggestedAngle,
      readingMinutes: spec.fixed?.readingMinutes ?? 1 + (sigN % 4),
      review: spec.unattached
        ? {
            kind: "homonymie",
            note: `Rattachement incertain : « ${company.name.split(" ")[0]} » correspond à plusieurs entreprises du registre`,
          }
        : null,
      articleId: null,
      createdAt: iso(created),
      updatedAt: iso(Math.max(updated, created)),
    };
    signals.push(signal);
    if (spec.articleTag) signalTag.set(spec.articleTag, id);
    return signal;
  };

  /* --- Signaux de la maquette (les 5 plus récents) ----------------- */
  const sigPasqal = makeSignal({
    id: "sig_pasqal",
    d: 0,
    createdAt: minutesAgo(25),
    status: "nouveau",
    category: "financement",
    company: pasqal,
    score: 92,
    fixed: {
      title: "Pasqal lève 100 M€ pour accélérer l'informatique quantique",
      summary:
        "La deeptech grenobloise Pasqal annonce une levée de 100 millions d'euros en série B pour industrialiser ses processeurs quantiques à atomes neutres et renforcer son développement international.",
      tags: ["Deeptech", "Quantique", "Levée de fonds"],
      themes: ["deeptech_quantique"],
      matchConfidence: 92,
      subScores: { importance: 95, nouveaute: 90, territoire: 95, lecteurs: 90, diffusion: 85 },
      whyInteresting: [
        "Renforce la visibilité internationale de l'écosystème Inovallée",
        "Positionne Grenoble comme leader du quantique en Europe",
        "Opportunités de partenariats industriels",
      ],
      angle: {
        text: "Pasqal : une nouvelle étape pour le quantique européen depuis Grenoble",
        tags: ["Innovation", "Rayonnement territorial", "Souveraineté technologique"],
      },
      readingMinutes: 2,
      observations: [
        {
          outlet: OUTLETS.lesechos,
          url: "https://www.lesechos.fr/tech-medias/hightech/pasqal-leve-100-millions-deuros-pour-accelerer-linformatique-quantique",
          title: "Pasqal lève 100 M€ pour accélérer l'informatique quantique",
          excerpt:
            "La deeptech grenobloise Pasqal annonce une levée de 100 millions d'euros en série B pour industrialiser ses processeurs quantiques à atomes neutres et renforcer son développement international.",
          sourceId: null,
          publishedOffsetMin: 95,
        },
        {
          outlet: { name: "Pasqal", domain: "pasqal.com", brand: pasqal.brand },
          url: "https://www.pasqal.com/fr/actualites/levee-de-fonds-serie-b",
          title: "Pasqal annonce une levée de fonds de série B de 100 millions d'euros",
          excerpt:
            "Pasqal annonce une levée de fonds de série B de 100 millions d'euros pour industrialiser ses processeurs quantiques à atomes neutres.",
          sourceId: pasqalCp.id,
          publishedOffsetMin: 180,
        },
        {
          outlet: OUTLETS.tribune,
          url: "https://www.latribune.fr/entreprises-finance/quantique-pasqal-securise-100-millions-d-euros",
          title: "Quantique : Pasqal sécurise 100 millions d'euros",
          excerpt:
            "Nouvelle étape pour Pasqal : la société grenobloise boucle un tour de table de 100 M€ et vise le passage à l'échelle industrielle.",
          sourceId: null,
          publishedOffsetMin: 60,
        },
        {
          outlet: OUTLETS.dauphine,
          url: "https://www.ledauphine.com/economie/pasqal-annonce-une-levee-de-fonds-de-100-millions-d-euros",
          title: "Pasqal annonce une levée de fonds de 100 millions d'euros",
          excerpt:
            "Pasqal annonce une levée de fonds de série B de 100 millions d'euros pour industrialiser ses processeurs quantiques à atomes neutres.",
          sourceId: null,
          publishedOffsetMin: 40,
        },
      ],
    },
  });
  makeSignal({
    id: "sig_verkor",
    d: 0,
    createdAt: minutesAgo(60),
    status: "a_traiter",
    category: "partenariat",
    company: verkor,
    score: 87,
    fixed: {
      title: "Verkor et Renault unissent leurs forces en Europe",
      summary:
        "Verkor et Renault annoncent unir leurs forces pour renforcer leur coopération industrielle autour des batteries en Europe.",
      tags: ["Batteries", "Partenariat", "Mobilité"],
      themes: ["transition_energetique", "mobilite"],
      matchConfidence: 88,
      subScores: { importance: 90, nouveaute: 85, territoire: 90, lecteurs: 85, diffusion: 80 },
      readingMinutes: 3,
      observations: [
        {
          outlet: OUTLETS.figaro,
          url: "https://www.lefigaro.fr/societes/verkor-et-renault-unissent-leurs-forces-en-europe",
          title: "Verkor et Renault unissent leurs forces en Europe",
          excerpt:
            "Le fabricant grenoblois de batteries Verkor et Renault annoncent unir leurs forces pour renforcer leur coopération industrielle en Europe.",
          sourceId: null,
          publishedOffsetMin: 120,
        },
        {
          outlet: { name: "Verkor", domain: "verkor.com", brand: verkor.brand },
          url: "https://www.verkor.com/presse/verkor-renault-cooperation-europe",
          title: "Verkor et Renault renforcent leur coopération",
          excerpt:
            "Verkor et Renault annoncent renforcer leur coopération industrielle autour des batteries en Europe.",
          sourceId: verkorCp.id,
          publishedOffsetMin: 200,
        },
      ],
    },
  });
  makeSignal({
    id: "sig_wattpark",
    d: 0,
    createdAt: minutesAgo(95),
    status: "a_traiter",
    category: "international",
    company: wattpark,
    score: 81,
    fixed: {
      title: "Wattpark déploie ses solutions en Allemagne",
      summary:
        "Wattpark annonce le déploiement de ses solutions en Allemagne, une nouvelle étape de son développement international.",
      tags: ["Mobilité électrique", "International"],
      themes: ["transition_energetique", "mobilite"],
      matchConfidence: 85,
      subScores: { importance: 80, nouveaute: 85, territoire: 85, lecteurs: 80, diffusion: 70 },
      readingMinutes: 2,
      observations: [
        {
          outlet: OUTLETS.bfm,
          url: "https://www.bfmtv.com/economie/entreprises/wattpark-deploie-ses-solutions-en-allemagne",
          title: "Wattpark déploie ses solutions en Allemagne",
          excerpt:
            "La société grenobloise Wattpark annonce le déploiement de ses solutions en Allemagne.",
          sourceId: null,
          publishedOffsetMin: 150,
        },
        {
          outlet: { name: "Wattpark", domain: "wattpark.fr", brand: wattpark.brand },
          url: "https://www.wattpark.fr/actualites/wattpark-allemagne",
          title: "Wattpark arrive en Allemagne",
          excerpt: "Wattpark annonce l'arrivée de ses solutions sur le marché allemand.",
          sourceId: wattSite.id,
          publishedOffsetMin: 240,
        },
      ],
    },
  });
  makeSignal({
    id: "sig_sinano",
    d: 0,
    createdAt: minutesAgo(130),
    status: "en_revue",
    category: "distinction",
    company: sinano,
    score: 79,
    fixed: {
      title: "SiNANO Institute reçoit un prix européen pour ses nanotechnologies",
      summary:
        "SiNANO Institute est distingué au niveau européen pour ses travaux de recherche en nanotechnologies.",
      tags: ["Nanotechnologies", "Distinction", "Europe"],
      themes: ["deeptech_quantique"],
      matchConfidence: 78,
      subScores: { importance: 75, nouveaute: 80, territoire: 90, lecteurs: 75, diffusion: 75 },
      readingMinutes: 2,
      observations: [
        {
          outlet: OUTLETS.ec,
          url: "https://ec.europa.eu/info/research-and-innovation/news/sinano-institute-award",
          title: "SiNANO Institute reçoit un prix européen pour ses nanotechnologies",
          excerpt:
            "SiNANO Institute est distingué au niveau européen pour ses travaux en nanotechnologies.",
          sourceId: null,
          publishedOffsetMin: 300,
        },
        {
          outlet: OUTLETS.placegrenet,
          url: "https://www.placegrenet.fr/2026/sinano-institute-distingue-europe",
          title: "Une distinction européenne pour SiNANO Institute",
          excerpt:
            "Le réseau grenoblois SiNANO Institute voit ses recherches en nanotechnologies récompensées à l'échelle européenne.",
          sourceId: null,
          publishedOffsetMin: 200,
        },
      ],
    },
  });
  makeSignal({
    id: "sig_araymond",
    d: 0,
    createdAt: minutesAgo(165),
    status: "a_traiter",
    category: "innovation",
    company: araymond,
    score: 76,
    fixed: {
      title: "ARaymond lance une innovation durable pour l'automobile",
      summary:
        "ARaymond présente une nouvelle solution de fixation conçue pour réduire l'impact environnemental des véhicules.",
      tags: ["Automobile", "Innovation durable"],
      themes: ["mobilite", "ia_industrie"],
      matchConfidence: 76,
      subScores: { importance: 75, nouveaute: 75, territoire: 85, lecteurs: 75, diffusion: 65 },
      readingMinutes: 3,
      observations: [
        {
          outlet: OUTLETS.usine,
          url: "https://www.usinenouvelle.com/article/araymond-lance-une-innovation-durable-pour-l-automobile",
          title: "ARaymond lance une innovation durable pour l'automobile",
          excerpt:
            "ARaymond présente une nouvelle solution de fixation conçue pour réduire l'impact environnemental des véhicules.",
          sourceId: null,
          publishedOffsetMin: 260,
        },
      ],
    },
  });

  /* --- 7 derniers jours (hors maquette) : 19 signaux -------------- */
  const sigDeep1 = makeSignal({
    d: 1,
    status: "nouveau",
    theme: "deeptech_quantique",
    category: "financement",
    score: 86,
  });
  makeSignal({
    d: 2,
    status: "nouveau",
    theme: "deeptech_quantique",
    category: "innovation",
    score: 83,
  });
  const sigIa1 = makeSignal({
    d: 1,
    status: "nouveau",
    theme: "ia_industrie",
    category: "contrat",
    score: 84,
  });
  const sigTalent = makeSignal({
    d: 3,
    status: "nouveau",
    theme: "talents_rh",
    category: "recrutement",
    score: 81,
  });
  const produitTwin = makeSignal({ d: 1, status: "nouveau", category: "produit", score: 72 });
  makeSignal({ d: 1, status: "nouveau", category: "partenariat", score: 68, unattached: true });
  makeSignal({ d: 2, status: "nouveau", category: "brevet", score: 64 });
  makeSignal({ d: 3, status: "nouveau", category: "innovation", score: 74, unknownDate: true });
  makeSignal({ d: 4, status: "nouveau", category: "recherche", score: 61 });
  makeSignal({ d: 5, status: "nouveau", category: "croissance", score: 70, unattached: true });
  const uncertain = makeSignal({
    d: 6,
    status: "nouveau",
    category: "produit",
    score: 66,
    company: companies.find((c) => c.id === produitTwin.companyId)!,
  });
  uncertain.review = {
    kind: "fusion_incertaine",
    note: `Proximité avec le sujet « ${produitTwin.title} » (${produitTwin.id}) : regroupement à confirmer`,
  };
  makeSignal({ d: 4, status: "a_traiter", category: "international", score: 73 });
  makeSignal({ d: 5, status: "a_traiter", category: "contrat", score: 69 });
  makeSignal({ d: 5, status: "surveille", category: "international", score: 71 });
  makeSignal({ d: 6, status: "traite", category: "financement", score: 77 });
  for (const [d, score] of [
    [2, 42],
    [3, 38],
    [4, 51],
    [6, 33],
  ] as const) {
    makeSignal({
      d,
      status: "rejete",
      category: rng.pick(Object.keys(CATEGORY_LABEL) as Category[]),
      score,
    });
  }

  /* --- Semaine précédente (J-7 à J-13) : 18 signaux --------------- */
  makeSignal({
    d: 8,
    status: "a_traiter",
    theme: "ia_industrie",
    category: "partenariat",
    score: 82,
  });
  makeSignal({ d: 9, status: "a_traiter", category: "brevet", score: 67 });
  makeSignal({
    d: 12,
    status: "a_traiter",
    category: "financement",
    score: 74,
    contradictory: true,
  });
  makeSignal({ d: 9, status: "en_revue", category: "innovation", score: 83, articleTag: "draft2" });
  makeSignal({
    d: 11,
    status: "en_revue",
    category: "partenariat",
    score: 85,
    articleTag: "draft3",
  });
  makeSignal({ d: 10, status: "traite", category: "financement", score: 86 });
  makeSignal({ d: 12, status: "traite", category: "distinction", score: 81 });
  for (const d of [7, 7, 8, 9, 10, 10, 11, 11, 12, 13, 13]) {
    makeSignal({
      d,
      status: "rejete",
      category: rng.pick(Object.keys(CATEGORY_LABEL) as Category[]),
      score: rng.int(18, 60),
    });
  }

  /* --- J-14 à J-29 : 86 signaux ----------------------------------- */
  const windowRest: Omit<SignalSpec, "d">[] = [];
  for (let i = 0; i < 6; i++)
    windowRest.push({
      status: "a_traiter",
      category: rng.pick([
        "innovation",
        "produit",
        "contrat",
        "croissance",
        "recherche",
      ] as Category[]),
      score: rng.int(55, 78),
    });
  windowRest.push({
    status: "en_revue",
    category: "financement",
    score: 75,
    contradictory: true,
    articleTag: "contra",
  });
  windowRest.push({ status: "en_revue", category: "produit", score: 70, articleTag: "rejected" });
  windowRest.push({
    status: "en_revue",
    category: "international",
    score: 72,
    articleTag: "review",
  });
  const watchCats: [Category, number][] = [
    ["international", 3],
    ["partenariat", 3],
    ["financement", 3],
    ["produit", 2],
  ];
  for (const [category, n] of watchCats)
    for (let i = 0; i < n; i++)
      windowRest.push({ status: "surveille", category, score: rng.int(55, 78) });
  const doneCats: [Category, number][] = [
    ["financement", 6],
    ["distinction", 5],
    ["innovation", 7],
    ["croissance", 7],
  ];
  for (const [category, n] of doneCats)
    for (let i = 0; i < n; i++)
      windowRest.push({ status: "traite", category, score: rng.int(60, 90) });
  for (let i = 0; i < 41; i++)
    windowRest.push({
      status: "rejete",
      category: rng.pick(Object.keys(CATEGORY_LABEL) as Category[]),
      score: rng.int(15, 60),
    });
  const dayCounts = new Map<number, number>();
  const windowDays = Array.from({ length: 16 }, (_, i) => 14 + i);
  for (const d of windowDays) dayCounts.set(d, 4);
  for (let extra = 0; extra < 86 - windowDays.length * 4;) {
    const d = rng.pick(windowDays);
    if ((dayCounts.get(d) ?? 0) < 8) {
      dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
      extra++;
    }
  }
  const slots: number[] = [];
  for (const [d, n] of dayCounts) for (let i = 0; i < n; i++) slots.push(d);
  rng.shuffle(windowRest);
  windowRest.forEach((spec, i) => makeSignal({ ...spec, d: slots[i]! }));

  /* --- Périodes précédentes --------------------------------------- */
  const allCats = Object.keys(CATEGORY_LABEL) as Category[];
  const previous: Omit<SignalSpec, "d">[] = [];
  for (let i = 0; i < 25; i++)
    previous.push({ status: "traite", category: rng.pick(allCats), score: rng.int(60, 92) });
  for (let i = 0; i < 55; i++)
    previous.push({ status: "rejete", category: rng.pick(allCats), score: rng.int(15, 60) });
  for (let i = 0; i < 10; i++)
    previous.push({ status: "surveille", category: rng.pick(allCats), score: rng.int(50, 78) });
  rng.shuffle(previous).forEach((spec) => makeSignal({ ...spec, d: rng.int(31, 57) }));
  for (let i = 0; i < 30; i++) {
    makeSignal({
      d: rng.int(60, 110),
      status: i % 2 ? "traite" : "rejete",
      category: rng.pick(allCats),
      score: i % 2 ? rng.int(60, 90) : rng.int(15, 60),
    });
  }

  const signalById = new Map(signals.map((s) => [s.id, s]));
  const obsById = new Map(observations.map((o) => [o.id, o]));
  const obsOf = (s: SignalRecord) => s.observationIds.map((id) => obsById.get(id)!);
  const companyById = new Map(companies.map((c) => [c.id, c]));

  /* ---------------------------------------------------------------- */
  /* Règles éditoriales, exemples                                      */
  /* ---------------------------------------------------------------- */
  const ruleSpecs: [RuleRecord["kind"], string, string | null][] = [
    ["ton", "Ton factuel et positif, sans superlatif non sourcé.", null],
    ["longueur", "Titres de 70 caractères maximum.", "Titres de 80 caractères maximum."],
    ["longueur", "Articles de 300 à 500 mots.", null],
    ["structure", "Chapô de deux phrases maximum résumant le fait principal.", null],
    ["structure", "Terminer par une ouverture sur l'écosystème Inovallée.", null],
    ["vocabulaire", "Écrire « Inovallée » avec une majuscule et un accent aigu.", null],
    ["vocabulaire", "Préférer « entreprise innovante » à « pépite ».", null],
    ["interdit", "Aucune citation sans passage source identifiable.", null],
  ];
  const rules: RuleRecord[] = ruleSpecs.map(([kind, text, previousText], i) => {
    const updatedAt = iso(nowMs - (90 - i * 7) * DAY);
    const history = previousText
      ? [
          {
            version: 1,
            text: previousText,
            active: true,
            updatedAt: iso(nowMs - 110 * DAY),
            updatedBy: USERS.sophie.name,
          },
          { version: 2, text, active: true, updatedAt, updatedBy: USERS.sophie.name },
        ]
      : [{ version: 1, text, active: true, updatedAt, updatedBy: USERS.sophie.name }];
    return {
      id: `rule_${pad(i + 1, 2)}`,
      kind,
      text,
      active: true,
      version: history.length,
      updatedAt,
      updatedBy: USERS.sophie.name,
      history,
    };
  });

  const examples: EditorialExample[] = Array.from({ length: 8 }, (_, i) => {
    const c = oldFictional[(i * 13 + 5) % oldFictional.length]!;
    const category = (
      [
        "croissance",
        "financement",
        "distinction",
        "partenariat",
        "innovation",
        "recrutement",
        "international",
        "produit",
      ] as Category[]
    )[i]!;
    const t = EVENT_TEMPLATES[category](eventParams(c));
    return {
      id: `ex_${pad(i + 1, 2)}`,
      title: t.title,
      excerpt: t.summary,
      url: `https://www.inovallee.com/actualites/${slugify(t.title)}`,
      publishedAt: iso(nowMs - (40 + i * 33) * DAY),
    };
  });

  /* ---------------------------------------------------------------- */
  /* Articles                                                          */
  /* ---------------------------------------------------------------- */
  const articles: ArticleRecord[] = [];
  const publications: PublicationAttempt[] = [];
  const audit: AuditEvent[] = [];
  let artN = 0;
  let pubN = 0;
  let apprN = 0;

  const approval = (
    version: number,
    channel: Approval["channel"],
    at: number,
    by = USERS.claire.name,
  ): Approval => ({
    id: `appr_${pad(++apprN)}`,
    version,
    channel,
    approvedBy: by,
    approvedAt: iso(at),
    scheduledAt: null,
    valid: true,
    invalidatedAt: null,
    invalidatedReason: null,
  });
  const version = (n: number, v: Omit<ArticleVersion, "n">): ArticleVersion => ({ ...v, n });
  const addAudit = (
    at: number,
    actor: string,
    action: string,
    entity: AuditEvent["entity"],
    entityId: string,
    details: string,
  ) => {
    audit.push({
      id: `aud_${pad(audit.length + 1)}`,
      at: iso(at),
      actor,
      action,
      entity,
      entityId,
      details,
    });
  };
  const addPublication = (p: Omit<PublicationAttempt, "id">) => {
    const rec = { id: `pub_${pad(++pubN)}`, ...p };
    publications.push(rec);
    return rec;
  };

  const AUTHORS = ["Lucas Bernard", "Sophie Martin", "Camille Roux", "Julien Morel"];
  const CORRECTION_PLAN = [
    { revo: true, startup: null },
    { revo: true, startup: "la" },
    { revo: true, startup: null },
    { revo: false, startup: "cette" },
    { revo: true, startup: null },
    { revo: false, startup: "une" },
    { revo: true, startup: null },
    { revo: false, startup: "la" },
    { revo: false, startup: null },
  ] as const;
  let correctionIdx = 0;

  const publishSlots = (fromDay: number, toDay: number, total: number) => {
    const days: number[] = [];
    for (let d = fromDay; d <= toDay; d++) days.push(d);
    const counts = new Map(days.map((d) => [d, 2]));
    let remaining = total - days.length * 2;
    while (remaining > 0) {
      // Les jours récents sont plus probables : la courbe de publication monte.
      const d = days[Math.floor(Math.pow(rng.next(), 1.6) * days.length)]!;
      if ((counts.get(d) ?? 0) < 5) {
        counts.set(d, (counts.get(d) ?? 0) + 1);
        remaining--;
      }
    }
    const out: number[] = [];
    for (const [d, n] of [...counts.entries()].sort((a, b) => b[0] - a[0]))
      for (let i = 0; i < n; i++) out.push(d);
    return out;
  };
  const doneSignals = signals
    .filter((s) => s.status === "traite")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const signalDay = (s: SignalRecord) =>
    Math.round((dayStart(now).getTime() - dayStart(new Date(s.createdAt)).getTime()) / DAY);

  const publishedSchedule = [...publishSlots(0, 29, 86), ...publishSlots(31, 57, 62)];
  for (const d of publishedSchedule) {
    artN += 1;
    const id = `art_${pad(artN)}`;
    const publishedAt =
      d === 0 ? atDay(0, rng.next(), false).getTime() : atDay(d, 0.3 + rng.next() * 0.5).getTime();
    const linked = doneSignals.find(
      (s) => !s.articleId && signalDay(s) >= d && signalDay(s) <= d + 6,
    );
    let company: CompanyRecord;
    let title: string;
    let chapo: string;
    let factChecks: FactCheck[] = [];
    let tags: string[];
    let category: Category;
    if (linked) {
      company = companyById.get(linked.companyId ?? "") ?? rng.pick(oldFictional);
      title = linked.title;
      chapo = linked.summary;
      category = linked.category;
      tags = [...linked.tags];
      factChecks = obsOf(linked)
        .filter((o) => !o.isSyndicated)
        .map((o, i) => ({
          id: `fc_${id}_${i + 1}`,
          claim: firstSentence(o.excerpt),
          observationIds: [o.id],
          status: "etaye" as const,
          resolution: null,
        }));
      linked.articleId = id;
    } else {
      company = rng.pick(oldFictional);
      category = rng.pick(allCats);
      const t = EVENT_TEMPLATES[category](eventParams(company));
      title = t.title;
      chapo = t.summary;
      tags = [CATEGORY_LABEL[category], ...company.themes.slice(0, 1).map((th) => THEME_TAGS[th])];
    }
    const origin = rng.chance(0.3) ? "import_humain" : "kora";
    const createdAt = publishedAt - rng.int(20, 60) * HOUR;
    const body = [
      chapo,
      `${company.name}, entreprise du secteur ${company.sector.toLowerCase()} implantée à ${company.territory}, fait partie des entreprises suivies par Inovallée.`,
      "Une actualité qui illustre le dynamisme de l'écosystème Inovallée.",
    ].join("\n\n");
    const versions: ArticleVersion[] = [];
    if (origin === "kora" && correctionIdx < CORRECTION_PLAN.length && d <= 28) {
      const plan = CORRECTION_PLAN[correctionIdx++]!;
      const longTitle = `${title} et renforce sa position sur son marché`;
      const koraChapo = plan.revo
        ? chapo.replace(/\.$/, ", grâce à une approche révolutionnaire.")
        : chapo;
      const humanChapo = plan.revo
        ? chapo.replace(/\.$/, ", grâce à une approche nouvelle.")
        : chapo;
      const koraBody = plan.startup
        ? body.replace(", entreprise du secteur", `, ${plan.startup} start-up du secteur`)
        : body;
      const humanBody = plan.startup
        ? body.replace(", entreprise du secteur", `, ${plan.startup} jeune pousse du secteur`)
        : body;
      versions.push(
        version(1, {
          title: longTitle,
          chapo: koraChapo,
          body: koraBody,
          excerpt: truncate(koraChapo, 200),
          seoTitle: truncate(longTitle, 60),
          categories: [CATEGORY_LABEL[category]],
          tags,
          createdAt: iso(createdAt),
          createdBy: KORA_AUTHOR,
          note: "Brouillon généré par KORA à partir du dossier",
        }),
        version(2, {
          title,
          chapo: humanChapo,
          body: humanBody,
          excerpt: truncate(humanChapo, 200),
          seoTitle: truncate(title, 60),
          categories: [CATEGORY_LABEL[category]],
          tags,
          createdAt: iso(createdAt + 6 * HOUR),
          createdBy: rng.pick([USERS.lucas.name, USERS.sophie.name]),
          note: "Relecture éditoriale",
        }),
      );
    } else {
      versions.push(
        version(1, {
          title,
          chapo,
          body,
          excerpt: truncate(chapo, 200),
          seoTitle: truncate(title, 60),
          categories: [CATEGORY_LABEL[category]],
          tags,
          createdAt: iso(createdAt),
          createdBy: origin === "kora" ? KORA_AUTHOR : USERS.lucas.name,
          note:
            origin === "kora"
              ? "Brouillon généré par KORA à partir du dossier"
              : "Import d'un article rédigé par l'équipe",
        }),
      );
    }
    const current = versions[versions.length - 1]!;
    articles.push({
      id,
      signalId: linked?.id ?? null,
      companyId: company.id,
      origin,
      author: origin === "import_humain" ? rng.pick(AUTHORS) : null,
      status: "publie",
      currentVersion: current.n,
      title: current.title,
      excerpt: current.excerpt,
      angles: [current.title],
      plan: [],
      factChecks,
      approvals: [approval(current.n, "wordpress", publishedAt - 2 * HOUR)],
      wordpress: { remoteId: `wp-${3000 + artN}`, status: "publie", lastSyncAt: iso(publishedAt) },
      createdAt: iso(createdAt),
      updatedAt: iso(publishedAt),
      versions,
      publishedAt: iso(publishedAt),
      createdBy: origin === "kora" ? USERS.lucas.name : USERS.sophie.name,
    });
  }

  /** Article KORA généré à partir d'un signal avec le modèle de texte par défaut. */
  const generated = (
    signal: SignalRecord,
    opts: { id: string; createdAt: number; angle?: string | null },
  ) => {
    const company = signal.companyId ? (companyById.get(signal.companyId) ?? null) : null;
    const dossier = model.generateDossier({
      signal,
      company,
      observations: obsOf(signal),
      angle: opts.angle ?? null,
      rules,
    });
    const factChecks: FactCheck[] = dossier.factChecks.map((f, i) => ({
      ...f,
      id: `fc_${opts.id}_${i + 1}`,
    }));
    const v1 = version(1, {
      ...dossier.draft,
      createdAt: iso(opts.createdAt),
      createdBy: KORA_AUTHOR,
      note: "Brouillon généré par KORA à partir du dossier",
    });
    const rec: ArticleRecord = {
      id: opts.id,
      signalId: signal.id,
      companyId: signal.companyId,
      origin: "kora",
      author: null,
      status: "brouillon",
      currentVersion: 1,
      title: v1.title,
      excerpt: v1.excerpt,
      angles: dossier.angles,
      plan: dossier.plan,
      factChecks,
      approvals: [],
      wordpress: { remoteId: null, status: "aucun", lastSyncAt: null },
      createdAt: iso(opts.createdAt),
      updatedAt: iso(opts.createdAt),
      versions: [v1],
      publishedAt: null,
      createdBy: USERS.lucas.name,
    };
    signal.articleId = opts.id;
    return rec;
  };

  const humanRevision = (
    rec: ArticleRecord,
    at: number,
    by: string,
    title: string,
    note: string,
  ) => {
    const prev = rec.versions[rec.versions.length - 1]!;
    const v = version(prev.n + 1, {
      ...prev,
      title,
      seoTitle: truncate(title, 60),
      createdAt: iso(at),
      createdBy: by,
      note,
    });
    rec.versions.push(v);
    rec.currentVersion = v.n;
    rec.title = v.title;
    rec.excerpt = v.excerpt;
    rec.updatedAt = iso(at);
    rec.approvals = rec.approvals.map((a) =>
      a.valid
        ? { ...a, valid: false, invalidatedAt: iso(at), invalidatedReason: MODIFIED_AFTER_APPROVAL }
        : a,
    );
  };

  const pushDraft = (rec: ArticleRecord, at: number, remoteId: string) => {
    const v = rec.currentVersion;
    const key = idempotencyKey(rec.id, v, "wordpress");
    addPublication({
      idempotencyKey: key,
      articleId: rec.id,
      linkedinPostId: null,
      newsletterId: null,
      channel: "wordpress",
      version: v,
      status: "succes",
      code: null,
      message: `Brouillon WordPress ${remoteId} créé (aucune publication publique au pilote).`,
      attempts: 1,
      remoteId,
      mode: "brouillon_distant",
      at: iso(at),
      by: USERS.claire.name,
    });
    rec.wordpress = { remoteId, status: "brouillon", lastSyncAt: iso(at) };
    addAudit(
      at,
      USERS.claire.name,
      "publication.brouillon_distant",
      "publication",
      rec.id,
      `Brouillon WordPress ${remoteId} (version ${v})`,
    );
  };

  // Pasqal : brouillon WordPress approuvé, « Prêt à publier ».
  const artPasqal = generated(sigPasqal, { id: "art_pasqal", createdAt: nowMs - 26 * HOUR });
  sigPasqal.articleId = null;
  artPasqal.signalId = null;
  artPasqal.companyId = pasqal.id;
  artPasqal.versions[0]!.title =
    "Pasqal : une nouvelle étape pour le quantique européen depuis Grenoble";
  artPasqal.versions[0]!.seoTitle = truncate(artPasqal.versions[0]!.title, 60);
  artPasqal.status = "en_revue";
  artPasqal.approvals.push(approval(1, "wordpress", nowMs - 25 * HOUR));
  addAudit(
    nowMs - 25 * HOUR,
    USERS.claire.name,
    "article.approve",
    "article",
    artPasqal.id,
    "Version 1 approuvée pour WordPress",
  );
  pushDraft(artPasqal, nowMs - 3 * HOUR, "wp-4821");
  humanRevision(
    artPasqal,
    nowMs - 130 * 60_000,
    USERS.lucas.name,
    "Pasqal : 100 M€ pour faire rayonner le quantique européen",
    "Titre resserré",
  );
  addAudit(
    nowMs - 130 * 60_000,
    USERS.lucas.name,
    "article.version",
    "article",
    artPasqal.id,
    "Version 2 — approbation précédente invalidée (contenu modifié après approbation)",
  );
  artPasqal.approvals.push(approval(2, "wordpress", nowMs - 2 * HOUR));
  artPasqal.status = "approuve";
  artPasqal.updatedAt = iso(nowMs - 2 * HOUR);
  addAudit(
    nowMs - 2 * HOUR,
    USERS.claire.name,
    "article.approve",
    "article",
    artPasqal.id,
    "Version 2 approuvée pour WordPress",
  );
  articles.push(artPasqal);

  const tagged = (tag: string) => signalById.get(signalTag.get(tag)!)!;
  const draftOf = (tag: string, id: string, pushedDay: number, revisedBy: string) => {
    const s = tagged(tag);
    const rec = generated(s, { id, createdAt: Date.parse(s.createdAt) + 20 * HOUR });
    rec.status = "en_revue";
    const approvedAt = atDay(pushedDay, 0.3).getTime();
    rec.approvals.push(approval(1, "wordpress", approvedAt));
    pushDraft(rec, approvedAt + HOUR, `wp-${4700 + articles.length}`);
    const shortTitle = truncate(s.title.split(" pour ")[0]!.split(" en ")[0]!, 55);
    humanRevision(
      rec,
      atDay(pushedDay - 1, 0.6).getTime(),
      revisedBy,
      shortTitle,
      "Titre raccourci, relecture en cours",
    );
    return rec;
  };
  articles.push(draftOf("draft2", "art_draft2", 2, USERS.lucas.name));
  articles.push(draftOf("draft3", "art_draft3", 4, USERS.sophie.name));

  const contra = tagged("contra");
  articles.push(
    generated(contra, { id: "art_contra", createdAt: Date.parse(contra.createdAt) + 30 * HOUR }),
  );

  const rejectedSignal = tagged("rejected");
  const artRejected = generated(rejectedSignal, {
    id: "art_rejected",
    createdAt: Date.parse(rejectedSignal.createdAt) + 24 * HOUR,
  });
  artRejected.status = "rejete";
  artRejected.updatedAt = iso(Date.parse(artRejected.createdAt) + 30 * HOUR);
  addAudit(
    Date.parse(artRejected.updatedAt),
    USERS.claire.name,
    "article.reject",
    "article",
    artRejected.id,
    "Motif : angle trop promotionnel, recentrer sur les faits",
  );
  articles.push(artRejected);

  const reviewSignal = tagged("review");
  const artReview = generated(reviewSignal, {
    id: "art_review",
    createdAt: Date.parse(reviewSignal.createdAt) + 26 * HOUR,
  });
  artReview.status = "en_revue";
  articles.push(artReview);
  const blockedAt = atDay(2, 0.5).getTime();
  addPublication({
    idempotencyKey: idempotencyKey(artReview.id, 1, "wordpress"),
    articleId: artReview.id,
    linkedinPostId: null,
    newsletterId: null,
    channel: "wordpress",
    version: 1,
    status: "bloque",
    code: "approval_missing",
    message: "Envoi bloqué : aucune approbation valide pour WordPress sur la version 1.",
    attempts: 1,
    remoteId: null,
    mode: "brouillon_distant",
    at: iso(blockedAt),
    by: USERS.sophie.name,
  });
  addAudit(
    blockedAt,
    USERS.sophie.name,
    "publication.bloque",
    "publication",
    artReview.id,
    "approval_missing — aucune approbation valide",
  );

  /* ---------------------------------------------------------------- */
  /* Imports humains (WF3)                                             */
  /* ---------------------------------------------------------------- */
  const robotics = oldFictional.find((c) => c.name.endsWith("Robotics")) ?? oldFictional[0]!;
  const photon =
    oldFictional.find((c) => c.name.endsWith("Photonics") && c.id !== robotics.id) ??
    oldFictional[1]!;
  const linkFor = (c: CompanyRecord) => ({
    name: c.name,
    href: `/entreprises?id=${c.id}`,
    label: `la fiche ${c.name}`,
  });
  const importText1 = `${robotics.name} : l'industrie du futur se construit à Montbonnot\n\nL'entreprise ${robotics.name} accélère  le déploiement de ses robots collaboratifs dans les PME de la région. Son dirigeant le résume ainsi : "l'automatisation doit rester au service des équipes".\n\nPourquoi ce choix ? Parce que les industriels du territoire manquent de bras ; la robotique collaborative offre une réponse concrète !\n`;
  const importText2 = `Rencontre avec ${photon.name}\n\nDepuis Meylan, ${photon.name} conçoit des composants photoniques pour l'industrie. "Nous voulons produire en Isère" explique sa fondatrice.\n\nQuels projets pour demain ? Une nouvelle ligne pilote  et des recrutements : l'équipe devrait doubler.\n`;
  const imports: ImportRecord[] = [];
  const mkImport = (
    id: string,
    filename: string,
    author: string,
    text: string,
    createdAt: number,
    by: string,
    decide: boolean,
  ) => {
    const bytes = new TextEncoder().encode(text);
    const drafts = buildProposals(text, [linkFor(robotics), linkFor(photon)]);
    const proposals = drafts.map((p, i) => ({
      id: `prop_${id}_${i + 1}`,
      kind: p.kind,
      before: p.before,
      after: p.after,
      rationale: p.rationale,
      decision: decide
        ? i % 3 === 2
          ? ("refusee" as const)
          : ("acceptee" as const)
        : ("en_attente" as const),
      start: p.start,
      end: p.end,
    }));
    const rec: ImportRecord = {
      id,
      filename,
      mime: "text/plain",
      sizeBytes: bytes.length,
      author,
      originalText: text,
      extractedText: text,
      proposals,
      articleId: null,
      createdAt: iso(createdAt),
      createdBy: by,
      bytes,
    };
    imports.push(rec);
    addAudit(createdAt, by, "import.create", "import", id, `${filename} — auteur : ${author}`);
    return rec;
  };
  const imp1 = mkImport(
    "imp_0001",
    `tribune-${slugify(robotics.name)}.txt`,
    "Camille Roux",
    importText1,
    atDay(6, 0.4).getTime(),
    USERS.lucas.name,
    true,
  );
  mkImport(
    "imp_0002",
    `interview-${slugify(photon.name)}.txt`,
    "Julien Morel",
    importText2,
    atDay(1, 0.5).getTime(),
    USERS.sophie.name,
    false,
  );
  {
    const text = applyAccepted(imp1.extractedText, imp1.proposals);
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const at = Date.parse(imp1.createdAt) + 2 * HOUR;
    const accepted = imp1.proposals.filter((p) => p.decision === "acceptee").length;
    const v1 = version(1, {
      title: paragraphs[0] ?? imp1.filename,
      chapo: paragraphs[1] ?? "",
      body: paragraphs.slice(2).join("\n\n"),
      excerpt: truncate(paragraphs[1] ?? "", 200),
      seoTitle: truncate(paragraphs[0] ?? "", 60),
      categories: ["Portrait"],
      tags: ["Industrie", "Robotique"],
      createdAt: iso(at),
      createdBy: USERS.lucas.name,
      note: `Import de ${imp1.filename} — ${accepted} proposition(s) acceptée(s)`,
    });
    articles.push({
      id: "art_import",
      signalId: null,
      companyId: robotics.id,
      origin: "import_humain",
      author: imp1.author,
      status: "brouillon",
      currentVersion: 1,
      title: v1.title,
      excerpt: v1.excerpt,
      angles: [],
      plan: [],
      factChecks: [],
      approvals: [],
      wordpress: { remoteId: null, status: "aucun", lastSyncAt: null },
      createdAt: iso(at),
      updatedAt: iso(at),
      versions: [v1],
      publishedAt: null,
      createdBy: USERS.lucas.name,
    });
    imp1.articleId = "art_import";
    addAudit(
      at,
      USERS.lucas.name,
      "import.convert",
      "import",
      imp1.id,
      "Article art_import créé (auteur nommé conservé : Camille Roux)",
    );
  }

  /* ---------------------------------------------------------------- */
  /* LinkedIn (WF4)                                                    */
  /* ---------------------------------------------------------------- */
  const linkedin: LinkedInPostRecord[] = [];
  let liN = 0;
  const mkPost = (opts: {
    id?: string;
    title: string;
    lead: string;
    company: CompanyRecord | null;
    articleId: string | null;
    signalId: string | null;
    createdAt: number;
    updatedAt?: number;
    status: LinkedInPostRecord["status"];
    variants?: { text: string; hashtags: string[] }[];
  }) => {
    liN += 1;
    const id = opts.id ?? `li_${pad(liN)}`;
    const raw =
      opts.variants ??
      model.linkedinVariants({
        title: opts.title,
        lead: opts.lead,
        companyName: opts.company?.name ?? null,
        themes: opts.company?.themes ?? [],
        tags: [],
      });
    const variants = raw.map((v, i) => ({ id: `${id}_v${i + 1}`, ...v }));
    const updatedAt = opts.updatedAt ?? opts.createdAt + HOUR;
    const post: LinkedInPostRecord = {
      id,
      articleId: opts.articleId,
      signalId: opts.signalId,
      companyId: opts.company?.id ?? null,
      title: opts.title,
      variants,
      selectedVariantId: variants[0]!.id,
      version: 1,
      status: opts.status,
      approval: null,
      createdAt: iso(opts.createdAt),
      updatedAt: iso(updatedAt),
      createdBy: USERS.lucas.name,
    };
    if (opts.status === "approuve" || opts.status === "exporte") {
      post.approval = approval(1, "linkedin", opts.createdAt + 2 * HOUR);
    }
    if (opts.status === "exporte") {
      const at = opts.createdAt + 3 * HOUR;
      addPublication({
        idempotencyKey: idempotencyKey(id, 1, "linkedin"),
        articleId: null,
        linkedinPostId: id,
        newsletterId: null,
        channel: "linkedin",
        version: 1,
        status: "succes",
        code: null,
        message:
          "API LinkedIn non disponible au pilote : contenu exporté pour publication manuelle.",
        attempts: 1,
        remoteId: null,
        mode: "export",
        at: iso(at),
        by: USERS.claire.name,
      });
      post.updatedAt = iso(at);
    }
    linkedin.push(post);
    return post;
  };
  mkPost({
    id: "li_pasqal",
    title: artPasqal.title,
    lead: sigPasqal.summary,
    company: pasqal,
    articleId: artPasqal.id,
    signalId: sigPasqal.id,
    createdAt: nowMs - 5 * HOUR,
    updatedAt: nowMs - 4 * HOUR,
    status: "a_valider",
    variants: [
      {
        text: "🚀 100 M€ pour Pasqal ! Une nouvelle étape majeure pour cette deeptech grenobloise qui fait rayonner l'Europe du quantique.\n\nLa levée de fonds de série B annoncée doit permettre d'industrialiser ses processeurs quantiques à atomes neutres et de renforcer son développement international.\n\n👉 À lire sur le site d'Inovallée.",
        hashtags: ["#Inovallée", "#Grenoble", "#Quantique", "#Deeptech"],
      },
      {
        text: "Pasqal — la deeptech grenobloise annonce une levée de 100 millions d'euros en série B pour industrialiser ses processeurs quantiques à atomes neutres.\n\nUne actualité de l'écosystème Inovallée à suivre de près. 💡",
        hashtags: ["#Inovallée", "#Grenoble", "#Quantique"],
      },
    ],
  });
  const fromSignal = (s: SignalRecord, createdAt: number, status: LinkedInPostRecord["status"]) =>
    mkPost({
      title: s.title,
      lead: s.summary,
      company: s.companyId ? (companyById.get(s.companyId) ?? null) : null,
      articleId: s.articleId,
      signalId: s.id,
      createdAt,
      status,
    });
  fromSignal(sigDeep1, atDay(1, 0.6).getTime(), "a_valider");
  fromSignal(sigIa1, atDay(2, 0.4).getTime(), "a_valider");
  const draft2 = articles.find((a) => a.id === "art_draft2")!;
  mkPost({
    title: draft2.title,
    lead: draft2.versions[draft2.versions.length - 1]!.chapo,
    company: draft2.companyId ? (companyById.get(draft2.companyId) ?? null) : null,
    articleId: draft2.id,
    signalId: draft2.signalId,
    createdAt: atDay(3, 0.5).getTime(),
    status: "a_valider",
  });
  fromSignal(sigTalent, atDay(5, 0.5).getTime(), "a_valider");
  const publishedWithSignal = articles.filter((a) => a.status === "publie" && a.signalId);
  const prevWeekPosts: [number, LinkedInPostRecord["status"]][] = [
    [8, "exporte"],
    [10, "exporte"],
    [12, "approuve"],
    [16, "exporte"],
    [24, "exporte"],
  ];
  prevWeekPosts.forEach(([d, status], i) => {
    const a = publishedWithSignal[i * 3] ?? publishedWithSignal[0]!;
    mkPost({
      title: a.title,
      lead: a.versions[a.versions.length - 1]!.chapo,
      company: a.companyId ? (companyById.get(a.companyId) ?? null) : null,
      articleId: a.id,
      signalId: a.signalId,
      createdAt: atDay(d, 0.45).getTime(),
      status,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Newsletter (WF5)                                                  */
  /* ---------------------------------------------------------------- */
  const newsletters: NewsletterRecord[] = [];
  const NL_TITLE = "L'actualité innovation en Auvergne-Rhône-Alpes";
  const scheduled = dayStart(now, -3).getTime() + 9 * HOUR;
  const windowStart = dayStart(now, 29).getTime();
  const pickFor = (statuses: SignalStatus[], n: number, exclude: Set<string>, inWindow = true) =>
    signals
      .filter(
        (s) =>
          statuses.includes(s.status) &&
          !exclude.has(s.id) &&
          s.companyId &&
          (!inWindow || Date.parse(s.createdAt) >= windowStart),
      )
      .slice(0, n);
  const currentItems = new Set<string>(["sig_pasqal", "sig_verkor", "sig_sinano"]);
  for (const s of [sigDeep1, sigIa1, sigTalent]) currentItems.add(s.id);
  for (const s of pickFor(["traite"], 4, currentItems)) currentItems.add(s.id);
  for (const s of pickFor(["surveille"], 2, currentItems)) currentItems.add(s.id);
  const nlItems = (ids: string[], prefix: string) =>
    ids.map((sid, i) => {
      const s = signalById.get(sid)!;
      return {
        id: `${prefix}_i${i + 1}`,
        signalId: s.id,
        articleId: s.articleId,
        title: s.title,
        summary: model.summarize({ title: s.title, text: s.summary }),
        order: i + 1,
      };
    });
  newsletters.push({
    id: "nl_current",
    title: NL_TITLE,
    weekOf: iso(mondayOf(new Date(scheduled))),
    intro:
      "Levées de fonds, partenariats industriels et distinctions : l'essentiel de l'actualité des entreprises innovantes du territoire.",
    items: nlItems([...currentItems], "nl_current"),
    status: "composition",
    version: 6,
    approval: null,
    scheduledFor: iso(scheduled),
    createdAt: iso(atDay(4, 0.4)),
    updatedAt: iso(atDay(1, 0.7)),
    createdBy: USERS.lucas.name,
  });
  const used = new Set(currentItems);
  [11, 18, 25].forEach((d, k) => {
    const id = `nl_${pad(3 - k, 4)}`;
    const ids = signals
      .filter((s) => s.status === "traite" && !used.has(s.id) && s.companyId)
      .slice(k * 8, k * 8 + 8)
      .map((s) => s.id);
    const createdAt = atDay(d, 0.4).getTime();
    const exportedAt = createdAt + 2 * DAY;
    newsletters.push({
      id,
      title: NL_TITLE,
      weekOf: iso(mondayOf(new Date(exportedAt))),
      intro: "Les temps forts de la semaine dans l'écosystème Inovallée.",
      items: nlItems(ids, id),
      status: "exportee",
      version: 3,
      approval: approval(3, "newsletter", exportedAt - 2 * HOUR),
      scheduledFor: iso(exportedAt + 12 * HOUR),
      createdAt: iso(createdAt),
      updatedAt: iso(exportedAt),
      createdBy: USERS.lucas.name,
    });
    addPublication({
      idempotencyKey: idempotencyKey(id, 3, "newsletter"),
      articleId: null,
      linkedinPostId: null,
      newsletterId: id,
      channel: "newsletter",
      version: 3,
      status: "succes",
      code: null,
      message: "Newsletter exportée (HTML) — aucun envoi effectué par KORA.",
      attempts: 1,
      remoteId: null,
      mode: "export",
      at: iso(exportedAt),
      by: USERS.claire.name,
    });
  });

  /* ---------------------------------------------------------------- */
  /* Propositions Editorial DNA (WF6)                                  */
  /* ---------------------------------------------------------------- */
  const ruleProposals: RuleProposalRecord[] = analyzeCorrections(
    collectCorrections(articles),
    rules,
  ).map((c, i) => ({
    id: `rp_${pad(i + 1, 2)}`,
    kind: c.kind,
    proposedText: c.proposedText,
    ruleId: c.ruleId,
    basedOnCorrections: c.basedOnCorrections,
    rationale: c.rationale,
    status: "proposee",
    createdAt: iso(nowMs - DAY - i * HOUR),
    decidedBy: null,
    signature: c.signature,
  }));

  /* ---------------------------------------------------------------- */
  /* Exécutions de collecte                                            */
  /* ---------------------------------------------------------------- */
  const runs: CollectionRun[] = [];
  const recentObsBySource = new Map<string, number>();
  for (const o of observations) {
    if (o.sourceId && nowMs - Date.parse(o.collectedAt) < DAY) {
      recentObsBySource.set(o.sourceId, (recentObsBySource.get(o.sourceId) ?? 0) + 1);
    }
  }
  for (const s of sources) {
    if (!s.lastRunAt || s.access === "desactivee") continue;
    const started = Date.parse(s.lastRunAt);
    const failed = s.access === "erreur";
    const fresh = recentObsBySource.get(s.id) ?? 0;
    runs.push({
      id: `run_${pad(runs.length + 1)}`,
      sourceId: s.id,
      companyId: s.companyId,
      startedAt: iso(started),
      finishedAt: iso(started + (failed ? 95_000 : rng.int(2, 20) * 1000)),
      status: failed ? "echec" : fresh > 0 ? "succes" : "succes_sans_actualite",
      newObservations: failed ? 0 : fresh,
      errorCode: failed ? s.failureCode : null,
      errorMessage: failed ? s.failureReason : null,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Journal de consommation du mois                                   */
  /* ---------------------------------------------------------------- */
  const usage: UsageEntry[] = [];
  const mStart = monthStart(now).getTime();
  const span = Math.max(60_000, nowMs - mStart);
  const daysElapsed = Math.max(1, Math.ceil(span / DAY));
  const ledger: { kind: UsageEntry["kind"]; units: number; cents: number; label: string }[] = [
    {
      kind: "generation_article",
      units: 14,
      cents: 630,
      label: "Génération de dossiers et brouillons",
    },
    { kind: "generation_linkedin", units: 9, cents: 72, label: "Génération de variantes LinkedIn" },
    { kind: "generation_summary", units: 40, cents: 80, label: "Résumés newsletter" },
    { kind: "search_query", units: 1840, cents: 2208, label: "Recherches web (collecte)" },
    { kind: "observation", units: 3920, cents: 8250, label: "Qualification des observations" },
  ];
  for (const l of ledger) {
    const parts = Math.min(daysElapsed, l.units);
    let unitsLeft = l.units;
    let centsLeft = l.cents;
    for (let i = 0; i < parts; i++) {
      const last = i === parts - 1;
      const u = last ? unitsLeft : Math.floor(l.units / parts);
      const c = last ? centsLeft : Math.floor(l.cents / parts);
      unitsLeft -= u;
      centsLeft -= c;
      usage.push({
        id: `use_${pad(usage.length + 1, 5)}`,
        at: iso(mStart + ((i + 0.5) / parts) * span),
        kind: l.kind,
        units: u,
        costEur: c / 100,
        label: l.label,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Notifications & journal d'audit                                   */
  /* ---------------------------------------------------------------- */
  const failing = failingSources[0]!;
  const failingCompany = companyById.get(failing.companyId)!;
  const notifications: Notification[] = [
    {
      id: "notif_0001",
      at: iso(minutesAgo(25)),
      kind: "signal",
      title: "Nouveau sujet prioritaire : Pasqal",
      body: "Pasqal lève 100 M€ pour accélérer l'informatique quantique — score 9.2/10.",
      read: false,
      link: "/signaux?id=sig_pasqal",
    },
    {
      id: "notif_0002",
      at: iso(nowMs - 2 * HOUR),
      kind: "approbation",
      title: "Brouillon approuvé : Pasqal",
      body: "Claire Dubois a approuvé la version 2 pour WordPress.",
      read: false,
      link: "/articles?id=art_pasqal",
    },
    {
      id: "notif_0003",
      at: iso(nowMs - 4 * HOUR),
      kind: "publication",
      title: "Post LinkedIn à valider",
      body: "Le post consacré à Pasqal attend une validation.",
      read: false,
      link: "/linkedin?id=li_pasqal",
    },
    {
      id: "notif_0004",
      at: failing.lastRunAt ?? iso(nowMs - 2 * HOUR),
      kind: "erreur_source",
      title: `Source en échec : ${failingCompany.name}`,
      body: `${failing.failureCode} — ${failing.failureReason}`,
      read: false,
      link: `/veille?source=${failing.id}`,
    },
    {
      id: "notif_0005",
      at: iso(nowMs - 2 * DAY),
      kind: "quota",
      title: "Budget API : 75 % consommé",
      body: "Le seuil d'alerte de 80 % n'est pas encore atteint. Les appels payants restent actifs.",
      read: true,
      link: "/parametres",
    },
  ];

  addAudit(
    Date.parse(grid.createdAt),
    USERS.sophie.name,
    "grid.create",
    "grid",
    "grid_v1",
    "Grille v1 : importance 30, nouveauté 20, territoire 20, lecteurs 20, diffusion 10",
  );
  for (const r of rules)
    addAudit(Date.parse(r.updatedAt), USERS.sophie.name, "rule.create", "rule", r.id, r.text);
  addAudit(
    Date.parse(fictional[recentIdx.values().next().value ?? 0]!.createdAt),
    USERS.lucas.name,
    "company.create",
    "company",
    fictional[recentIdx.values().next().value ?? 0]!.id,
    "Ajout au registre",
  );
  failingSources.forEach((s) =>
    addAudit(
      Date.parse(s.lastRunAt ?? iso(nowMs)),
      "KORA",
      "collect.echec",
      "source",
      s.id,
      `${s.failureCode} après 3 essais`,
    ),
  );
  signals
    .filter((s) => s.status === "rejete" && Date.parse(s.createdAt) > nowMs - 7 * DAY)
    .forEach((s) =>
      addAudit(
        Date.parse(s.updatedAt),
        USERS.lucas.name,
        "signal.reject",
        "signal",
        s.id,
        `Motif : ${s.statusReason}`,
      ),
    );
  linkedin
    .filter((p) => p.status === "exporte")
    .forEach((p) =>
      addAudit(
        Date.parse(p.updatedAt),
        USERS.claire.name,
        "publication.export",
        "linkedin",
        p.id,
        "Export LinkedIn (API non disponible)",
      ),
    );
  newsletters
    .filter((n) => n.status === "exportee")
    .forEach((n) =>
      addAudit(
        Date.parse(n.updatedAt),
        USERS.claire.name,
        "publication.export",
        "newsletter",
        n.id,
        `Export HTML version ${n.version}`,
      ),
    );
  audit.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const settings: Settings = {
    workspaceId: WORKSPACE_ID,
    quotaLimits: { ...DEFAULT_LIMITS },
    paidCallsSuspended: false,
    suspendedMonth: null,
    reservedEur: 0,
    notifiedAlerts: [],
    storageBaseGb: 2.4,
  };

  return {
    settings,
    users,
    companies,
    sources,
    runs,
    observations,
    signals,
    grids: [grid],
    articles,
    publications,
    imports,
    linkedin,
    newsletters,
    rules,
    examples,
    ruleProposals,
    usage,
    audit,
    notifications,
  };
}

export type { Signal };
