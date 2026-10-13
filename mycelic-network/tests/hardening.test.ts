import { describe, it, expect, vi } from "vitest";
import { PaymentStore } from "@/payments/store";
import { readJson, RequestGate } from "@/server/http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
describe("bounded request handling", () => {
  it("limits chunked byte length and validates UTF-8", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('"éé"'));
          c.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readJson(request, 5)).rejects.toMatchObject({ status: 413 });
    await expect(
      readJson(
        new Request("https://example.test", {
          method: "POST",
          body: new Uint8Array([34, 255, 34]),
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await readJson(
        new Request("https://example.test", {
          method: "POST",
          body: '{"ok":true}',
        }),
      ),
    ).toEqual({ ok: true });
  });
  it("rejects stalled request bodies", async () => {
    vi.useFakeTimers();
    try {
      const task = readJson(
        new Request("https://example.test", {
          method: "POST",
          body: new ReadableStream({ start() {} }),
          duplex: "half",
        } as RequestInit),
      );
      const assertion = expect(task).rejects.toMatchObject({ status: 408 });
      await vi.advanceTimersByTimeAsync(15000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it("releases a concurrency slot after failure", async () => {
    const gate = new RequestGate(1);
    let release!: () => void;
    const running = gate.run(() => new Promise<void>((r) => (release = r)));
    await expect(gate.run(async () => 1)).rejects.toMatchObject({
      status: 503,
    });
    release();
    await running;
    await expect(
      gate.run(async () => {
        throw new Error("failure");
      }),
    ).rejects.toThrow("failure");
    expect(await gate.run(async () => 2)).toBe(2);
  });
});
describe("durable admission and rate controls", () => {
  it("enforces capacity, renewals, expiration and stale release across reopening", () => {
    const directory = mkdtempSync(join(tmpdir(), "mycelic-leases-"));
    let store: PaymentStore | undefined;
    try {
      const path = join(directory, "ledger.sqlite");
      store = new PaymentStore(path);
      expect(store.acquireLease("room", "A", "old", 2, 1000)).toBe(true);
      expect(store.acquireLease("room", "B", "b", 2, 1000)).toBe(true);
      expect(store.acquireLease("room", "C", "c", 2, 1000)).toBe(false);
      expect(store.acquireLease("room", "a", "new", 2, 2000)).toBe(true);
      store.releaseLease("room", "A", "old");
      expect(store.hasLease("room", "a", 3000)).toBe(true);
      store.db.close();
      store = new PaymentStore(path);
      expect(store.leaseCount("room", 3000)).toBe(2);
      expect(store.acquireLease("room", "C", "c", 2, 46000)).toBe(true);
      expect(store.leaseCount("room", 46000)).toBe(2);
    } finally {
      store?.db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("isolates wallet rate windows and resets the next minute", () => {
    const store = new PaymentStore(":memory:");
    try {
      expect(store.rateLimit("A", "posts", 1, 1000)).toBe(true);
      expect(store.rateLimit("a", "posts", 1, 2000)).toBe(false);
      expect(store.rateLimit("B", "posts", 1, 2000)).toBe(true);
      expect(store.rateLimit("A", "posts", 1, 61000)).toBe(true);
    } finally {
      store.db.close();
    }
  });
});

describe("private deployment backups", () => {
  it("creates and verifies a consistent snapshot with the matching receipt key", async () => {
    const { execFileSync } = await import("node:child_process");
    const { generatePrivateKey } = await import("viem/accounts");
    const { readFileSync, statSync } = await import("node:fs");
    const directory = mkdtempSync(join(tmpdir(), "mycelic-backup-"));
    try {
      const target = join(directory, "new-parent", "snapshot");
      const env = {
        ...process.env,
        MYCELIC_DATA_DIR: join(directory, "data"),
        MYCELIC_RECEIPT_PRIVATE_KEY: generatePrivateKey(),
        MYCELIC_PAYMENT_ENV: "testnet",
        MYCELIC_SERVICE_ID: "backup-test",
        NODE_ENV: "production" as const,
      };
      const result = execFileSync(
        process.execPath,
        ["--import=tsx", "scripts/backup.ts", target],
        { env, encoding: "utf8" },
      );
      expect(JSON.parse(result).complete).toBe(true);
      expect(readFileSync(join(target, "receipt-key"), "utf8")).toBe(
        env.MYCELIC_RECEIPT_PRIVATE_KEY,
      );
      expect(statSync(join(target, "receipt-key")).mode & 0o777).toBe(0o600);
      const verified = execFileSync(
        process.execPath,
        ["--import=tsx", "scripts/verify-backup.ts", target],
        { encoding: "utf8" },
      );
      expect(JSON.parse(verified).verified).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
