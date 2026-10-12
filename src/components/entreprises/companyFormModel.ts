import type { Company, CompanyInput, CompanyPriority, Theme } from "@/lib/api/types";

export interface CompanyFormValues {
  name: string;
  aliases: string[];
  domain: string;
  sector: string;
  territory: string;
  priority: CompanyPriority;
  themes: Theme[];
}

export const EMPTY_COMPANY: CompanyFormValues = {
  name: "",
  aliases: [],
  domain: "",
  sector: "",
  territory: "",
  priority: "normale",
  themes: [],
};

export function fromCompany(c: Company): CompanyFormValues {
  return {
    name: c.name,
    aliases: [...c.aliases],
    domain: c.domain,
    sector: c.sector,
    territory: c.territory,
    priority: c.priority,
    themes: [...c.themes],
  };
}

/** « https://www.pasqal.com/fr » → « pasqal.com ». */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

export type CompanyErrors = Partial<Record<"name" | "domain" | "sector", string>>;

export function validateCompany(v: CompanyFormValues): CompanyErrors {
  const errors: CompanyErrors = {};
  if (!v.name.trim()) errors.name = "La raison sociale est obligatoire.";
  const domain = normalizeDomain(v.domain);
  if (!domain) errors.domain = "Le domaine officiel est obligatoire.";
  else if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain))
    errors.domain = "Domaine invalide (ex. pasqal.com).";
  if (!v.sector.trim()) errors.sector = "Le secteur est obligatoire.";
  return errors;
}

export function toCompanyInput(v: CompanyFormValues): CompanyInput {
  return {
    name: v.name.trim(),
    aliases: v.aliases,
    domain: normalizeDomain(v.domain),
    sector: v.sector.trim(),
    territory: v.territory.trim(),
    priority: v.priority,
    themes: v.themes,
  };
}
