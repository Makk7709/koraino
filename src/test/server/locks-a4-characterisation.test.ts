import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conflict } from "@/server/http";
import { setClock } from "@/server/clock";
import { withLock } from "@/server/services/locks";
import { setup, teardown, NOW } from "./helpers";

describe("A4 - caractérisation de l'expiration des verrous", () => {
  let instant: number;
  beforeEach(() => {
    instant = NOW.getTime();
    setup();
    setClock(() => new Date(instant));
  });
  afterEach(teardown);

  it("constate un chevauchement après expiration et conserve le verrou du second détenteur", async () => {
    const repo = setup();
    setClock(() => new Date(instant));
    let unlockFirst!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      unlockFirst = resolve;
    });
    const options = { ttlMs: 1000, busy: () => conflict("busy", "busy") };
    let firstFinished = false;
    let secondToken: string | null = null;
    const first = withLock(repo, "a4-test", options, async () => {
      signalStarted();
      await pending;
      firstFinished = true;
    });
    await started;
    expect(await repo.acquireLock("a4-test", 1000)).toBeNull();
    instant += 1001;
    secondToken = await repo.acquireLock("a4-test", 1000);
    expect(secondToken).not.toBeNull();
    expect(firstFinished).toBe(false);
    unlockFirst();
    await first;
    expect(await repo.acquireLock("a4-test", 1000)).toBeNull();
    await repo.releaseLock("a4-test", secondToken!);
    expect(await repo.acquireLock("a4-test", 1000)).not.toBeNull();
  });
});
