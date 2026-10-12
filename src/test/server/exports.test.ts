import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toCsv } from "@/server/domain/csv";
import { call, setup, teardown } from "./helpers";

beforeEach(() => setup());
afterEach(teardown);

describe("exports CSV / JSON", () => {
  it("échappe les champs CSV (RFC 4180) et neutralise les formules", () => {
    const csv = toCsv(
      ["a", "b", "c"],
      [
        { a: 'Dupont, "Jean"', b: "ligne 1\nligne 2", c: '=HYPERLINK("http://x")' },
        { a: "+33 6 00", b: "-2+3", c: "@SUM(A1)" },
        { a: ["x", "y"], b: null, c: 42 },
      ],
    );
    expect(csv).toBe(
      [
        "a,b,c",
        '"Dupont, ""Jean""","ligne 1\nligne 2","\'=HYPERLINK(""http://x"")"',
        "'+33 6 00,'-2+3,'@SUM(A1)",
        "x | y,,42",
        "",
      ].join("\r\n"),
    );
  });

  it("exporte les entreprises en CSV UTF-8 avec BOM, en pièce jointe", async () => {
    await call("PATCH", "/companies/co_pasqal", {
      body: { sector: '=cmd|" /C calc"!A0, quantique' },
    });
    const res = await call("GET", "/export/companies?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="kora-companies-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = res.text.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "id,name,aliases,domain,sector,territory,priority,themes,createdAt,sourceCount,failingSourceCount,signalCount",
    );
    expect(lines).toHaveLength(152);
    const pasqal = lines.find((l) => l.startsWith("co_pasqal,"))!;
    expect(pasqal).toContain('"\'=cmd|"" /C calc""!A0, quantique"');
  });

  it("exporte en JSON et refuse une entité inconnue", async () => {
    const res = await call("GET", "/export/signals?format=json");
    expect(res.status).toBe(200);
    const rows = JSON.parse(res.text) as { id: string; publishedAt: string | null }[];
    expect(rows.length).toBeGreaterThan(200);
    expect(rows.some((r) => r.publishedAt === null)).toBe(true);
    expect((await call("GET", "/export/inconnu?format=csv")).status).toBe(404);
    expect((await call("GET", "/export/signals?format=xml")).status).toBe(400);
  });

  it("produit un manifeste de réversibilité", async () => {
    const res = await call("GET", "/export/manifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const manifest = JSON.parse(res.text) as {
      workspaceId: string;
      entities: { entity: string; count: number; csv: string }[];
    };
    expect(manifest.workspaceId).toBe("ws_inovallee");
    expect(manifest.entities.map((e) => e.entity)).toEqual([
      "companies",
      "sources",
      "signals",
      "observations",
      "scores",
      "rules",
      "decisions",
      "articles",
      "audit",
    ]);
    expect(manifest.entities.find((e) => e.entity === "companies")!.count).toBe(150);
    expect(manifest.entities.every((e) => e.csv === `/api/export/${e.entity}?format=csv`)).toBe(
      true,
    );
  });
});
