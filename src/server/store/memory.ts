import {
  paidAttemptSchema,
  validateEstimatedUsageLines,
  validateUsageLines,
  type PaidAttemptRecord,
  type PaidAttemptInput,
  type ReserveResult,
} from "./paid-attempts";
import { decideReservation, monthTotals } from "../domain/budget";
import type { UsageEntry } from "./records";
import type { WordPressSettings } from "@/lib/api/types";
import { now } from "../clock";
import { usesDatabase } from "../database";
import type { Collection, Repository } from "./repository";
import type { Settings } from "./records";
import { wordpressSettingsOf } from "./settings";
import { DbRepository } from "./db";
import { buildSeed, type SeedData } from "./seed";

class MemoryCollection<T extends { id: string }> implements Collection<T> {
  private items = new Map<string, T>();

  constructor(initial: T[]) {
    for (const item of initial) this.items.set(item.id, structuredClone(item));
  }

  async get(id: string) {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async list() {
    return Array.from(this.items.values(), (item) => structuredClone(item));
  }

  async insert(item: T) {
    if (this.items.has(item.id)) throw new Error(`Doublon d'identifiant : ${item.id}`);
    this.items.set(item.id, structuredClone(item));
    return item;
  }

  async update(item: T) {
    if (!this.items.has(item.id)) throw new Error(`Enregistrement absent : ${item.id}`);
    this.items.set(item.id, structuredClone(item));
    return item;
  }

  async remove(id: string) {
    return this.items.delete(id);
  }
}

export class MemoryRepository implements Repository {
  readonly workspaceId: string;
  users;
  companies;
  sources;
  runs;
  observations;
  signals;
  grids;
  articles;
  publications;
  imports;
  linkedin;
  newsletters;
  rules;
  examples;
  ruleProposals;
  usage;
  audit;
  notifications;
  private settings: Settings;
  private wordpress: WordPressSettings | null = null;
  private attempts = new Map<string, PaidAttemptRecord>();
  paidAttempts = {
    reserve: async (attempt: PaidAttemptInput): Promise<ReserveResult> => {
      paidAttemptSchema.parse(attempt);
      if (this.attempts.has(attempt.id)) throw new Error("Duplicate paid attempt");
      const spentEur = monthTotals(await this.usage.list(), attempt.month).costEur;
      const decision = decideReservation({
        settings: this.settings,
        spentEur,
        estimateEur: attempt.estimateEur,
        month: attempt.month,
      });
      if (!decision.ok) {
        const suspending =
          !this.settings.paidCallsSuspended || this.settings.suspendedMonth !== attempt.month;
        this.settings.paidCallsSuspended = true;
        this.settings.suspendedMonth = attempt.month;
        return { ...decision, suspending };
      }
      this.attempts.set(attempt.id, {
        ...attempt,
        status: "reserved",
        billingStatus: "not_sent",
        usageLines: [],
      });
      this.settings.reservedEur += attempt.estimateEur;
      return { ok: true as const };
    },
    start: async (id: string): Promise<void> => {
      const a = this.attempts.get(id);
      if (!a || a.status !== "reserved") throw new Error("Paid attempt not reserved");
      this.attempts.set(id, { ...a, status: "in_flight", billingStatus: "unknown" });
    },
    unknown: async (
      id: string,
      code: "provider_or_callback_error" | "persist_error",
    ): Promise<void> => {
      const a = this.attempts.get(id);
      if (!a || !["in_flight", "unknown"].includes(a.status))
        throw new Error("Paid attempt not in flight");
      this.attempts.set(id, {
        ...a,
        status: "unknown",
        billingStatus: "unknown",
        failureCode: code,
      });
    },
    overrun: async (id: string, lines: UsageEntry[]): Promise<void> => {
      const total = validateEstimatedUsageLines(lines, id);
      const a = this.attempts.get(id);
      if (!a) throw new Error("Paid attempt not found");
      if (total <= a.estimateEur) throw new Error("Not an overrun");
      if (
        a.status === "unknown" &&
        a.failureCode === "estimated_overrun" &&
        JSON.stringify(a.estimatedUsageLines) === JSON.stringify(lines) &&
        a.estimatedCostEur === total
      )
        return;
      if (a.status !== "in_flight") throw new Error("Invalid overrun transition or replay");
      if (this.settings.reservedEur + 1e-9 < a.estimateEur) throw new Error("Reservation missing");
      this.attempts.set(id, {
        ...a,
        status: "unknown",
        billingStatus: "unknown",
        failureCode: "estimated_overrun",
        estimatedUsageLines: structuredClone(lines),
        estimatedCostEur: total,
        estimatedOverrunEur: Math.round((total - a.estimateEur) * 10000) / 10000,
      });
    },
    finish: async (
      id: string,
      lines: UsageEntry[],
      status: "settled" | "not_sent",
    ): Promise<void> => {
      const a = this.attempts.get(id);
      if (!a) throw new Error("Paid attempt not found");
      validateUsageLines(lines, id, a.estimateEur);
      if (a.status === status) {
        if (JSON.stringify(a.usageLines) !== JSON.stringify(lines))
          throw new Error("Paid attempt replay conflict");
        return;
      }
      if (
        (status === "settled" && a.status !== "in_flight") ||
        (status === "not_sent" && a.status !== "reserved") ||
        (status === "not_sent" && lines.length !== 0)
      ) {
        throw new Error("Invalid paid attempt transition");
      }
      if (this.settings.reservedEur + 1e-9 < a.estimateEur) throw new Error("Reservation missing");
      if ((await this.usage.list()).some((e) => lines.some((l) => l.id === e.id)))
        throw new Error("Duplicate usage");
      for (const line of lines) await this.usage.insert(line);
      this.settings.reservedEur = Math.max(0, this.settings.reservedEur - a.estimateEur);
      this.attempts.set(id, {
        ...a,
        status,
        billingStatus: status === "settled" ? "estimate_unverified" : "not_charged",
        usageLines: structuredClone(lines),
      });
    },
    get: async (id: string) => {
      const a = this.attempts.get(id);
      return a ? structuredClone(a) : undefined;
    },
  };
  private counter = 1000;
  private locks = new Map<string, { token: string; expiresAt: number }>();

