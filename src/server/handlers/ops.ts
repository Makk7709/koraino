import type { ExportEntity, SearchResult } from "@/lib/api/types";
import type { Ctx, Handler } from "../context";
import { toCsv } from "../domain/csv";
import { computeDashboard } from "../domain/dashboard";
import { isoDay, parseDate } from "../domain/dates";
import { normalize } from "../domain/text";
import { badRequest, fileResponse, json, notFound } from "../http";
import { WORKSPACE_ID } from "../store/seed";
import { usageSnapshot } from "../services/usage";
import {
  loadCompanyCounters,
  loadSignalView,
  toCompany,
  toSignal,
  toSource,
} from "../services/view";

/* ------------------------------------------------------------------ */
/* Dashboard, recherche, consommation, journal                         */
/* ------------------------------------------------------------------ */

export const getDashboard: Handler = async (ctx) => {
  const fromRaw = ctx.query.get("from");
  const toRaw = ctx.query.get("to");
  const from = fromRaw ? parseDate(fromRaw) : null;
  const to = toRaw ? parseDate(toRaw) : null;
  if ((fromRaw && !from) || (toRaw && !to))
    throw badRequest("invalid_period", "Dates de période invalides (ISO 8601 attendu).");
  if (from && to && from > to)
    throw badRequest("invalid_period", "La date de début doit précéder la date de fin.");
  const { repo, now } = ctx;
  const [companies, signals, articles, linkedin, newsletters, sources, usage] = await Promise.all([
    repo.companies.list(),
    repo.signals.list(),
    repo.articles.list(),
    repo.linkedin.list(),
    repo.newsletters.list(),
    repo.sources.list(),
    usageSnapshot(repo, now),
  ]);
  return json(
    computeDashboard({
      now,
      from,
      to,
      companies,
      signals,
      articles,
      linkedin,
      newsletters,
      sources,
      paidCallsSuspended: usage.paidCallsSuspended,
    }),
  );
};

export const search: Handler = async (ctx) => {
  const q = normalize(ctx.query.get("q") ?? "");
  if (q.length < 2) return json([]);
  const { repo } = ctx;
  const [companies, signals, articles, sources] = await Promise.all([
    repo.companies.list(),
    repo.signals.list(),
    repo.articles.list(),
    repo.sources.list(),
  ]);
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const hit = (...parts: string[]) => normalize(parts.join(" ")).includes(q);
  const out: SearchResult[] = [
    ...companies
      .filter((c) => hit(c.name, ...c.aliases, c.domain, c.sector))
      .slice(0, 6)
      .map((c) => ({
        kind: "company" as const,
        id: c.id,
        title: c.name,
        subtitle: `${c.sector} · ${c.territory}`,
        link: `/entreprises?id=${c.id}`,
      })),
    ...signals
      .filter((s) => hit(s.title, names.get(s.companyId ?? "") ?? ""))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 6)
      .map((s) => ({
        kind: "signal" as const,
        id: s.id,
        title: s.title,
        subtitle: `${names.get(s.companyId ?? "") ?? "Entreprise à rattacher"} · score ${(s.score.total / 10).toFixed(1)}/10`,
        link: `/signaux?id=${s.id}`,
      })),
    ...articles
      .filter((a) => hit(a.title, a.author ?? ""))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 6)
      .map((a) => ({
        kind: "article" as const,
        id: a.id,
        title: a.title,
        subtitle: `${a.origin === "import_humain" ? `Article humain · ${a.author ?? ""}` : "Article KORA"} · ${a.status}`,
        link: `/articles?id=${a.id}`,
      })),
    ...sources
      .filter((s) => hit(s.label, s.url))
      .slice(0, 4)
      .map((s) => ({
        kind: "source" as const,
        id: s.id,
        title: s.label,
        subtitle: `${names.get(s.companyId) ?? ""} · ${s.url}`,
        link: `/veille?source=${s.id}`,
      })),
  ];
  return json(out.slice(0, 20));
};

export const getUsage: Handler = async (ctx) => json(await usageSnapshot(ctx.repo, ctx.now));

export const listAudit: Handler = async (ctx) => {
  const entity = ctx.query.get("entity");
  const entityId = ctx.query.get("entityId");
  const rawLimit = Number(ctx.query.get("limit") ?? "100");
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(1000, Math.trunc(rawLimit))) : 100;
  const list = (await ctx.repo.audit.list())
    .filter((e) => !entity || entity === "tous" || e.entity === entity)
    .filter((e) => !entityId || e.entityId === entityId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))
    .slice(0, limit);
  return json(list);
};

