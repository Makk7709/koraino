import type { Approval, ArticleStatus, ArticleVersion, PublicationAttempt } from "@/lib/api/types";
import { adapters } from "../adapters";
import type { Ctx, Handler } from "../context";
import { COSTS } from "../domain/budget";
import { KORA_AUTHOR } from "../domain/dna";
import { assertCan, can } from "../domain/permissions";
import { truncate } from "../domain/text";
import {
  channelLabel,
  checkPublishable,
  idempotencyKey,
  invalidateApprovals,
  MODIFIED_AFTER_APPROVAL,
  unresolvedContradictions,
} from "../domain/workflow";
import { conflict, forbidden, json, notFound, unprocessable } from "../http";
import type { ArticleRecord } from "../store/records";
import { refreshProposals } from "../services/dna";
import { audit, notify } from "../services/journal";
import { GENERATION_LOCK_TTL_MS, withLock } from "../services/locks";
import { assertQuota, paidCall } from "../services/usage";
import { articleDetail, toArticle, toPublication } from "../services/view";
import { parse, schemas } from "../validation";
import { publishWordPress, replayableSuccess, settleSignal } from "../wordpress/publish";

async function getArticleOr404(ctx: Ctx, id: string): Promise<ArticleRecord> {
  const a = await ctx.repo.articles.get(id);
  if (!a) throw notFound("Article introuvable.");
  return a;
}

const detail = async (ctx: Ctx, rec: ArticleRecord, status = 200) =>
  json(await articleDetail(ctx.repo, rec, ctx.now), { status });

const STATUS_LABEL: Record<ArticleStatus, string> = {
  brouillon: "Brouillon",
  en_revue: "En revue",
  approuve: "Approuvé",
  programme: "Programmé",
  publie: "Publié",
  rejete: "Rejeté",
};

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export const listArticles: Handler = async (ctx) => {
  const status = ctx.query.get("status");
  const origin = ctx.query.get("origin");
  const list = (await ctx.repo.articles.list())
    .filter((a) => !status || status === "tous" || a.status === status)
    .filter((a) => !origin || origin === "tous" || a.origin === origin)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id.localeCompare(a.id));
  return json(list.map((a) => toArticle(a)));
};

export const getArticle: Handler = async (ctx) =>
  detail(ctx, await getArticleOr404(ctx, ctx.params["id"]!));

