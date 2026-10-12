/** CSV RFC 4180 : séparateur virgule, CRLF, champs entre guillemets si nécessaire. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (Array.isArray(value))
    s = value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(" | ");
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  // Neutralise l'injection de formules dans les tableurs.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(cell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
