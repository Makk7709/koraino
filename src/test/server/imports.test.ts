import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiErrorBody, ArticleDetail, HumanImport } from "@/lib/api/types";
import { DOCX_MIME } from "@/server/domain/imports";
import { call, multipart, setup, teardown, USERS } from "./helpers";

beforeEach(() => setup());
afterEach(teardown);

const NBSP = "\u00a0";
const NNBSP = "\u202f";

const TXT = [
  "Pasqal ouvre un laboratoire à Grenoble",
  "",
  "Le laboratoire accueillera 40 chercheurs : une première pour la filière.",
  "",
  'Selon la direction, "c\'est une étape"  importante pour la ville !',
  "",
].join("\r\n");

function importFile(
  file: { name: string; type: string; content: Uint8Array | string },
  author = "Camille Roux",
  user?: string,
) {
  return call<HumanImport & ApiErrorBody>("POST", "/imports", {
    raw: multipart(author ? { author } : {}, file),
    ...(user ? { user } : {}),
  });
}

describe("WF3 : import d'un article humain", () => {
  it("importe un TXT, conserve l'original et ne convertit que les propositions acceptées", async () => {
    const res = await importFile({ name: "article.txt", type: "text/plain", content: TXT });
    expect(res.status).toBe(201);
    const imp = res.body;
    expect(imp).toMatchObject({
      filename: "article.txt",
      author: "Camille Roux",
      createdBy: "Sophie Martin",
      articleId: null,
    });
    expect(imp.sizeBytes).toBe(new TextEncoder().encode(TXT).byteLength);
    expect(imp.originalText).toBe(TXT);
    expect(imp.extractedText).toBe(TXT.replace(/\r\n/g, "\n"));
    expect(imp.proposals.every((p) => p.decision === "en_attente")).toBe(true);
    expect(Object.keys(imp.proposals[0]!).sort()).toEqual([
      "after",
      "before",
      "decision",
      "id",
      "kind",
      "rationale",
    ]);

    const colon = imp.proposals.find((p) => p.after === `s${NBSP}:`)!;
    const quotes = imp.proposals.find((p) => p.kind === "mise_en_forme")!;
    const exclamation = imp.proposals.find((p) => p.after === `e${NNBSP}!`)!;
    const spaces = imp.proposals.find((p) => p.before === "  ")!;
    const link = imp.proposals.find((p) => p.kind === "enrichissement")!;
    expect([colon, quotes, exclamation, spaces, link].every(Boolean)).toBe(true);
    expect(quotes.after).toBe(`«${NBSP}c'est une étape${NBSP}»`);
    expect(link.after).toBe("[Pasqal](/entreprises?id=co_pasqal)");

    for (const [p, decision] of [
      [colon, "acceptee"],
      [quotes, "acceptee"],
      [exclamation, "refusee"],
    ] as const) {
      const r = await call<HumanImport>("PATCH", `/imports/${imp.id}/proposals/${p.id}`, {
        body: { decision },
      });
      expect(r.body.proposals.find((x) => x.id === p.id)!.decision).toBe(decision);
    }

    const converted = await call<ArticleDetail>("POST", `/imports/${imp.id}/convert`);
    expect(converted.status).toBe(201);
    const art = converted.body;
    expect(art).toMatchObject({
      origin: "import_humain",
      author: "Camille Roux",
      status: "brouillon",
      companyId: "co_pasqal",
    });
    expect(art.versions[0]!.createdBy).toBe("Camille Roux");
    expect(art.title).toBe("Pasqal ouvre un laboratoire à Grenoble");
    const v = art.versions[0]!;
    expect(v.chapo).toBe(
      `Le laboratoire accueillera 40 chercheurs${NBSP}: une première pour la filière.`,
    );
    expect(v.body).toBe(
      `Selon la direction, «${NBSP}c'est une étape${NBSP}»  importante pour la ville !`,
    );

    const stored = await call<HumanImport[]>("GET", "/imports");
    const after = stored.body.find((i) => i.id === imp.id)!;
    expect(after.originalText).toBe(TXT);
    expect(after.articleId).toBe(art.id);

    const twice = await call<ApiErrorBody>("POST", `/imports/${imp.id}/convert`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("already_converted");
    const late = await call<ApiErrorBody>("PATCH", `/imports/${imp.id}/proposals/${spaces.id}`, {
      body: { decision: "acceptee" },
    });
    expect(late.status).toBe(409);
  });

  it("extrait le texte d'un DOCX (paragraphes, runs, entités)", async () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Verkor inaugure sa gigafactory</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">La production démarre </w:t></w:r><w:r><w:t>à Dunkerque &amp; Grenoble.</w:t></w:r></w:p>' +
      "<w:p/>" +
      "<w:p><w:r><w:t>Un jalon</w:t><w:tab/><w:t>pour l’industrie.</w:t></w:r></w:p>" +
      "</w:body></w:document>";
    const docx = zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      ),
      "word/document.xml": strToU8(xml),
    });
    const res = await importFile({ name: "Gigafactory.docx", type: DOCX_MIME, content: docx });
    expect(res.status).toBe(201);
    expect(res.body.mime).toBe(DOCX_MIME);
    expect(res.body.extractedText).toBe(
      "Verkor inaugure sa gigafactory\n\nLa production démarre à Dunkerque & Grenoble.\n\nUn jalon\tpour l’industrie.",
    );
    expect(res.body.originalText).toBe(
      "Verkor inaugure sa gigafactory\nLa production démarre à Dunkerque & Grenoble.\n\nUn jalon\tpour l’industrie.",
    );
    const converted = await call<ArticleDetail>("POST", `/imports/${res.body.id}/convert`);
    expect(converted.body.title).toBe("Verkor inaugure sa gigafactory");
  });

  it("refuse un fichier de plus de 10 Mo (413)", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x61);
    const res = await importFile({ name: "gros.txt", type: "text/plain", content: big });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("file_too_large");
  });

  it("refuse les formats non pris en charge et les encodages invalides (415)", async () => {
    const pdf = await importFile({
      name: "rapport.pdf",
      type: "application/pdf",
      content: "%PDF-1.7",
    });
    expect(pdf.status).toBe(415);
    expect(pdf.body.error.code).toBe("unsupported_format");
    const disguised = await importFile({
      name: "rapport.txt",
      type: "application/pdf",
      content: "%PDF-1.7",
    });
    expect(disguised.status).toBe(415);
    const latin1 = await importFile({
      name: "ancien.txt",
      type: "text/plain",
      content: new Uint8Array([0x43, 0x61, 0x66, 0xe9]),
    });
    expect(latin1.status).toBe(415);
    expect(latin1.body.error.code).toBe("invalid_encoding");
    const fakeDocx = await importFile({
      name: "faux.docx",
      type: DOCX_MIME,
      content: "pas une archive",
    });
    expect(fakeDocx.status).toBe(415);
    expect(fakeDocx.body.error.code).toBe("invalid_docx");
  });

  it("exige un fichier et un auteur nommé, et les droits de rédaction", async () => {
    const noAuthor = await importFile({ name: "a.txt", type: "text/plain", content: "Texte" }, "");
    expect(noAuthor.status).toBe(400);
    expect(noAuthor.body.error.code).toBe("author_required");
    const noFile = await call<ApiErrorBody>("POST", "/imports", {
      raw: multipart({ author: "Camille Roux" }),
    });
    expect(noFile.status).toBe(400);
    expect(noFile.body.error.code).toBe("file_required");
    const json = await call<ApiErrorBody>("POST", "/imports", { body: { author: "x" } });
    expect(json.status).toBe(400);
    const reader = await importFile(
      { name: "a.txt", type: "text/plain", content: "Texte" },
      "Camille Roux",
      USERS.lecteur,
    );
    expect(reader.status).toBe(403);
  });
});
