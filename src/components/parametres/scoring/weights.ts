import type { Criterion } from "@/lib/api/types";
import { CRITERIA } from "../labels";

export type Weights = Record<Criterion, number>;

export const sumWeights = (w: Weights) => CRITERIA.reduce((s, k) => s + w[k], 0);