export const listPublications: Handler = async (ctx) => {
  const channel = ctx.query.get("channel");
  const articleId = ctx.query.get("articleId");
  const list = (await ctx.repo.publications.list())
    .filter((p) => !channel || channel === "tous" || p.channel === channel)
    .filter((p) => !articleId || p.articleId === articleId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  return json(list.map(toPublication));
};

/* ------------------------------------------------------------------ */
/* WF2 : création depuis un signal                                     */
/* ------------------------------------------------------------------ */

export const createArticle: Handler = async (ctx) => {
  assertCan(ctx.user, "article.write");
  const input = parse(schemas.createArticle, ctx.body);
  return withLock(
    ctx.repo,
    `article-create:${input.signalId}`,
    {
      ttlMs: GENERATION_LOCK_TTL_MS,
      busy: () =>
        conflict(
          "generation_in_progress",
          "Le dossier et le brouillon de ce signal sont déjà en cours de génération : patientez quelques secondes.",
        ),
    },
    () => generateArticle(ctx, input),
  );
};

async function generateArticle(
  ctx: Ctx,
  input: { signalId: string; angle?: string | null | undefined },
): Promise<Response> {
  const signal = await ctx.repo.signals.get(input.signalId);
  if (!signal) throw notFound("Signal introuvable.");
  if (signal.articleId && (await ctx.repo.articles.get(signal.articleId))) {
    throw conflict("article_exists", "Un article existe déjà pour ce signal.", {
      articleId: signal.articleId,
    });
  }
  if (signal.status === "rejete") {
    throw unprocessable(
      "signal_rejected",
      "Ce signal a été rejeté : réouvrez-le avant de lancer la rédaction.",
    );
  }
  await assertQuota(ctx.repo, ctx.now, "articles");
  const [company, observations, rules] = await Promise.all([
    signal.companyId ? ctx.repo.companies.get(signal.companyId) : Promise.resolve(undefined),
    ctx.repo.observations.list(),
    ctx.repo.rules.list(),
  ]);
  const ids = new Set(signal.observationIds);
  const dossier = await paidCall(
    ctx,
    {
      kind: "generation_article",
      estimate: COSTS.article,
      units: 1,
      label: `Dossier et brouillon : ${signal.title}`,
    },
    async () => {
      const dossierInput = {
        signal,
        company: company ?? null,
        observations: observations.filter((o) => ids.has(o.id)),
        angle: input.angle ?? null,
        rules: rules.filter((r) => r.active),
      };
      const base = adapters().textModel.generateDossier(dossierInput);
      return (await adapters().ai?.enhanceDossier(dossierInput, base)) ?? base;
    },
  );
  const id = ctx.repo.nextId("art");
  const at = ctx.now.toISOString();
  const v1: ArticleVersion = {
    n: 1,
    ...dossier.draft,
    createdAt: at,
    createdBy: KORA_AUTHOR,
    note: "Brouillon généré par KORA à partir du dossier",
  };
  const rec: ArticleRecord = {
    id,
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
    factChecks: dossier.factChecks.map((f, i) => ({ ...f, id: `fc_${id}_${i + 1}` })),
    approvals: [],
    wordpress: { remoteId: null, status: "aucun", lastSyncAt: null },
    createdAt: at,
    updatedAt: at,
    versions: [v1],
    publishedAt: null,
    createdBy: ctx.user.name,
  };
  await ctx.repo.articles.insert(rec);
  await ctx.repo.signals.update({
    ...signal,
    articleId: id,
    status: signal.status === "traite" ? signal.status : "en_revue",
    updatedAt: at,
  });
  const contradictions = unresolvedContradictions(rec.factChecks).length;
  await audit(
    ctx,
    "article.create",
    "article",
    id,
    `Dossier factuel et brouillon v1 générés depuis le signal ${signal.id}${contradictions ? ` — ${contradictions} contradiction(s) à arbitrer` : ""}`,
  );
  return detail(ctx, rec, 201);
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

/** Nouvelle version : invalide les approbations et repasse le contenu en revue. */
async function pushVersion(
  ctx: Ctx,
  rec: ArticleRecord,
  version: Omit<ArticleVersion, "n" | "createdAt">,
  action: string,
) {
  const at = ctx.now.toISOString();
  const n = Math.max(...rec.versions.map((v) => v.n)) + 1;
  const previous = rec.versions.find((v) => v.n === rec.currentVersion);
  const hadValid = rec.approvals.some((a) => a.valid);
  const status: ArticleStatus =
    rec.status === "approuve" || rec.status === "programme" || rec.status === "publie"
      ? "en_revue"
      : rec.status === "rejete"
        ? "brouillon"
        : rec.status;
  const next: ArticleRecord = {
    ...rec,
    versions: [...rec.versions, { ...version, n, createdAt: at }],
    currentVersion: n,
    title: version.title,
    excerpt: version.excerpt,
    approvals: invalidateApprovals(rec.approvals, at, MODIFIED_AFTER_APPROVAL),
    status,
    updatedAt: at,
  };
  await ctx.repo.articles.update(next);
  await audit(
    ctx,
    action,
    "article",
    rec.id,
    `Version ${n} enregistrée${version.note ? ` (${version.note})` : ""}${hadValid ? ` — approbation invalidée : ${MODIFIED_AFTER_APPROVAL.toLowerCase()}` : ""}`,
  );
  if (previous?.createdBy === KORA_AUTHOR && version.createdBy !== KORA_AUTHOR)
    await refreshProposals(ctx);
  return next;
}

export const saveVersion: Handler = async (ctx) => {
  assertCan(ctx.user, "article.write");
  const rec = await getArticleOr404(ctx, ctx.params["id"]!);
  const input = parse(schemas.articleVersion, ctx.body);
  const current =
    rec.versions.find((v) => v.n === rec.currentVersion) ?? rec.versions[rec.versions.length - 1]!;
  const next = await pushVersion(
    ctx,
    rec,
    {
      title: input.title,
      chapo: input.chapo,
      body: input.body,
      excerpt: input.excerpt ?? truncate(input.chapo || input.body, 200),
      seoTitle: input.seoTitle ?? truncate(input.title, 60),
      categories: input.categories ?? current.categories,
      tags: input.tags ?? current.tags,
      createdBy: ctx.user.name,
      note: input.note ?? null,
    },
    "article.version",
  );
  return detail(ctx, next, 201);
};

export const restoreVersion: Handler = async (ctx) => {
  assertCan(ctx.user, "article.write");
  const rec = await getArticleOr404(ctx, ctx.params["id"]!);
  const { version } = parse(schemas.restore, ctx.body);
  const source = rec.versions.find((v) => v.n === version);
  if (!source) throw unprocessable("version_not_found", `La version ${version} n'existe pas.`);
  if (version === rec.currentVersion) {
    throw conflict("already_current", `La version ${version} est déjà la version courante.`);
  }
  const { n: _n, createdAt: _c, ...content } = source;
  const next = await pushVersion(
    ctx,
    rec,
    { ...content, createdBy: ctx.user.name, note: `Restauration de la version ${version}` },
    "article.restore",
  );
  return detail(ctx, next, 201);
};

/* ------------------------------------------------------------------ */
/* Revue, approbation, rejet                                           */
/* ------------------------------------------------------------------ */

export const submitArticle: Handler = async (ctx) => {
  assertCan(ctx.user, "article.write");
  const rec = await getArticleOr404(ctx, ctx.params["id"]!);
  if (rec.status === "en_revue") return detail(ctx, rec);
  if (rec.status !== "brouillon" && rec.status !== "rejete") {
    throw conflict(
      "invalid_state",
      `Soumission impossible depuis l'état « ${STATUS_LABEL[rec.status]} ».`,
    );
  }
  const next: ArticleRecord = { ...rec, status: "en_revue", updatedAt: ctx.now.toISOString() };
  await ctx.repo.articles.update(next);
  await audit(
    ctx,
    "article.submit",
    "article",
    rec.id,
    `Version ${rec.currentVersion} soumise à validation`,
  );
  await notify(ctx.repo, ctx.now, {
    kind: "approbation",
    title: "Article à valider",
    body: `${rec.title} — version ${rec.currentVersion} soumise par ${ctx.user.name}`,
    link: `/articles?id=${rec.id}`,
  });
  return detail(ctx, next);
};

export const approveArticle: Handler = async (ctx) => {
  assertCan(ctx.user, "article.decide");
  const rec = await getArticleOr404(ctx, ctx.params["id"]!);
  const input = parse(schemas.approve, ctx.body);
  if (input.version !== rec.currentVersion) {
    throw conflict(
      "version_mismatch",
      `Vous avez relu la version ${input.version}, mais la version courante est la ${rec.currentVersion}. Relisez la dernière version avant d'approuver.`,
      { currentVersion: rec.currentVersion },
    );
  }
  if (!["en_revue", "approuve", "programme"].includes(rec.status)) {
    throw conflict(
      "invalid_state",
      `Approbation impossible depuis l'état « ${STATUS_LABEL[rec.status]} » : soumettez d'abord l'article.`,
    );
  }
  const contradictions = unresolvedContradictions(rec.factChecks);
  if (contradictions.length) {
    throw unprocessable(
      "contradiction_unresolved",
      `Approbation impossible : ${contradictions.length} contradiction(s) non résolue(s) dans le dossier factuel.`,
      { factCheckIds: contradictions.map((f) => f.id) },
    );
  }
  if (input.scheduledAt && Date.parse(input.scheduledAt) <= ctx.now.getTime()) {
    throw unprocessable("schedule_in_past", "La date de programmation doit être dans le futur.");
  }
  const at = ctx.now.toISOString();
  const approval: Approval = {
    id: ctx.repo.nextId("apv"),
    version: input.version,
    channel: input.channel,
    approvedBy: ctx.user.name,
    approvedAt: at,
    scheduledAt: input.scheduledAt ?? null,
    valid: true,
    invalidatedAt: null,
    invalidatedReason: null,
  };
  const approvals = rec.approvals.map((a) =>
    a.valid && a.channel === input.channel
      ? {
          ...a,
          valid: false,
          invalidatedAt: at,
          invalidatedReason: "Remplacée par une nouvelle approbation",
        }
      : a,
  );
  const next: ArticleRecord = {
    ...rec,
    approvals: [...approvals, approval],
    status: input.scheduledAt ? "programme" : "approuve",
    updatedAt: at,
  };
  await ctx.repo.articles.update(next);
  await audit(
    ctx,
    "article.approve",
    "article",
    rec.id,
    `Version ${input.version} approuvée pour ${channelLabel(input.channel)}${input.scheduledAt ? ` — programmée le ${input.scheduledAt}` : ""}`,
  );
  return detail(ctx, next);
};

export const rejectArticle: Handler = async (ctx) => {
  assertCan(ctx.user, "article.decide");
  const rec = await getArticleOr404(ctx, ctx.params["id"]!);
  const { reason } = parse(schemas.reject, ctx.body);
  if (!["en_revue", "approuve", "programme"].includes(rec.status)) {
    throw conflict(
      "invalid_state",
      `Rejet impossible depuis l'état « ${STATUS_LABEL[rec.status]} ».`,
    );
  }
  const at = ctx.now.toISOString();
  const next: ArticleRecord = {
    ...rec,
    status: "rejete",
    approvals: invalidateApprovals(rec.approvals, at, `Rejet : ${reason}`),
    updatedAt: at,
  };
  await ctx.repo.articles.update(next);
  await audit(
    ctx,
    "article.reject",
    "article",
    rec.id,
    `Version ${rec.currentVersion} rejetée — motif : ${reason}`,
  );
  await notify(ctx.repo, ctx.now, {
    kind: "approbation",
    title: "Article rejeté",
    body: `${rec.title} — ${reason}`,
    link: `/articles?id=${rec.id}`,
  });
  return detail(ctx, next);
};

export const resolveFactCheck: Handler = async (ctx) => {
  if (!can(ctx.user, "article.write") && !can(ctx.user, "article.decide")) {
    throw forbidden(
      "L'arbitrage du dossier factuel est réservé à la rédaction et aux validateurs.",
    );
  }
  const rec = await getArticleOr404(ctx, ctx.params["id"]!);
  const input = parse(schemas.factCheck, ctx.body);
  const fc = rec.factChecks.find((f) => f.id === ctx.params["fid"]);
  if (!fc) throw notFound("Élément du dossier factuel introuvable.");
  const at = ctx.now.toISOString();
  const note = input.note?.trim() || null;
  const next: ArticleRecord = {
    ...rec,
    factChecks: rec.factChecks.map((f) =>
      f.id === fc.id
        ? { ...f, status: input.status, resolution: { by: ctx.user.name, at, note } }
        : f,
    ),
    updatedAt: at,
  };
  await ctx.repo.articles.update(next);
  await audit(
    ctx,
    "article.fact_check",
    "article",
    rec.id,
    `Fait « ${truncate(fc.claim, 80)} » : ${fc.status} → ${input.status}${note ? ` — ${note}` : ""}`,
  );
  return detail(ctx, next);
};

/* ------------------------------------------------------------------ */
/* Publication (idempotente)                                           */
/* ------------------------------------------------------------------ */

export const publishArticle: Handler = async (ctx) => {
  assertCan(ctx.user, "publish");
  const rec = await getArticleOr404(ctx, ctx.params["id"]!);
  const { channel, overwriteRemoteChanges } = parse(schemas.publish, ctx.body);
  const version = rec.currentVersion;
  const key = idempotencyKey(rec.id, version, channel);
  const at = ctx.now.toISOString();
  const attempts = await ctx.repo.publications.list();

  // WordPress : rejeu seulement si le brouillon de cet envoi est toujours celui de l'article.
  const done =
    channel === "wordpress"
      ? replayableSuccess(adapters().wordpress, attempts, key, rec)
      : attempts.find((p) => p.idempotencyKey === key && p.status === "succes");
  if (done) {
    await audit(
      ctx,
      "publication.replay",
      "publication",
      done.id,
      `Envoi déjà effectué pour la version ${version} (${channelLabel(channel)}) : aucun doublon créé`,
    );
    return json(toPublication(done));
  }

  const check = checkPublishable({
    approvals: rec.approvals,
    channel,
    version,
    factChecks: rec.factChecks,
  });
  if (!check.ok) {
    const previous = attempts.find(
      (p) => p.idempotencyKey === key && p.status === "bloque" && p.code === check.code,
    );
    const attempt: PublicationAttempt = previous
      ? {
          ...previous,
          attempts: previous.attempts + 1,
          message: check.message,
          at,
          by: ctx.user.name,
          byUserId: ctx.user.id,
        }
      : {
          id: ctx.repo.nextId("pub"),
          idempotencyKey: key,
          articleId: rec.id,
          linkedinPostId: null,
          newsletterId: null,
          channel,
          version,
          status: "bloque",
          code: check.code,
          message: check.message,
          attempts: 1,
          remoteId: null,
          mode: channel === "wordpress" ? "brouillon_distant" : "export",
          at,
          by: ctx.user.name,
          byUserId: ctx.user.id,
        };
    if (previous) await ctx.repo.publications.update(attempt);
    else await ctx.repo.publications.insert(attempt);
    await audit(
      ctx,
      "publication.blocked",
      "publication",
      attempt.id,
      `${rec.title} — ${check.message}`,
    );
    throw unprocessable(check.code, check.message, { attempt: toPublication(attempt) });
  }

  if (channel === "wordpress") {
    return publishWordPress(ctx, rec, { overwriteRemoteChanges: overwriteRemoteChanges === true });
  }

  const attempt: PublicationAttempt = {
    id: ctx.repo.nextId("pub"),
    idempotencyKey: key,
    articleId: rec.id,
    linkedinPostId: null,
    newsletterId: null,
    channel,
    version,
    status: "succes",
    code: null,
    message: `Export ${channelLabel(channel)} prêt (version ${version}) : diffusion manuelle.`,
    attempts: 1,
    remoteId: null,
    mode: "export",
    at,
    by: ctx.user.name,
    byUserId: ctx.user.id,
  };
  await ctx.repo.publications.insert(attempt);
  await ctx.repo.articles.update({ ...rec, updatedAt: at });
  await settleSignal(ctx, rec.signalId, at);
  await audit(
    ctx,
    "publication.success",
    "publication",
    attempt.id,
    `${rec.title} — ${attempt.message}`,
  );
  await notify(ctx.repo, ctx.now, {
    kind: "publication",
    title: `Export ${channelLabel(channel)} prêt`,
    body: `${rec.title} (version ${version})`,
    link: `/articles?id=${rec.id}`,
  });
  return json(toPublication(attempt), { status: 201 });
};
