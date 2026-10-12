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
  collect(input: CollectInput): CollectResult | Promise<CollectResult>;
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

/** Lien Google News (flux RSS) pour une recherche par nom d'entreprise. */
export function googleNewsUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`"${query}"`)}&hl=fr&gl=FR&ceid=FR:fr`;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]!) : null;
}

function brandFor(name: string): Outlet["brand"] {
  const letters = name.replace(/[^A-Za-zÀ-ÿ ]/g, "").split(/\s+/).filter(Boolean);
  const initials = (letters.map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  return { initials, bg: "oklch(0.92 0.02 250)", fg: "oklch(0.3 0.05 250)" };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Analyse un flux RSS 2.0 ou Atom. */
export function parseFeed(xml: string, fallbackOutlet: Outlet): RawItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items: RawItem[] = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    let link = tag(b, "link");
    if (!link) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? null;
    if (!title || !link) continue;
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated");
    const parsed = date ? new Date(date) : null;
    const desc = tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "";
    const sourceName = tag(b, "source");
    const sourceUrl = b.match(/<source[^>]*url="([^"]+)"/i)?.[1];
    const outlet: Outlet = sourceName
      ? { name: sourceName, domain: hostOf(sourceUrl ?? link), brand: brandFor(sourceName) }
      : fallbackOutlet;
    let cleanTitle = title;
    if (sourceName && cleanTitle.endsWith(` - ${sourceName}`))
      cleanTitle = cleanTitle.slice(0, -(sourceName.length + 3));
    items.push({
      url: link,
      title: cleanTitle,
      html: `<article><h1>${cleanTitle}</h1><p>${desc}</p></article>`,
      outlet,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      eventDate: null,
    });
  }
  return items;
}

/**
 * Collecte réelle : lit le flux RSS/Atom de la source (ou le découvre depuis la page HTML),
 * et interroge Google News pour les sources « recherche web » / « actualités ».
 */
export class RealCollector implements Collector {
  readonly name = "collecteur-rss-google-v1";

  async collect(input: CollectInput): Promise<CollectResult> {
    const { source, company } = input;
    const useGoogle =
      source.type === "recherche_web" ||
      (source.type === "actualites" && !/rss|feed|atom|xml/i.test(source.url));
    const url =
      useGoogle && !source.url.includes("news.google.com")
        ? googleNewsUrl(company?.name ?? source.label)
        : source.url;
    const fallback: Outlet = company
      ? { name: company.name, domain: company.domain, brand: company.brand }
      : { name: hostOf(url), domain: hostOf(url), brand: brandFor(hostOf(url)) };
    try {
      let text = await this.fetchText(url);
      if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text)) {
        const alt = text.match(
          /<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/i,
        )?.[0];
        const href = alt?.match(/href="([^"]+)"/i)?.[1];
        if (!href) return { ok: true, items: [] };
        text = await this.fetchText(new URL(href, url).toString());
      }
      let items = parseFeed(text, fallback);
      if (company && !useGoogle) {
        // Flux généraliste : ne garder que ce qui mentionne l'entreprise ou un alias,
        // sauf si le flux est celui de l'entreprise elle-même.
        const own = hostOf(url).endsWith(company.domain);
        if (!own) {
          const names = [company.name, ...company.aliases].map((n) => n.toLowerCase());
          items = items.filter((i) =>
            names.some((n) => `${i.title} ${i.html}`.toLowerCase().includes(n)),
          );
        }
      }
      const cutoff = input.now.getTime() - 30 * 86_400_000;
      items = items.filter((i) => !i.publishedAt || new Date(i.publishedAt).getTime() >= cutoff);
      return { ok: true, items };
    } catch (e) {
      const err = e as Error & { code?: string };
      return {
        ok: false,
        code: err.code ?? "NETWORK",
        reason: err.message || "Erreur réseau",
        transient: err.code !== "HTTP_403" && err.code !== "HTTP_404",
      };
    }
  }

  private async fetchText(url: string): Promise<string> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; KORA-Newsroom/1.0)",
          accept: "application/rss+xml, application/atom+xml, text/xml, text/html;q=0.8",
        },
      });
      if (!res.ok) {
        const e = new Error(`Réponse HTTP ${res.status}`) as Error & { code: string };
        e.code = `HTTP_${res.status}`;
        throw e;
      }
      return await res.text();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        const err = new Error("Délai de réponse dépassé") as Error & { code: string };
        err.code = "TIMEOUT";
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
}
