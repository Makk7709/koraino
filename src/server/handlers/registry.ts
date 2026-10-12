import type { Company, Source } from "@/lib/api/types";
import type { Handler } from "../context";
import { assertCan } from "../domain/permissions";
import { checkHost, validateSourceUrl } from "../domain/security";
import { initials, normalize } from "../domain/text";
import { conflict, json, noContent, notFound, unprocessable } from "../http";
import { BRAND_COLORS } from "../store/catalog";
import { hash32 } from "../store/prng";
import type { CompanyRecord, SourceRecord } from "../store/records";
import { audit } from "../services/journal";
import { assertQuota } from "../services/usage";
import { companyDto, loadCompanyCounters, toCompany, toSource } from "../services/view";
import { defined, parse, schemas } from "../validation";

function normalizeDomain(raw: string): string {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) {
    throw unprocessable("domain_invalid", `Domaine officiel invalide : « ${raw} ».`);
  }
  const reason = checkHost(d);
  if (reason) throw unprocessable("url_refused", `Domaine refusé : ${reason}.`);
  return d;
}

function assertSafeUrl(url: string): string {
  const check = validateSourceUrl(url);
  if (!check.ok)
    throw unprocessable("url_refused", `URL de source refusée : ${check.reason}.`, { url });
  return check.url.toString();
}

async function getCompanyOr404(ctx: Parameters<Handler>[0], id: string): Promise<CompanyRecord> {
  const c = await ctx.repo.companies.get(id);
  if (!c) throw notFound("Entreprise introuvable.");
  return c;
}

/* ------------------------------------------------------------------ */
/* Entreprises                                                         */
/* ------------------------------------------------------------------ */

