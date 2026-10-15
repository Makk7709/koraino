import type { ArticleVersion } from "@/lib/api/types";
import type { Ctx, Handler } from "../context";
import { matchCompany, MATCH_THRESHOLD } from "../domain/clustering";
import {
  applyAccepted,
  buildProposals,
  DOCX_MIME,
  detectFormat,
  extractTexts,
  ImportFormatError,
  MAX_IMPORT_BYTES,
  splitArticle,
} from "../domain/imports";
import { assertCan } from "../domain/permissions";
import { truncate } from "../domain/text";
import { badRequest, conflict, HttpError, json, notFound } from "../http";
import type { ArticleRecord, ImportRecord } from "../store/records";
import { audit } from "../services/journal";
import { WRITE_LOCK_TTL_MS, withLock } from "../services/locks";
import { assertQuota } from "../services/usage";
import { articleDetail, toImport } from "../services/view";
import { parse, schemas } from "../validation";

const tooLarge = () =>
  new HttpError(413, "file_too_large", "Fichier trop volumineux : 10 Mo maximum.", {
    maxBytes: MAX_IMPORT_BYTES,
  });

/** Garde-fou avant lecture du corps multipart (appelé par le routeur). */
export function assertImportSize(request: Request): void {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_IMPORT_BYTES + 64 * 1024) throw tooLarge();
}

interface Upload {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Fichier multipart (test structurel : la classe File varie selon l'environnement d'exécution). */
function isUpload(value: unknown): value is Upload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<Upload>;
  return (
    typeof v.name === "string" && typeof v.size === "number" && typeof v.arrayBuffer === "function"
  );
}

function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return truncate(clean || "document", 200);
}

export const listImports: Handler = async (ctx) => {
  const list = await ctx.repo.imports.list();
  return json(list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(toImport));
};

/** WF3 : import TXT/DOCX. Texte original conservé ; propositions en attente de décision humaine. */
export const createImport: Handler = async (ctx) => {
  assertCan(ctx.user, "import.write");
  const form = ctx.form;
  if (!form)
    throw badRequest(
      "multipart_required",
      "Envoyez le fichier en multipart/form-data (champs file et author).",
    );
  const file = form.get("file");
  const author = form.get("author");
  if (!isUpload(file)) throw badRequest("file_required", "Le fichier est obligatoire.");
  if (typeof author !== "string" || !author.trim()) {
    throw badRequest("author_required", "L'auteur humain du texte est obligatoire.");
  }
  if (file.size > MAX_IMPORT_BYTES) throw tooLarge();
  const filename = safeFilename(file.name);
  const format = detectFormat(filename, file.type);
  if (!format) {
    throw new HttpError(
      415,
      "unsupported_format",
      "Format non pris en charge : importez un fichier .txt ou .docx.",
      {
        filename,
        mime: file.type || null,
      },
    );
  }
  await assertQuota(ctx.repo, ctx.now, "storage_gb", file.size / 1e9);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw tooLarge();
  let texts: { originalText: string; extractedText: string };
  try {
    texts = extractTexts(format, bytes);
  } catch (e) {
    if (e instanceof ImportFormatError) throw new HttpError(415, e.code, e.message);
    throw e;
  }
  const companies = await ctx.repo.companies.list();
  const links = companies.map((c) => ({
    name: c.name,
    href: `/entreprises?id=${c.id}`,
    label: `la fiche ${c.name}`,
  }));
  const id = ctx.repo.nextId("imp");
  const rec: ImportRecord = {
    id,
    filename,
    mime: format === "docx" ? DOCX_MIME : "text/plain",
    sizeBytes: bytes.byteLength,
    author: truncate(author.trim(), 120),
    originalText: texts.originalText,
    extractedText: texts.extractedText,
    proposals: buildProposals(texts.extractedText, links).map((p, i) => ({
      id: `${id}_p${i + 1}`,
      ...p,
      decision: "en_attente",
    })),
    articleId: null,
    createdAt: ctx.now.toISOString(),
    createdBy: ctx.user.name,
    bytes,
  };
  await ctx.repo.imports.insert(rec);
  await audit(
    ctx,
    "import.create",
    "import",
    id,
    `${filename} (${format.toUpperCase()}, ${rec.sizeBytes} octets) — auteur : ${rec.author} — ${rec.proposals.length} proposition(s)`,
  );
  return json(toImport(rec), { status: 201 });
};

