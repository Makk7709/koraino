/** CSV RFC 4180 : séparateur virgule, CRLF, champs entre guillemets si nécessaire. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let s: string;

  if (typeof value === "string") {
    s = sanitizeString(value);
  } else if (Array.isArray(value)) {
    s = value
      .map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)))
      .join(" | ");

    // On protège la chaîne finale.
    s = sanitizeString(s);
  } else if (typeof value === "object") {
    s = sanitizeString(JSON.stringify(value));
  } else {
    s = String(value);
  }

  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(cell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function sanitizeString(value: string): string {
  const trimmed = value.trimStart();
  if (/^[\t\r]/.test(value) || /^[=+\-@]/.test(value.trimStart())) {
    return `'${value}`;
  }

  return value;
}