export const listCompanies: Handler = async (ctx) => {
  const q = normalize(ctx.query.get("q") ?? "");
  const theme = ctx.query.get("theme");
  const [companies, counters] = await Promise.all([
    ctx.repo.companies.list(),
    loadCompanyCounters(ctx.repo),
  ]);
  const out: Company[] = companies
    .filter(
      (c) => !theme || theme === "tous" || c.themes.includes(theme as Company["themes"][number]),
    )
    .filter(
      (c) =>
        !q ||
        normalize([c.name, ...c.aliases, c.domain, c.sector, c.territory].join(" ")).includes(q),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((c) => toCompany(c, counters));
  return json(out);
};

export const getCompany: Handler = async (ctx) => {
  const c = await getCompanyOr404(ctx, ctx.params["id"]!);
  const sources = (await ctx.repo.sources.list()).filter((s) => s.companyId === c.id).map(toSource);
  return json({ ...(await companyDto(ctx.repo, c)), sources });
};

async function assertUniqueCompany(
  ctx: Parameters<Handler>[0],
  name: string,
  domain: string,
  exceptId?: string,
) {
  const all = await ctx.repo.companies.list();
  const clash = all.find(
    (c) => c.id !== exceptId && (normalize(c.name) === normalize(name) || c.domain === domain),
  );
  if (clash) {
    throw conflict(
      "duplicate_company",
      `Une entreprise du registre utilise déjà ce nom ou ce domaine (${clash.name}).`,
      {
        companyId: clash.id,
      },
    );
  }
}

export const createCompany: Handler = async (ctx) => {
  assertCan(ctx.user, "registry.write");
  const input = parse(schemas.company, ctx.body);
  const domain = normalizeDomain(input.domain);
  await assertQuota(ctx.repo, ctx.now, "companies");
  await assertUniqueCompany(ctx, input.name, domain);
  const color = BRAND_COLORS[hash32(input.name) % BRAND_COLORS.length]!;
  let id = `co_${normalize(input.name).replace(/\s+/g, "-").slice(0, 40)}`;
  if (await ctx.repo.companies.get(id)) id = ctx.repo.nextId("co");
  const rec: CompanyRecord = {
    id,
    name: input.name,
    aliases: [...new Set(input.aliases ?? [])],
    domain,
    sector: input.sector,
    territory: input.territory || "Grenoble",
    priority: input.priority ?? "normale",
    themes: [...new Set(input.themes ?? [])],
    brand: { initials: initials(input.name), bg: color.bg, fg: color.fg },
    createdAt: ctx.now.toISOString(),
    fictional: false,
  };
  await ctx.repo.companies.insert(rec);
  await audit(
    ctx,
    "company.create",
    "company",
    rec.id,
    `Ajout au registre : ${rec.name} (${rec.domain})`,
  );
  return json(await companyDto(ctx.repo, rec), { status: 201 });
};

export const updateCompany: Handler = async (ctx) => {
  assertCan(ctx.user, "registry.write");
  const rec = await getCompanyOr404(ctx, ctx.params["id"]!);
  const input = defined(parse(schemas.company.partial(), ctx.body));
  const next: CompanyRecord = { ...rec };
  if (input.name !== undefined) next.name = input.name;
  if (input.domain !== undefined) next.domain = normalizeDomain(input.domain);
  if (input.sector !== undefined) next.sector = input.sector;
  if (input.territory !== undefined) next.territory = input.territory || rec.territory;
  if (input.priority !== undefined) next.priority = input.priority;
  if (input.aliases !== undefined) next.aliases = [...new Set(input.aliases)];
  if (input.themes !== undefined) next.themes = [...new Set(input.themes)];
  if (next.name !== rec.name) next.brand = { ...rec.brand, initials: initials(next.name) };
  await assertUniqueCompany(ctx, next.name, next.domain, rec.id);
  await ctx.repo.companies.update(next);
  const changed = Object.keys(input).join(", ") || "aucun champ";
  await audit(ctx, "company.update", "company", rec.id, `Champs modifiés : ${changed}`);
  return json(await companyDto(ctx.repo, next));
};

/** Suppression : sources retirées, historique conservé (signaux et contenus détachés). */
export const deleteCompany: Handler = async (ctx) => {
  assertCan(ctx.user, "registry.delete");
  const rec = await getCompanyOr404(ctx, ctx.params["id"]!);
  const { repo } = ctx;
  for (const s of await repo.sources.list())
    if (s.companyId === rec.id) await repo.sources.remove(s.id);
  for (const s of await repo.signals.list()) {
    if (s.companyId !== rec.id) continue;
    await repo.signals.update({
      ...s,
      companyId: null,
      review: {
        kind: "homonymie",
        note: `Entreprise « ${rec.name} » retirée du registre : à rattacher`,
      },
      updatedAt: ctx.now.toISOString(),
    });
  }
  for (const o of await repo.observations.list()) {
    if (o.companyId === rec.id) await repo.observations.update({ ...o, companyId: null });
  }
  for (const a of await repo.articles.list())
    if (a.companyId === rec.id) await repo.articles.update({ ...a, companyId: null });
  for (const p of await repo.linkedin.list())
    if (p.companyId === rec.id) await repo.linkedin.update({ ...p, companyId: null });
  await repo.companies.remove(rec.id);
  await audit(ctx, "company.delete", "company", rec.id, `Retrait du registre : ${rec.name}`);
  return noContent();
};

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export const listSources: Handler = async (ctx) => {
  const companyId = ctx.query.get("companyId");
  const access = ctx.query.get("access");
  const list = (await ctx.repo.sources.list())
    .filter((s) => !companyId || s.companyId === companyId)
    .filter((s) => !access || access === "tous" || s.access === access)
    .sort(
      (a, b) => Date.parse(b.lastRunAt ?? b.createdAt) - Date.parse(a.lastRunAt ?? a.createdAt),
    );
  return json(list.map(toSource));
};

export const createSource: Handler = async (ctx) => {
  assertCan(ctx.user, "registry.write");
  const input = parse(schemas.source, ctx.body);
  const company = await getCompanyOr404(ctx, input.companyId);
  const url = assertSafeUrl(input.url);
  await assertQuota(ctx.repo, ctx.now, "sources");
  const existing = (await ctx.repo.sources.list()).find(
    (s) => s.companyId === company.id && s.url === url,
  );
  if (existing)
    throw conflict("duplicate_source", "Cette URL est déjà suivie pour cette entreprise.", {
      sourceId: existing.id,
    });
  const rec: SourceRecord = {
    id: ctx.repo.nextId("src"),
    companyId: company.id,
    type: input.type,
    label: input.label,
    url,
    frequency: input.frequency ?? (input.type === "recherche_web" ? "hebdomadaire" : "quotidienne"),
    access: "en_attente",
    lastRunAt: null,
    lastSuccessAt: null,
    failureCode: null,
    failureReason: null,
    attempts: 0,
    createdAt: ctx.now.toISOString(),
    runCount: 0,
    simulation: { mode: "auto" },
  };
  await ctx.repo.sources.insert(rec);
  await audit(
    ctx,
    "source.create",
    "source",
    rec.id,
    `${company.name} — ${rec.label} (${rec.url})`,
  );
  return json(toSource(rec), { status: 201 });
};

export const updateSource: Handler = async (ctx) => {
  assertCan(ctx.user, "registry.write");
  const rec = await ctx.repo.sources.get(ctx.params["id"]!);
  if (!rec) throw notFound("Source introuvable.");
  const input = defined(parse(schemas.sourcePatch, ctx.body));
  const next: SourceRecord = { ...rec };
  if (input.companyId !== undefined)
    next.companyId = (await getCompanyOr404(ctx, input.companyId)).id;
  if (input.url !== undefined) next.url = assertSafeUrl(input.url);
  if (input.type !== undefined) next.type = input.type;
  if (input.label !== undefined) next.label = input.label;
  if (input.frequency !== undefined) next.frequency = input.frequency;
  if (input.access !== undefined) {
    if (input.access === "erreur") {
      throw unprocessable(
        "invalid_access",
        "L'état « en échec » est réservé au résultat d'une collecte.",
      );
    }
    next.access = input.access;
    if (input.access === "ok" || input.access === "en_attente") {
      next.failureCode = null;
      next.failureReason = null;
      next.attempts = 0;
    }
  }
  if (input.url !== undefined && input.url !== rec.url) {
    next.access = next.access === "desactivee" ? "desactivee" : "en_attente";
    next.failureCode = null;
    next.failureReason = null;
    next.attempts = 0;
  }
  await ctx.repo.sources.update(next);
  await audit(
    ctx,
    "source.update",
    "source",
    rec.id,
    `Champs modifiés : ${Object.keys(input).join(", ")}`,
  );
  return json(toSource(next) satisfies Source);
};

export const deleteSource: Handler = async (ctx) => {
  assertCan(ctx.user, "registry.write");
  const rec = await ctx.repo.sources.get(ctx.params["id"]!);
  if (!rec) throw notFound("Source introuvable.");
  for (const o of await ctx.repo.observations.list()) {
    if (o.sourceId === rec.id) await ctx.repo.observations.update({ ...o, sourceId: null });
  }
  await ctx.repo.sources.remove(rec.id);
  await audit(ctx, "source.delete", "source", rec.id, `${rec.label} (${rec.url})`);
  return noContent();
};
