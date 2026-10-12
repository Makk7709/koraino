import { RUN_STATUS, SOURCE_ACCESS, SOURCE_TYPE } from "@/components/kora/labels";
import type { SourceFrequency } from "@/lib/api/types";

export const FREQUENCY: Record<SourceFrequency, string> = {
  quotidienne: "Quotidienne",
  hebdomadaire: "Hebdomadaire",
};

const entries = <K extends string, V>(r: Record<K, V>) => Object.entries(r) as [K, V][];

export const SOURCE_TYPE_OPTIONS = entries(SOURCE_TYPE).map(([value, label]) => ({ value, label }));
export const SOURCE_ACCESS_OPTIONS = entries(SOURCE_ACCESS).map(([value, v]) => ({
  value,
  label: v.label,
}));
export const FREQUENCY_OPTIONS = entries(FREQUENCY).map(([value, label]) => ({ value, label }));
export const RUN_STATUS_OPTIONS = entries(RUN_STATUS).map(([value, v]) => ({
  value,
  label: v.label,
}));
