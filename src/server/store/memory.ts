import { isDeepStrictEqual } from "node:util";
import type { ArticleGenerationsRepository } from "./article-generations";
import type { SignalMutationsRepository } from "./signal-mutations";
import type { ArticleRecord, SignalRecord } from "./records";
import type { IdempotencyRecord, IdempotencyClaim } from "../services/http-idempotency";
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

  constructor(
    initial: T[],
    private validateWrite?: (item: T, previous: T | undefined) => void,
  ) {
    for (const item of initial) this.items.set(item.id, structuredClone(item));
  }

  read(id: string) {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  all() {
    return Array.from(this.items.values(), (item) => structuredClone(item));
  }

  async get(id: string) {
    return this.read(id);
  }
  async list() {
    return this.all();
  }

  insertSync(item: T) {
    if (this.items.has(item.id)) throw new Error(`Doublon d'identifiant : ${item.id}`);
    this.validateWrite?.(item, undefined);
    this.items.set(item.id, structuredClone(item));
    return item;
  }

  async insert(item: T) {
    return this.insertSync(item);
  }

  updateSync(item: T) {
    if (!this.items.has(item.id)) throw new Error(`Enregistrement absent : ${item.id}`);
    this.validateWrite?.(item, this.read(item.id));
    this.items.set(item.id, structuredClone(item));
    return item;
  }

  async update(item: T) {
    return this.updateSync(item);
  }

  async remove(id: string) {
    return this.items.delete(id);
  }

  /** Internal commit-only write; validated against an entire precomputed transaction. */
  replaceCommitted(item: T | null, id: string) {
    if (item) this.items.set(id, structuredClone(item));
    else this.items.delete(id);
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
  private readonly httpOps = new Map<
    string,
    IdempotencyRecord & {
      workspaceId: string;
      actorId: string;
      route: string;
      fingerprint: string;
    }
  >();
  idempotency = {
    begin: async (input: {
      id: string;
      workspaceId: string;
      actorId: string;
      route: string;
      fingerprint: string;
    }): Promise<IdempotencyClaim> => {
      const existing = this.httpOps.get(input.id);
      if (!existing) {
        this.httpOps.set(input.id, { ...input, state: "pending" });
        return { kind: "claimed" };
      }
      if (
        existing.workspaceId !== input.workspaceId ||
        existing.actorId !== input.actorId ||
        existing.route !== input.route ||
        existing.fingerprint !== input.fingerprint
      )
        return { kind: "conflict" };
      if (existing.state === "completed")
        return { kind: "completed", status: existing.httpStatus!, bodyText: existing.bodyText! };
      return { kind: existing.state };
    },
    complete: async (id: string, status: number, bodyText: string): Promise<void> => {
      const r = this.httpOps.get(id);
      if (!r) throw new Error("Missing idempotency claim");
      if (r.state === "completed" && r.httpStatus === status && r.bodyText === bodyText) return;
      if (r.state !== "pending") throw new Error("Idempotency state conflict");
      this.httpOps.set(id, { ...r, state: "completed", httpStatus: status, bodyText });
    },
    uncertain: async (id: string): Promise<void> => {
      const r = this.httpOps.get(id);
      if (!r) throw new Error("Missing idempotency claim");
      if (r.state === "completed") throw new Error("Completed operation cannot be uncertain");
      this.httpOps.set(id, { ...r, state: "uncertain" });
    },
    get: async (id: string): Promise<IdempotencyRecord | undefined> => {
      const r = this.httpOps.get(id);
      return r ? structuredClone(r) : undefined;
    },
  };
  private reservePaid(attempt: PaidAttemptInput): ReserveResult {
    paidAttemptSchema.parse(attempt);
    if (this.attempts.has(attempt.id)) throw new Error("Duplicate paid attempt");
    const spentEur = monthTotals(this.usage.all(), attempt.month).costEur;
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
  }
  paidAttempts = {
    reserve: async (attempt: PaidAttemptInput): Promise<ReserveResult> => this.reservePaid(attempt),
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
      if (a.status === "unknown") {
        if (a.failureCode === code) return;
        throw new Error("Conflicting unknown-state replay");
      }
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
  private generations = new Map<
    string,
    {
      token: string;
      attemptId: string;
      signal: SignalRecord;
      state: "reserved" | "in_flight" | "uncertain" | "completed";
      article?: ArticleRecord;
    }
  >();
  articleGenerations: ArticleGenerationsRepository = {
    reserve: async (claim, attempt) => {
      if (
        !claim.token ||
        attempt.workspaceId !== this.workspaceId ||
        attempt.kind !== "generation_article"
      )
        throw new Error("Invalid article generation claim");
      const signal = this.signals.read(claim.signal.id);
      if (!signal || !isDeepStrictEqual(signal, claim.signal) || signal.status === "rejete")
        return { blocked: "signal_changed" };
      if (this.articles.all().some((a) => a.signalId === signal.id))
        return { blocked: "article_exists" };
      if (this.generations.has(signal.id)) return { blocked: "busy" };
      // No await between the claim check, budget reservation and claim write.
      const result = this.reservePaid(attempt);
      if (!result.ok) return result;
      this.generations.set(signal.id, {
        token: claim.token,
        attemptId: attempt.id,
        signal,
        state: "reserved",
      });
      return result;
    },
    start: async (signalId, token, attemptId) => {
      const op = this.generations.get(signalId);
      const paid = this.attempts.get(attemptId);
      if (
        !op ||
        op.token !== token ||
        op.attemptId !== attemptId ||
        op.state !== "reserved" ||
        paid?.status !== "reserved"
      )
        throw new Error("Article generation ownership conflict");
      this.attempts.set(attemptId, { ...paid, status: "in_flight", billingStatus: "unknown" });
      this.generations.set(signalId, { ...op, state: "in_flight" });
    },
    complete: async (signalId, token, article) => {
      const op = this.generations.get(signalId);
      if (!op || op.token !== token) throw new Error("Article generation ownership conflict");
      if (op.state === "completed") {
        if (isDeepStrictEqual(op.article, article)) return;
        throw new Error("Article generation replay conflict");
      }
      if (op.state !== "in_flight") throw new Error("Article generation not in flight");
      if (
        !article.id ||
        article.signalId !== signalId ||
        article.origin !== "kora" ||
        article.status !== "brouillon" ||
        article.currentVersion !== 1 ||
        article.versions.length !== 1 ||
        !article.updatedAt
      )
        throw new Error("Invalid generated article");
      const paid = this.attempts.get(op.attemptId);
      if (
        !paid ||
        !["settled", "unknown", "reconciled_billed", "reconciled_not_billed"].includes(paid.status)
      )
        throw new Error("Article generation accounting incomplete");
      const signal = this.signals.read(signalId);
      if (!signal || !isDeepStrictEqual(signal, op.signal))
        throw new Error("Article generation signal changed");
      const saved = structuredClone(article);
      const nextSignal = {
        ...signal,
        articleId: article.id,
        status: signal.status === "traite" ? ("traite" as const) : ("en_revue" as const),
        updatedAt: article.updatedAt,
      };
      // All validation above; synchronous writes cannot interleave with another request.
      this.articles.insertSync(saved);
      this.signals.updateSync(nextSignal);
      this.generations.set(signalId, { ...op, state: "completed", article: saved });
    },
    uncertain: async (signalId, token) => {
      const op = this.generations.get(signalId);
      if (op?.token === token && op.state !== "completed")
        this.generations.set(signalId, { ...op, state: "uncertain" });
    },
  };
  signalMutations: SignalMutationsRepository = {
    commit: async (changes) => {
      if (!changes.length || changes.length > 2000)
        throw new Error("Invalid signal transaction size");
      const stores = {
        signals: this.signals,
        observations: this.observations,
        articles: this.articles,
        linkedin: this.linkedin,
        newsletters: this.newsletters,
        audit: this.audit,
      };
      const seen = new Set<string>();
      const final = new Map<string, Map<string, { id: string }>>();
      for (const [name, store] of Object.entries(stores)) {
        final.set(name, new Map(store.all().map((item) => [item.id, item])));
      }
      for (const change of changes) {
        const key = `${change.collection}:${change.id}`;
        if (seen.has(key)) throw new Error("Duplicate signal transaction row");
        seen.add(key);
        const store = stores[change.collection] as unknown as MemoryCollection<{ id: string }>;
        const current = store.read(change.id) ?? null;
        if (!isDeepStrictEqual(current, change.before))
          throw new Error("Signal transaction state changed");
        if (change.after && change.after.id !== change.id)
          throw new Error("Signal transaction identifier mismatch");
        if (change.collection === "signals" && this.generations.has(change.id))
          throw new Error("Article generation ownership prevents signal mutation");
        const entries = final.get(change.collection)!;
        if (change.after) entries.set(change.id, change.after);
        else entries.delete(change.id);
      }
      const signals = final.get("signals")!;
      const articles = final.get("articles")!;
      const signalIds = new Set(
        changes
          .flatMap((c) =>
            c.collection === "articles"
              ? [c.before?.signalId, c.after?.signalId]
              : c.collection === "signals"
                ? [c.id]
                : [],
          )
          .filter((id): id is string => !!id),
      );
      for (const signalId of signalIds) {
        const linked = [...articles.values()].filter(
          (a) => "signalId" in a && a.signalId === signalId,
        );
        if (linked.length > 1) throw new Error("Article already exists for signal");
        if (linked.length && !signals.has(signalId)) throw new Error("Article signal missing");
      }
      // There is no await between validation and publication of these prepared mutations.
      for (const change of changes) {
        const store = stores[change.collection] as unknown as MemoryCollection<{ id: string }>;
        store.replaceCommitted(change.after, change.id);
      }
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
    this.signals = new MemoryCollection(seed.signals, (item, previous) => {
      if (
        previous &&
        this.generations.get(item.id)?.state === "completed" &&
        previous.articleId !== item.articleId
      )
        throw new Error("Completed article association is immutable");
    });
    this.grids = new MemoryCollection(seed.grids);
    this.articles = new MemoryCollection(seed.articles, (item, previous) => {
      if (item.signalId && item.signalId !== previous?.signalId) {
        if (!this.signals.read(item.signalId)) throw new Error("Article signal missing");
        if (this.articles.all().some((a) => a.id !== item.id && a.signalId === item.signalId))
          throw new Error("Article already exists for signal");
      }
    });
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
