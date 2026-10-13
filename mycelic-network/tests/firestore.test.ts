import { afterAll, describe, expect, it, vi } from "vitest";
import { Firestore } from "firebase-admin/firestore";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  BatchEvmScheme,
  CHAIN_CONFIGS,
} from "@circle-fin/x402-batching/client";
import { keccak256 } from "viem";
import { FirestorePaymentStore } from "@/payments/firestoreStore";
import { PaymentService } from "@/payments/service";
import { type GatewayProvider, type GatewayPayload } from "@/payments/gateway";
import { type PaymentRequirements, TREASURY } from "@/payments/shared";
import {
  canonical,
  chatProtocol,
  generateRoomSecret,
  type PaymentPolicy,
} from "@mycelic/room-protocol";
import { signRoom } from "@/access/roomAccess";
import { postKey } from "@/payments/ledger";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host))
  throw new Error(
    "Ledger integration tests require a local Firestore emulator",
  );
// Fixed demo project prevents accidentally contacting a funded production project.
const clients: Firestore[] = [];
function connect(namespace: string) {
  if (!host) throw new Error("Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8181");
  const db = new Firestore({ projectId: "demo-mycelic" });
  clients.push(db);
  return new FirestorePaymentStore(db, namespace);
}
afterAll(async () => {
  await Promise.all(clients.map((db) => db.terminate()));
});
async function fixture() {
  const issuerKey = generatePrivateKey();
  const wallet = privateKeyToAccount(generatePrivateKey()),
    issuer = privateKeyToAccount(issuerKey),
    session = privateKeyToAccount(generatePrivateKey());
  const policy: PaymentPolicy = {
    version: 1,
    serviceId: "tests.mycelic",
    issuer: issuer.address,
    treasury: TREASURY,
    environment: "testnet",
    createAmount: "3000000",
    postAmount: "12000",
  };
  const room = await signRoom(
    {
      hash: keccak256(`0x${generateRoomSecret()}`),
      title: "Firestore room",
      owner: wallet.address,
      createdAt: Date.now(),
      policy: { mode: "group", allowlist: [], inviteRequired: false },
      protocol: chatProtocol(true),
      payment: policy,
    },
    wallet,
  );
  const namespace = `test-${crypto.randomUUID()}`;
  const store = connect(namespace),
    other = connect(namespace);
  await store.pinPolicy(policy);
  const gateway: GatewayProvider = {
    requirements: async (amount) => [
      {
        scheme: "exact",
        network: "eip155:5042002",
        asset: CHAIN_CONFIGS.arcTestnet.usdc,
        amount,
        payTo: TREASURY,
        maxTimeoutSeconds: 604900,
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: CHAIN_CONFIGS.arcTestnet.gatewayWallet,
        },
      },
    ],
    settle: vi.fn(async (p) => ({
      success: true,
      payer: p.payload.authorization.from,
      network: "eip155:5042002",
      transaction: "accepted",
    })),
    reconcile: vi.fn(async () => null),
  };
  const service = new PaymentService(store, policy, issuer, gateway),
    second = new PaymentService(other, policy, issuer, gateway);
  const purchase = {
    id: crypto.randomUUID(),
    wallet: wallet.address,
    kind: "credits" as const,
    data: { pack: "10" },
    amount: "120000",
    url: "https://mycelic.test/api/rooms",
  };
  const challenge = await service.purchase(purchase);
  const body = challenge.body as {
    resource: GatewayPayload["resource"];
    accepts: PaymentRequirements[];
  };
  const signed = await new BatchEvmScheme(wallet).createPaymentPayload(
    2,
    body.accepts[0],
  );
  const payload = {
    ...signed,
    accepted: body.accepts[0],
    resource: body.resource,
  };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  const post = {
    room,
    wallet: wallet.address,
    session: session.address,
    messageId: crypto.randomUUID(),
    digest: `0x${"aa".repeat(32)}`,
  };
  return {
    store,
    other,
    service,
    second,
    gateway,
    purchase,
    header,
    payload,
    post,
    policy,
    room,
    wallet,
    issuerKey,
  };
}

