import type { NewsletterEdition } from "@/lib/api/types";
import { escapeHtml } from "./text";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function header(edition: Pick<NewsletterEdition, "weekOf">): string {
  return `Semaine du ${dateFmt.format(new Date(edition.weekOf))}`;
}

/** Export HTML simple (styles en ligne) — KORA n'envoie jamais la newsletter. */
export function renderNewsletterHtml(edition: NewsletterEdition, approved: boolean): string {
  const items = [...edition.items].sort((a, b) => a.order - b.order);
  const rows = items
    .map(
      (item, i) => `      <tr>
        <td style="padding:18px 28px;border-top:1px solid #e2eaf1;">
          <h2 style="margin:0 0 6px;font-size:17px;line-height:1.35;color:#1b2a4a;">${i + 1}. ${escapeHtml(item.title)}</h2>
          <p style="margin:0;font-size:14px;line-height:1.55;color:#3d4b68;">${escapeHtml(item.summary)}</p>
        </td>
      </tr>`,
    )
    .join("\n");
  const banner = approved
    ? ""
    : `      <tr><td style="padding:10px 28px;background:#fff3d3;color:#8a5a00;font-size:12px;">Aperçu — version ${edition.version} non approuvée.</td></tr>\n`;
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(edition.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fa;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fa;">
    <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
${banner}      <tr>
        <td style="padding:28px;background:#0b6e7e;color:#ffffff;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85;">Inovallée · ${escapeHtml(header(edition))}</p>
          <h1 style="margin:0;font-size:24px;line-height:1.25;">${escapeHtml(edition.title)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:22px 28px;font-size:15px;line-height:1.6;color:#3d4b68;">${escapeHtml(edition.intro)}</td>
      </tr>
${rows}
      <tr>
        <td style="padding:18px 28px;background:#f4f7fa;font-size:12px;color:#64748b;">Inovallée — édition ${edition.version}. Export préparé avec KORA Newsroom ; aucun envoi automatique.</td>
      </tr>
    </table>
    </td></tr>
  </table>
</body>
</html>
`;
}

export function renderNewsletterText(edition: NewsletterEdition, approved: boolean): string {
  const items = [...edition.items].sort((a, b) => a.order - b.order);
  const lines: string[] = [];
  if (!approved) lines.push(`[APERÇU — version ${edition.version} non approuvée]`, "");
  lines.push(edition.title.toUpperCase(), `Inovallée · ${header(edition)}`, "", edition.intro, "");
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.title}`, `   ${item.summary}`, "");
  });
  lines.push(
    "—",
    `Inovallée — édition ${edition.version}. Export préparé avec KORA Newsroom ; aucun envoi automatique.`,
  );
  return `${lines.join("\n")}\n`;
}
