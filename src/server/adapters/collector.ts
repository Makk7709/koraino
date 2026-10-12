import type { Category, Outlet } from "@/lib/api/types";
import { slugify } from "../domain/text";
import {
  CITIES,
  COUNTRIES,
  EVENT_TEMPLATES,
  LOCAL_OUTLETS,
  NAME_SUFFIXES,
  NATIONAL_MEDIA,
  OUTLETS,
  PRIZES,
} from "../store/catalog";
import { hash32 } from "../store/prng";
import type { CompanyRecord, SourceRecord } from "../store/records";

/** Élément brut renvoyé par un collecteur (HTML non fiable, nettoyé ensuite). */
export interface RawItem {
  url: string;
  title: string;
  html: string;
  outlet: Outlet;
  publishedAt: string | null;
  eventDate: string | null;
}

export type CollectResult =
  { ok: true; items: RawItem[] } | { ok: false; code: string; reason: string; transient: boolean };

export interface CollectInput {
  source: SourceRecord;
  company: CompanyRecord | null;
  /** Essai en cours (1 à 3). */
  attempt: number;
  now: Date;
  /** Derniers événements connus de l'entreprise (pour simuler les reprises). */
  knownEvents: { title: string; excerpt: string }[];
}

export interface Collector {
  readonly name: string;
  collect(input: CollectInput): CollectResult;
}

const CATEGORIES: Category[] = [
  "financement",
  "partenariat",
  "innovation",
  "produit",
  "contrat",
  "recrutement",
  "croissance",
  "international",
  "distinction",
  "brevet",
  "recherche",
  "acquisition",
];

/**
 * Collecte simulée et déterministe : selon la source et son numéro d'exécution, elle renvoie
 * de nouvelles publications, aucune actualité, ou un échec (code HTTP_403, TIMEOUT…).
 * Aucune actualité n'est inventée sur une entreprise réelle : seules les entreprises fictives
 * du jeu de démonstration reçoivent des événements générés.
 */
export class SimulatedCollector implements Collector {
  readonly name = "collecteur-simule-v1";

  collect(input: CollectInput): CollectResult {
    const { source, attempt } = input;
    const sim = source.simulation;
    if (sim.mode === "fail")
      return { ok: false, code: sim.code, reason: sim.reason, transient: false };
    if (sim.mode === "empty") return { ok: true, items: [] };
    if (sim.mode === "transient" && attempt === 1) {
      return { ok: false, code: "TIMEOUT", reason: "Délai de réponse dépassé", transient: true };
    }
    if (sim.mode === "news") return { ok: true, items: this.generate(input, true) };

    const h = hash32(`${source.id}:${source.runCount}`) % 100;
    if (h >= 22 && h < 26 && attempt === 1) {
      return { ok: false, code: "TIMEOUT", reason: "Délai de réponse dépassé", transient: true };
    }
    if (h < 22) return { ok: true, items: this.generate(input, false) };
    return { ok: true, items: [] };
  }

  private generate(input: CollectInput, force: boolean): RawItem[] {
    const { company, source, now } = input;
    if (!company) return [];
    const seed = hash32(`${source.id}:${source.runCount}:news`);
    const at = new Date(now.getTime() - ((seed % 300) + 30) * 60_000).toISOString();

    const latest = input.knownEvents[0];
    if (!company.fictional) {
      if (!latest) return [];
      return [
        {
          url: `https://www.${OUTLETS.dauphine.domain}/economie/${slugify(latest.title)}-${seed % 100000}`,
          title: latest.title,
          html: `<article><p>${latest.excerpt}</p></article>`,
          outlet: OUTLETS.dauphine,
          publishedAt: at,
          eventDate: null,
        },
      ];
    }

    if (latest && seed % 3 === 0 && !force) {
      const outlet = LOCAL_OUTLETS[seed % LOCAL_OUTLETS.length]!;
      return [
        {
          url: `https://www.${outlet.domain}/actualite/${slugify(latest.title)}-${seed % 100000}`,
          title: latest.title,
          html: `<div class="article"><p>${latest.excerpt}</p></div>`,
          outlet,
          publishedAt: at,
          eventDate: null,
        },
      ];
    }

    const spec = NAME_SUFFIXES.find((s) => company.name.endsWith(s.s)) ?? NAME_SUFFIXES[0]!;
    const category = CATEGORIES[seed % CATEGORIES.length]!;
    const text = EVENT_TEMPLATES[category]({
      company: company.name,
      partner: "un industriel européen",
      amount: 3 + (seed % 25),
      count: 10 + (seed % 40),
      topic: spec.topic,
      product: spec.products[seed % spec.products.length]!,
      country: COUNTRIES[seed % COUNTRIES.length]!,
      city: CITIES[seed % CITIES.length]!,
      prize: PRIZES[seed % PRIZES.length]!,
    });
    const fromCompany =
      source.type === "site_officiel" || source.type === "communiques" || source.type === "rss";
    const outlet: Outlet = fromCompany
      ? { name: company.name, domain: company.domain, brand: company.brand }
      : (seed % 2 === 0 ? LOCAL_OUTLETS : NATIONAL_MEDIA)[seed % 3]!;
    const unknownDate = seed % 9 === 0;
    return [
      {
        url: fromCompany
          ? `https://www.${company.domain}/actualites/${slugify(text.title)}`
          : `https://www.${outlet.domain}/actualite/${slugify(text.title)}-${seed % 100000}`,
        title: text.title,
        html: `<article><h1>${text.title}</h1><p>${fromCompany ? text.communique : text.media}</p></article>`,
        outlet,
        publishedAt: unknownDate ? null : at,
        eventDate: null,
      },
    ];
  }
}