describe.skipIf(!host)(
  "Firestore payment ledger across independent server clients",
  () => {
    it("credits a simultaneous purchase only once and reserves its nonce before submission", async () => {
      const f = await fixture();
      const result = await Promise.allSettled([
        f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
        f.second.purchase({ ...f.purchase, paymentHeader: f.header }),
      ]);
      expect(result.some((r) => r.status === "fulfilled")).toBe(true);
      expect(f.gateway.settle).toHaveBeenCalledOnce();
      expect(await f.other.balance(f.wallet.address)).toBe(120000);
      await f.second.purchase(f.purchase);
      expect(await f.store.balance(f.wallet.address)).toBe(120000);
    }, 30000);
    it("prevents concurrent overspending across server instances", async () => {
      const f = await fixture();
      await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) =>
          (index % 2 ? f.service : f.second).post({
            ...f.post,
            messageId: crypto.randomUUID(),
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason.status).toBe(402);
      expect(await f.other.balance(f.wallet.address)).toBe(0);
    }, 60000);
    it("retries the same post without another deduction and rejects changed identity/content", async () => {
      const f = await fixture();
      await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
      const results = await Promise.all([
        f.service.post(f.post),
        f.second.post(f.post),
      ]);
      expect(results[0].receipt).toEqual(results[1].receipt);
      expect(await f.store.balance(f.wallet.address)).toBe(108000);
      await expect(
        f.second.post({ ...f.post, digest: `0x${"bb".repeat(32)}` }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        f.second.post({ ...f.post, session: f.wallet.address }),
      ).rejects.toMatchObject({ status: 409 });
    }, 30000);
    it("recovers an interrupted payment with one fulfillment and no new settlement", async () => {
      const f = await fixture();
      f.gateway.settle = vi.fn(async () => {
        throw new Error("response lost");
      });
      await expect(
        f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
      ).rejects.toMatchObject({ code: "payment_pending" });
      expect(await f.other.balance(f.wallet.address)).toBe(0);
      f.gateway.reconcile = vi.fn(async () => ({
        payer: f.wallet.address,
        to: TREASURY,
        amount: f.purchase.amount,
        network: "eip155:5042002",
        status: "received",
        transaction: "accepted",
      }));
      await Promise.all([
        f.service.paymentStatus(
          f.wallet.address,
          f.purchase.id,
          f.purchase.url,
        ),
        f.second.paymentStatus(f.wallet.address, f.purchase.id, f.purchase.url),
      ]);
      expect(f.gateway.settle).toHaveBeenCalledOnce();
      expect(await f.other.balance(f.wallet.address)).toBe(120000);
    }, 30000);
    it("does not submit to Gateway when the ledger commit is interrupted", async () => {
      const f = await fixture();
      const original = f.store.transaction.bind(f.store);
      let count = 0;
      vi.spyOn(f.store, "transaction").mockImplementation(async (fn) => {
        if (++count === 2) throw new Error("database disconnected");
        return original(fn);
      });
      await expect(
        f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
      ).rejects.toMatchObject({ code: "ledger_unavailable" });
      expect(f.gateway.settle).not.toHaveBeenCalled();
      expect(await f.other.balance(f.wallet.address)).toBe(0);
    });
    it("reserves one creation intent for a room across servers", async () => {
      const f = await fixture();
      const purchase = {
        ...f.purchase,
        id: crypto.randomUUID(),
        kind: "create" as const,
        data: { room: f.room },
        amount: "3000000",
      };
      const results = await Promise.allSettled([
        f.service.purchase(purchase),
        f.second.purchase({ ...purchase, id: crypto.randomUUID() }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "creation_pending" },
      });
    }, 30000);
    it("cannot reuse a payment nonce for another intent", async () => {
      const f = await fixture();
      await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
      const purchase = { ...f.purchase, id: crypto.randomUUID() };
      const challenge = await f.second.purchase(purchase);
      const resource = (
        challenge.body as { resource: GatewayPayload["resource"] }
      ).resource;
      await expect(
        f.second.purchase({
          ...purchase,
          paymentHeader: Buffer.from(
            JSON.stringify({ ...f.payload, resource }),
          ).toString("base64"),
        }),
      ).rejects.toThrow("nonce");
      expect(f.gateway.settle).toHaveBeenCalledOnce();
    });
    it("shares capacity, lease renewals and rate windows across instances", async () => {
      const f = await fixture();
      await f.store.acquireLease("room", "a", "a", 2, 1000);
      const results = await Promise.all([
        f.other.acquireLease("room", "b", "b", 2, 1000),
        f.store.acquireLease("room", "c", "c", 2, 1000),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await f.other.leaseCount("room", 2000)).toBe(2);
      await f.other.acquireLease("room", "a", "new", 2, 2000);
      await f.store.releaseLease("room", "a", "a");
      expect(await f.other.hasLease("room", "a", 3000)).toBe(true);
      expect(await f.other.acquireLease("room", "d", "d", 2, 47000)).toBe(true);
      expect(await f.store.leaseCount("room", 47000)).toBe(1);
      const limits = await Promise.all([
        f.store.rateLimit("a", "posts", 1, 1000),
        f.other.rateLimit("A", "posts", 1, 1000),
      ]);
      expect(limits.filter(Boolean)).toHaveLength(1);
    }, 30000);
    it("pins identity and rolls back partial deductions", async () => {
      const f = await fixture();
      await expect(
        f.other.pinPolicy({ ...f.policy, serviceId: "other" }),
      ).rejects.toThrow("identity");
      await expect(
        f.store.transaction(async (tx) => {
          tx.set("credits", "wallet", { wallet: "wallet", amount: 100 });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await f.other.balance("wallet")).toBe(0);
      await f.store.transaction(async (tx) =>
        tx.set("settings", "sqlite-import", {
          name: "sqlite-import",
          value: JSON.stringify({ status: "pending" }),
        }),
      );
      await expect(f.other.pinPolicy(f.policy)).rejects.toThrow("migration");
      await expect(f.service.post(f.post)).rejects.toMatchObject({
        status: 402,
      });
      expect(
        await f.other.get("posts", postKey(f.room.hash, f.post.messageId)),
      ).toBeUndefined();
    });
    it("imports a frozen SQLite ledger without losing credits, receipts or nonce ownership", async () => {
      const { PaymentStore } = await import("@/payments/store");
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const f = await fixture();
      const directory = await mkdtemp(join(tmpdir(), "mycelic-import-"));
      const path = join(directory, "ledger.sqlite");
      const sqlite = new PaymentStore(path);
      try {
        await sqlite.pinPolicy(f.policy);
        const service = new PaymentService(
          sqlite,
          f.policy,
          privateKeyToAccount(f.issuerKey),
          f.gateway,
        );
        await service.purchase({ ...f.purchase, paymentHeader: f.header });
        const posted = await service.post(f.post);
        const creation = {
          ...f.purchase,
          id: crypto.randomUUID(),
          kind: "create" as const,
          data: { room: f.room },
          amount: "3000000",
        };
        const challenge = (await service.purchase(creation)).body as {
          resource: GatewayPayload["resource"];
          accepts: PaymentRequirements[];
        };
        const signed = await new BatchEvmScheme(f.wallet).createPaymentPayload(
          2,
          challenge.accepts[0],
        );
        await service.purchase({
          ...creation,
          paymentHeader: Buffer.from(
            JSON.stringify({
              ...signed,
              accepted: challenge.accepts[0],
              resource: challenge.resource,
            }),
          ).toString("base64"),
        });
        await sqlite.close();
        const namespace = `import-${crypto.randomUUID()}`;
        const target = connect(`${namespace}-testnet`);
        const env = {
          ...process.env,
          FIREBASE_PROJECT_ID: "demo-mycelic",
          MYCELIC_FIRESTORE_NAMESPACE: namespace,
          MYCELIC_PAYMENT_ENV: "testnet",
          MYCELIC_ENABLE_MAINNET: "false",
          MYCELIC_RECEIPT_PRIVATE_KEY: f.issuerKey,
          MYCELIC_SERVICE_ID: f.policy.serviceId,
          MYCELIC_TREASURY_ADDRESS: TREASURY,
          VERCEL: "",
        };
        const args = [
          "--import=tsx",
          "scripts/migrate-firestore.ts",
          path,
          "--writers-stopped",
        ];
        const result = await promisify(execFile)(process.execPath, args, {
          env,
        });
        expect(JSON.parse(result.stdout)).toMatchObject({
          imported: true,
          paymentsMade: 0,
          counts: { rooms: 1, credits: 1, posts: 1, intents: 2, nonces: 2 },
        });
        expect(await target.balance(f.wallet.address)).toBe(108000);
        expect(
          JSON.parse(
            (await target.get("posts", postKey(f.room.hash, f.post.messageId)))!
              .receipt,
          ),
        ).toEqual(posted.receipt);
        expect(await target.get("rooms", f.room.hash)).toBeTruthy();
        await target.pinPolicy(f.policy);
        await expect(
          promisify(execFile)(process.execPath, args, { env }),
        ).rejects.toThrow("already imported");
        expect(await target.balance(f.wallet.address)).toBe(108000);
      } finally {
        if (sqlite.db.isOpen) await sqlite.close();
        await rm(directory, { recursive: true, force: true });
      }
    }, 30000);
    it("keeps environments separate and metadata readable after reconnecting", async () => {
      const f = await fixture();
      await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
      const reopened = connect(f.store.namespace);
      expect(await reopened.balance(f.wallet.address)).toBe(120000);
      const isolated = connect(`${f.store.namespace}-other`);
      expect(await isolated.balance(f.wallet.address)).toBe(0);
      const record = await reopened.get("intents", f.purchase.id);
      expect(record?.status).toBe("accepted");
      expect(canonical(record)).not.toContain("Private message");
    });
  },
);