/* ------------------------------------------------------------------ */
/* Exports CSV / JSON et manifeste (réversibilité)                     */
/* ------------------------------------------------------------------ */

interface Table {
  columns: string[];
  rows: Record<string, unknown>[];
}

const ENTITIES: ExportEntity[] = [
  "companies",
  "sources",
  "signals",
  "observations",
  "scores",
  "rules",
  "decisions",
  "articles",
  "audit",
];

const ENTITY_LABEL: Record<ExportEntity, string> = {
  companies: "Entreprises du registre",
  sources: "Sources configurées",
  signals: "Signaux",
  observations: "Observations collectées",
  scores: "Scores et motifs",
  rules: "Référentiel éditorial",
  decisions: "Décisions (approbations et envois)",
  articles: "Articles",
  audit: "Journal d'audit",
};

async function buildTable(ctx: Ctx, entity: ExportEntity): Promise<Table> {
  const { repo } = ctx;
  switch (entity) {
    case "companies": {
      const counters = await loadCompanyCounters(repo);
      const rows = (await repo.companies.list()).map((c) => {
        const { brand: _b, ...dto } = toCompany(c, counters);
        return dto;
      });
      return {
        columns: [
          "id",
          "name",
          "aliases",
          "domain",
          "sector",
          "territory",
          "priority",
          "themes",
          "createdAt",
          "sourceCount",
          "failingSourceCount",
          "signalCount",
        ],
        rows,
      };
    }
    case "sources":
      return {
        columns: [
          "id",
          "companyId",
          "type",
          "label",
          "url",
          "frequency",
          "access",
          "lastRunAt",
          "lastSuccessAt",
          "failureCode",
          "failureReason",
          "attempts",
        ],
        rows: (await repo.sources.list()).map((s) => ({ ...toSource(s) })),
      };
    case "signals": {
      const view = await loadSignalView(repo, ctx.now);
      const rows = (await repo.signals.list()).map((rec) => {
        const s = toSignal(rec, view);
        return {
          id: s.id,
          companyId: s.companyId,
          title: s.title,
          category: s.category,
          themes: s.themes,
          status: s.status,
          statusReason: s.statusReason,
          score: s.score.total,
          gridVersion: s.score.gridVersion,
          evidence: s.evidence.level,
          matchConfidence: s.matchConfidence,
          observations: s.observationIds.length,
          primaryOutlet: s.primaryOutlet.name,
          primaryUrl: s.primaryUrl,
          publishedAt: s.publishedAt,
          eventDate: s.eventDate,
          collectedAt: s.collectedAt,
          review: s.review?.kind ?? null,
          inNewsletter: s.inNewsletter,
          articleId: s.articleId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });
      return { columns: Object.keys(rows[0] ?? { id: "" }), rows };
    }
    case "observations":
      return {
        columns: [
          "id",
          "signalId",
          "sourceId",
          "companyId",
          "outlet",
          "outletDomain",
          "url",
          "title",
          "excerpt",
          "collectedAt",
          "publishedAt",
          "eventDate",
          "matchConfidence",
          "isSyndicated",
          "via",
        ],
        rows: (await repo.observations.list()).map((o) => ({
          ...o,
          via: o.via ?? "",
          outlet: o.outlet.name,
          outletDomain: o.outlet.domain,
        })),
      };
    case "scores":
      return {
        columns: [
          "signalId",
          "status",
          "gridVersion",
          "total",
          "importance",
          "nouveaute",
          "territoire",
          "lecteurs",
          "diffusion",
          "reasonImportance",
          "reasonNouveaute",
          "reasonTerritoire",
          "reasonLecteurs",
          "reasonDiffusion",
        ],
        rows: (await repo.signals.list()).map((s) => ({
          signalId: s.id,
          status: s.status,
          gridVersion: s.score.gridVersion,
          total: s.score.total,
          ...s.score.subScores,
          reasonImportance: s.score.reasons.importance,
          reasonNouveaute: s.score.reasons.nouveaute,
          reasonTerritoire: s.score.reasons.territoire,
          reasonLecteurs: s.score.reasons.lecteurs,
          reasonDiffusion: s.score.reasons.diffusion,
        })),
      };
    case "rules":
      return {
        columns: ["id", "kind", "text", "active", "version", "updatedAt", "updatedBy"],
        rows: (await repo.rules.list()).map(({ history: _h, ...r }) => r),
      };
    case "decisions": {
      const [articles, posts, editions, publications] = await Promise.all([
        repo.articles.list(),
        repo.linkedin.list(),
        repo.newsletters.list(),
        repo.publications.list(),
      ]);
      const approvals = [
        ...articles.flatMap((a) =>
          a.approvals.map((ap) => ({ content: "article", contentId: a.id, ap })),
        ),
        ...posts.flatMap((p) =>
          p.approval ? [{ content: "linkedin", contentId: p.id, ap: p.approval }] : [],
        ),
        ...editions.flatMap((n) =>
          n.approval ? [{ content: "newsletter", contentId: n.id, ap: n.approval }] : [],
        ),
      ].map(({ content, contentId, ap }) => ({
        type: "approbation",
        id: ap.id,
        content,
        contentId,
        channel: ap.channel,
        version: ap.version,
        by: ap.approvedBy,
        at: ap.approvedAt,
        status: ap.valid ? "valide" : "invalidee",
        detail: ap.invalidatedReason ?? (ap.scheduledAt ? `Programmée le ${ap.scheduledAt}` : ""),
        idempotencyKey: "",
      }));
      const sends = publications.map((p) => ({
        type: "envoi",
        id: p.id,
        content: p.articleId ? "article" : p.linkedinPostId ? "linkedin" : "newsletter",
        contentId: p.articleId ?? p.linkedinPostId ?? p.newsletterId ?? "",
        channel: p.channel,
        version: p.version,
        by: p.by,
        at: p.at,
        status: p.status,
        detail: p.message,
        idempotencyKey: p.idempotencyKey,
      }));
      const rows = [...approvals, ...sends].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return {
        columns: [
          "type",
          "id",
          "content",
          "contentId",
          "channel",
          "version",
          "by",
          "at",
          "status",
          "detail",
          "idempotencyKey",
        ],
        rows,
      };
    }
    case "articles":
      return {
        columns: [
          "id",
          "signalId",
          "companyId",
          "origin",
          "author",
          "status",
          "currentVersion",
          "versions",
          "title",
          "wordpressRemoteId",
          "wordpressStatus",
          "createdAt",
          "updatedAt",
          "publishedAt",
        ],
        rows: (await repo.articles.list()).map((a) => ({
          id: a.id,
          signalId: a.signalId,
          companyId: a.companyId,
          origin: a.origin,
          author: a.author,
          status: a.status,
          currentVersion: a.currentVersion,
          versions: a.versions.length,
          title: a.title,
          wordpressRemoteId: a.wordpress.remoteId,
          wordpressStatus: a.wordpress.status,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          publishedAt: a.publishedAt,
        })),
      };
    case "audit":
      return {
        columns: ["id", "at", "actor", "action", "entity", "entityId", "details"],
        rows: (await repo.audit.list())
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          .map((e) => ({ ...e })),
      };
  }
}

export const exportEntity: Handler = async (ctx) => {
  const entity = ctx.params["entity"] as ExportEntity;
  if (!ENTITIES.includes(entity)) throw notFound(`Export inconnu : ${ctx.params["entity"]}.`);
  const format = ctx.query.get("format") ?? "csv";
  if (format !== "csv" && format !== "json")
    throw badRequest("invalid_format", "Format attendu : csv ou json.");
  const table = await buildTable(ctx, entity);
  const name = `kora-${entity}-${isoDay(ctx.now)}`;
  if (format === "json") {
    return fileResponse(JSON.stringify(table.rows, null, 2), {
      filename: `${name}.json`,
      contentType: "application/json; charset=utf-8",
    });
  }
  return fileResponse(toCsv(table.columns, table.rows), {
    filename: `${name}.csv`,
    contentType: "text/csv; charset=utf-8",
    bom: true,
  });
};

export const exportManifest: Handler = async (ctx) => {
  const entities = [];
  for (const entity of ENTITIES) {
    const table = await buildTable(ctx, entity);
    entities.push({
      entity,
      label: ENTITY_LABEL[entity],
      count: table.rows.length,
      columns: table.columns,
      csv: `/api/export/${entity}?format=csv`,
      json: `/api/export/${entity}?format=json`,
    });
  }
  const manifest = {
    workspaceId: WORKSPACE_ID,
    generatedAt: ctx.now.toISOString(),
    generatedBy: ctx.user.name,
    encoding: "UTF-8 (CSV avec BOM, séparateur virgule, fins de ligne CRLF)",
    dates: "ISO 8601 ; une date inconnue est laissée vide (null en JSON)",
    entities,
  };
  return fileResponse(JSON.stringify(manifest, null, 2), {
    filename: `kora-manifest-${isoDay(ctx.now)}.json`,
    contentType: "application/json; charset=utf-8",
  });
};