async function getImportOr404(ctx: Parameters<Handler>[0]): Promise<ImportRecord> {
  const rec = await ctx.repo.imports.get(ctx.params["id"]!);
  if (!rec) throw notFound("Import introuvable.");
  return rec;
}

export const decideProposal: Handler = async (ctx) => {
  assertCan(ctx.user, "import.write");
  const rec = await getImportOr404(ctx);
  const { decision } = parse(schemas.proposalDecision, ctx.body);
  const proposal = rec.proposals.find((p) => p.id === ctx.params["pid"]);
  if (!proposal) throw notFound("Proposition introuvable.");
  if (rec.articleId) {
    throw conflict(
      "already_converted",
      "Cet import a déjà été converti en article : les propositions sont figées.",
    );
  }
  const next: ImportRecord = {
    ...rec,
    proposals: rec.proposals.map((p) => (p.id === proposal.id ? { ...p, decision } : p)),
  };
  await ctx.repo.imports.update(next);
  await audit(
    ctx,
    "import.proposal",
    "import",
    rec.id,
    `${proposal.kind} « ${truncate(proposal.before, 40)} » : ${decision}`,
  );
  return json(toImport(next));
};

/** Conversion : texte extrait + propositions acceptées uniquement ; l'auteur nommé est conservé. */
export const convertImport: Handler = (ctx) => {
  assertCan(ctx.user, "import.write");
  return withLock(
    ctx.repo,
    `import-convert:${ctx.params["id"]}`,
    {
      ttlMs: WRITE_LOCK_TTL_MS,
      busy: () => conflict("conversion_in_progress", "Cet import est déjà en cours de conversion."),
    },
    () => convert(ctx),
  );
};

async function convert(ctx: Ctx): Promise<Response> {
  const rec = await getImportOr404(ctx);
  if (rec.articleId) {
    throw conflict("already_converted", "Cet import a déjà été converti en article.", {
      articleId: rec.articleId,
    });
  }
  const text = applyAccepted(rec.extractedText, rec.proposals);
  const parts = splitArticle(text, rec.filename.replace(/\.[^.]+$/, ""));
  const accepted = rec.proposals.filter((p) => p.decision === "acceptee").length;
  const companies = await ctx.repo.companies.list();
  const match = matchCompany(text, "", companies, null);
  const at = ctx.now.toISOString();
  const v1: ArticleVersion = {
    n: 1,
    title: parts.title,
    chapo: parts.chapo,
    body: parts.body,
    excerpt: truncate(parts.chapo || parts.body, 200),
    seoTitle: truncate(parts.title, 60),
    categories: [],
    tags: [],
    createdAt: at,
    createdBy: rec.author,
    note: `Import de ${rec.filename} — ${accepted}/${rec.proposals.length} proposition(s) acceptée(s)`,
  };
  const article: ArticleRecord = {
    id: ctx.repo.nextId("art"),
    signalId: null,
    companyId: match.confidence >= MATCH_THRESHOLD ? match.companyId : null,
    origin: "import_humain",
    author: rec.author,
    status: "brouillon",
    currentVersion: 1,
    title: v1.title,
    excerpt: v1.excerpt,
    angles: [],
    plan: [],
    factChecks: [],
    approvals: [],
    wordpress: { remoteId: null, status: "aucun", lastSyncAt: null },
    createdAt: at,
    updatedAt: at,
    versions: [v1],
    publishedAt: null,
    createdBy: ctx.user.name,
  };
  await ctx.repo.articles.insert(article);
  await ctx.repo.imports.update({ ...rec, articleId: article.id });
  await audit(
    ctx,
    "import.convert",
    "import",
    rec.id,
    `Converti en article ${article.id} — auteur conservé : ${rec.author} — ${accepted} proposition(s) appliquée(s)`,
  );
  return json(await articleDetail(ctx.repo, article, ctx.now), { status: 201 });
}