  constructor(seed: SeedData) {
    this.workspaceId = seed.settings.workspaceId;
    this.users = new MemoryCollection(seed.users);
    this.companies = new MemoryCollection(seed.companies);
    this.sources = new MemoryCollection(seed.sources);
    this.runs = new MemoryCollection(seed.runs);
    this.observations = new MemoryCollection(seed.observations);
    this.signals = new MemoryCollection(seed.signals);
    this.grids = new MemoryCollection(seed.grids);
    this.articles = new MemoryCollection(seed.articles);
    this.publications = new MemoryCollection(seed.publications);
    this.imports = new MemoryCollection(seed.imports);
    this.linkedin = new MemoryCollection(seed.linkedin);
    this.newsletters = new MemoryCollection(seed.newsletters);
    this.rules = new MemoryCollection(seed.rules);
    this.examples = new MemoryCollection(seed.examples);
    this.ruleProposals = new MemoryCollection(seed.ruleProposals);
    this.usage = new MemoryCollection(seed.usage);
    this.audit = new MemoryCollection(seed.audit);
    this.notifications = new MemoryCollection(seed.notifications);
    this.settings = structuredClone(seed.settings);
  }

  async getSettings() {
    return structuredClone(this.settings);
  }

  async saveSettings(settings: Settings) {
    const { wordpress: legacy, ...rest } = structuredClone(settings);
    if (legacy !== undefined) this.wordpress ??= wordpressSettingsOf(legacy);
    this.settings = rest;
  }

  async getWordPressSettings() {
    return structuredClone(this.wordpress ?? wordpressSettingsOf(this.settings.wordpress));
  }

  async saveWordPressSettings(settings: WordPressSettings) {
    this.wordpress = structuredClone(settings);
  }

  nextId(prefix: string) {
    this.counter += 1;
    return `${prefix}_n${this.counter}`;
  }

  async acquireLock(key: string, ttlMs: number) {
    const at = now().getTime();
    const held = this.locks.get(key);
    if (held && held.expiresAt > at) return null;
    const token = this.nextId("lock");
    this.locks.set(key, { token, expiresAt: at + ttlMs });
    return token;
  }

  async replaceLock(key: string, ttlMs: number) {
    const token = crypto.randomUUID();
    this.locks.set(key, { token, expiresAt: now().getTime() + ttlMs });
    return token;
  }

  async releaseLock(key: string, token: string) {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }
}

/** Incrémenter quand la forme des enregistrements change : le store est alors réinitialisé. */
const STORE_VERSION = 2;
const GLOBAL_KEY = "__koraNewsroomStore__";

interface Holder {
  version: number;
  repo: MemoryRepository;
  seededAt: string;
}

function holder(): Holder | undefined {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Holder | undefined;
}

/** Dépôt singleton (survit au rechargement à chaud du code serveur). */
export async function getRepository(): Promise<Repository> {
  if (usesDatabase()) {
    const g = globalThis as Record<string, unknown>;
    const db = (g["__koraDb__"] ??= new DbRepository()) as DbRepository;
    await db.ensureReady();
    return db;
  }
  const h = holder();
  if (h && h.version === STORE_VERSION) return h.repo;
  return resetStore();
}

/** Réinitialise le store à partir du seed déterministe (tests, démo). */
export function resetStore(opts: { now?: Date } = {}): Repository {
  const at = opts.now ?? now();
  const repo = new MemoryRepository(buildSeed(at));
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
    version: STORE_VERSION,
    repo,
    seededAt: at.toISOString(),
  } satisfies Holder;
  return repo;
}
