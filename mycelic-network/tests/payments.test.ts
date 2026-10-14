import { describe, it, expect, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  BatchEvmScheme,
  CHAIN_CONFIGS,
} from "@circle-fin/x402-batching/client";
import { keccak256 } from "viem";
import { PaymentStore } from "@/payments/store";
import { PaymentService } from "@/payments/service";
import { type GatewayProvider, type GatewayPayload } from "@/payments/gateway";
import { type PaymentRequirements, TREASURY } from "@/payments/shared";
import {
  canonical,
  chatProtocol,
  generateRoomSecret,
  messageDigest,
  roomDigest,
  verifyPaymentReceipt,
  assertPaymentPolicy,
  type PaymentPolicy,
} from "@mycelic/room-protocol";
import { signRoom } from "@/access/roomAccess";
import { verifyRecord } from "@/mesh/ChatMesh";
async function fixture() {
  const wallet = privateKeyToAccount(generatePrivateKey()),
    issuer = privateKeyToAccount(generatePrivateKey()),
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
      title: "Paid room",
      owner: wallet.address,
      createdAt: Date.now(),
      policy: { mode: "group", allowlist: [], inviteRequired: false },
      protocol: chatProtocol(true),
      payment: policy,
    },
    wallet,
  );
  const store = new PaymentStore(":memory:");
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
  const service = new PaymentService(store, policy, issuer, gateway);
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
    resource: { url: string; description: string; mimeType: string };
    accepts: PaymentRequirements[];
  };
  const signed = await new BatchEvmScheme(wallet).createPaymentPayload(
    2,
    body.accepts[0],
  );
  const payload: GatewayPayload = {
    ...signed,
    x402Version: 2,
    accepted: body.accepts[0],
    resource: body.resource,
  };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  const certBody = {
    roomHash: room.hash,
    identity: wallet.address,
    session: session.address,
    expiresAt: Date.now() + 3600000,
  };
  const certificate = {
    ...certBody,
    signature: await wallet.signMessage({ message: canonical(certBody) }),
  };
  const msgBody = {
    id: crypto.randomUUID(),
    roomHash: room.hash,
    sender: wallet.address,
    session: session.address,
    text: "Private message",
    createdAt: Date.now(),
  };
  const message = {
    ...msgBody,
    signature: await session.signMessage({ message: canonical(msgBody) }),
  };
  return {
    wallet,
    issuer,
    session,
    room,
    store,
    gateway,
    service,
    purchase,
    challenge,
    payload,
    header,
    certificate,
    message,
  };
}
describe("Gateway payments and posting ledger", () => {
  it("returns a real x402 challenge and does not issue credits before acceptance", async () => {
    const f = await fixture();
    expect(f.challenge.status).toBe(402);
    expect(f.challenge.headers?.["PAYMENT-REQUIRED"]).toBeTruthy();
    expect(await f.store.balance(f.wallet.address)).toBe(0);
    expect(f.gateway.settle).not.toHaveBeenCalled();
    f.store.db.close();
  });
  it("credits once, returns the original result on retries, and never settles twice", async () => {
    const f = await fixture();
    const result = await f.service.purchase({
      ...f.purchase,
      paymentHeader: f.header,
    });
    expect(result.status).toBe(200);
    expect(await f.store.balance(f.wallet.address)).toBe(120000);
    await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
    expect(await f.store.balance(f.wallet.address)).toBe(120000);
    expect(f.gateway.settle).toHaveBeenCalledOnce();
    f.store.db.close();
  });
  it("rejects forged signatures and treasury/amount changes without calling Gateway", async () => {
    const f = await fixture();
    for (const mutation of [
      {
        ...f.payload,
        payload: { ...f.payload.payload, signature: `0x${"00".repeat(65)}` },
      },
      {
        ...f.payload,
        payload: {
          ...f.payload.payload,
          authorization: {
            ...f.payload.payload.authorization,
            to: f.issuer.address,
          },
        },
      },
      {
        ...f.payload,
        accepted: { ...(f.payload.accepted as object), amount: "1" },
      },
    ]) {
      await expect(
        f.service.purchase({
          ...f.purchase,
          paymentHeader: Buffer.from(JSON.stringify(mutation)).toString(
            "base64",
          ),
        }),
      ).rejects.toThrow();
    }
    expect(f.gateway.settle).not.toHaveBeenCalled();
    expect(await f.store.balance(f.wallet.address)).toBe(0);
    f.store.db.close();
  });
  it("a payment nonce cannot fund a second intent", async () => {
    const f = await fixture();
    await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
    const other = { ...f.purchase, id: crypto.randomUUID() };
    const challenge = await f.service.purchase(other);
    const changed = {
      ...f.payload,
      resource: (challenge.body as { resource: GatewayPayload["resource"] })
        .resource,
    };
    await expect(
      f.service.purchase({
        ...other,
        paymentHeader: Buffer.from(JSON.stringify(changed)).toString("base64"),
      }),
    ).rejects.toThrow("nonce");
    expect(await f.store.balance(f.wallet.address)).toBe(120000);
    f.store.db.close();
  });
  it("deducts each post once and rejects changed content using the same id", async () => {
    const f = await fixture();
    await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
    const post = {
      room: f.room,
      wallet: f.wallet.address,
      session: f.session.address,
      messageId: f.message.id,
      digest: messageDigest(f.message),
    };
    const result = await f.service.post(post);
    await f.service.post(post);
    expect(await f.store.balance(f.wallet.address)).toBe(108000);
    await expect(
      f.service.post({ ...post, digest: `0x${"aa".repeat(32)}` }),
    ).rejects.toThrow("reused");
    expect(
      await verifyRecord(
        {
          message: f.message,
          certificate: f.certificate,
          receipt: result.receipt,
        },
        f.room,
      ),
    ).toBeTruthy();
    f.store.db.close();
  });
  it("peers reject unpaid messages and forged receipts from the room creator", async () => {
    const f = await fixture();
    await expect(
      verifyRecord({ message: f.message, certificate: f.certificate }, f.room),
    ).rejects.toThrow();
    await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
    const { receipt } = await f.service.post({
      room: f.room,
      wallet: f.wallet.address,
      session: f.session.address,
      messageId: f.message.id,
      digest: messageDigest(f.message),
    });
    const fake = {
      ...receipt,
      signature: await f.wallet.signMessage({
        message: canonical({ ...receipt, signature: undefined }),
      }),
    };
    await expect(
      verifyRecord(
        { message: f.message, certificate: f.certificate, receipt: fake },
        f.room,
      ),
    ).rejects.toThrow("receipt signature");
    await expect(
      verifyRecord(
        {
          message: f.message,
          certificate: f.certificate,
          receipt: { ...receipt, messageId: crypto.randomUUID() },
        },
        f.room,
      ),
    ).rejects.toThrow("mismatch");
    f.store.db.close();
  });
  it("insufficient credit cannot issue a posting receipt", async () => {
    const f = await fixture();
    await expect(
      f.service.post({
        room: f.room,
        wallet: f.wallet.address,
        session: f.session.address,
        messageId: f.message.id,
        digest: messageDigest(f.message),
      }),
    ).rejects.toThrow("exhausted");
    expect(f.store.db.prepare("SELECT * FROM posts").all()).toHaveLength(0);
    f.store.db.close();
  });
  it("reconciles an interrupted acceptance without another authorization", async () => {
    const f = await fixture();
    f.gateway.settle = vi.fn(async () => {
      throw new Error("Response lost");
    });
    await expect(
      f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
    ).rejects.toThrow("interrupted");
    expect(await f.store.balance(f.wallet.address)).toBe(0);
    f.gateway.reconcile = vi.fn(async () => ({
      payer: f.wallet.address,
      to: TREASURY,
      amount: "120000",
      network: "eip155:5042002",
      status: "received",
      transaction: "accepted",
    }));
    const result = await f.service.purchase(f.purchase);
    expect(result.status).toBe(200);
    expect(await f.store.balance(f.wallet.address)).toBe(120000);
    expect(f.gateway.settle).toHaveBeenCalledOnce();
    f.store.db.close();
  });
  it("fails closed while acceptance remains uncertain", async () => {
    const f = await fixture();
    f.gateway.settle = vi.fn(async () => {
      throw new Error("timeout");
    });
    await expect(
      f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
    ).rejects.toThrow();
    await expect(
      f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
    ).rejects.toThrow("pending");
    expect(f.gateway.settle).toHaveBeenCalledOnce();
    expect(await f.store.balance(f.wallet.address)).toBe(0);
    f.store.db.close();
  });
  it("creation issues a verifiable authorization only after accepted payment", async () => {
    const f = await fixture();
    const purchase = {
      ...f.purchase,
      id: crypto.randomUUID(),
      kind: "create" as const,
      data: { room: f.room },
      amount: "3000000",
    };
    const challenge = await f.service.purchase(purchase);
    const body = challenge.body as {
      resource: GatewayPayload["resource"];
      accepts: PaymentRequirements[];
    };
    const signed = await new BatchEvmScheme(f.wallet).createPaymentPayload(
      2,
      body.accepts[0],
    );
    const result = await f.service.purchase({
      ...purchase,
      paymentHeader: Buffer.from(
        JSON.stringify({
          ...signed,
          accepted: body.accepts[0],
          resource: body.resource,
        }),
      ).toString("base64"),
    });
    const receipt = (result.body as { creationReceipt: unknown })
      .creationReceipt;
    const row = f.store.db.prepare("SELECT * FROM rooms").get();
    expect(row).toBeTruthy();
    expect(
      await verifyPaymentReceipt(receipt, f.room.payment!, {
        purpose: "create",
        roomHash: f.room.hash,
        sender: f.wallet.address,
        session: f.wallet.address,
        messageId: purchase.id,
        digest: roomDigest(f.room),
      }),
    ).toBeTruthy();
    expect(() =>
      assertPaymentPolicy(
        {
          ...f.room,
          payment: { ...f.room.payment!, issuer: f.wallet.address },
        },
        f.service.policy,
      ),
    ).toThrow("policy");
    f.store.db.close();
  });
  it("serializes concurrent charges and cannot overspend a ten-post pack", async () => {
    const f = await fixture();
    await f.service.purchase({ ...f.purchase, paymentHeader: f.header });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        f.service.post({
          room: f.room,
          wallet: f.wallet.address,
          session: f.session.address,
          messageId: crypto.randomUUID(),
          digest: messageDigest(f.message),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(await f.store.balance(f.wallet.address)).toBe(0);
    f.store.db.close();
  });
});

describe("durable credit recovery", () => {
  it("retains wallet balances and idempotency records after reopening the database", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = mkdtempSync(join(tmpdir(), "mycelic-ledger-"));
    const path = join(directory, "ledger.sqlite");
    try {
      const store = new PaymentStore(path);
      store.db
        .prepare("INSERT INTO credits(wallet,amount) VALUES(?,?)")
        .run("wallet", 108000);
      store.db
        .prepare("INSERT INTO posts(room,id,digest,receipt) VALUES(?,?,?,?)")
        .run("room", "post", "digest", "receipt");
      store.db.close();
      const recovered = new PaymentStore(path);
      expect(await recovered.balance("wallet")).toBe(108000);
      expect(recovered.db.prepare("SELECT id FROM posts").get()).toEqual({
        id: "post",
      });
      recovered.db.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("payment recovery hardening", () => {
  it("reserves one creation intent atomically and allows unpaid expiration", async () => {
    const f = await fixture();
    try {
      const purchase = {
        ...f.purchase,
        id: crypto.randomUUID(),
        kind: "create" as const,
        data: { room: f.room },
        amount: "3000000",
      };
      const results = await Promise.allSettled([
        f.service.purchase(purchase),
        f.service.purchase({ ...purchase, id: crypto.randomUUID() }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: {
          code: "creation_pending",
          details: { intentId: purchase.id },
        },
      });
      f.store.db
        .prepare("UPDATE intents SET expires=0 WHERE id=?")
        .run(purchase.id);
      expect(
        (await f.service.purchase({ ...purchase, id: crypto.randomUUID() }))
          .status,
      ).toBe(402);
      expect(f.gateway.settle).not.toHaveBeenCalled();
    } finally {
      f.store.db.close();
    }
  });
  it("checks pending payments without signing or settling again and restricts the owner", async () => {
    const f = await fixture();
    try {
      f.gateway.settle = vi.fn(async () => ({
        success: false,
        errorReason: "nonce_already_used",
        network: "eip155:5042002",
        transaction: "",
      }));
      await expect(
        f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
      ).rejects.toMatchObject({ code: "payment_pending" });
      await expect(
        f.service.paymentStatus(
          f.issuer.address,
          f.purchase.id,
          f.purchase.url,
        ),
      ).rejects.toMatchObject({ status: 404 });
      f.gateway.reconcile = vi.fn(async () => ({
        payer: f.wallet.address,
        to: TREASURY,
        amount: "120000",
        network: "eip155:5042002",
        status: "received",
        transaction: "ok",
      }));
      expect(
        await f.service.paymentStatus(
          f.wallet.address,
          f.purchase.id,
          f.purchase.url,
        ),
      ).toMatchObject({ status: "accepted", balance: 120000 });
      await f.service.paymentStatus(
        f.wallet.address,
        f.purchase.id,
        f.purchase.url,
      );
      expect(f.gateway.settle).toHaveBeenCalledOnce();
      expect(await f.store.balance(f.wallet.address)).toBe(120000);
    } finally {
      f.store.db.close();
    }
  });
  it("pins ledger identity and rejects changed receipt signers", async () => {
    const f = await fixture();
    try {
      await f.store.pinPolicy(f.room.payment!);
      await f.store.pinPolicy(f.room.payment!);
      await expect(
        f.store.pinPolicy({ ...f.room.payment!, issuer: f.wallet.address }),
      ).rejects.toThrow("identity");
    } finally {
      f.store.db.close();
    }
  });
});

describe("Gateway rejection handling", () => {
  it("blocks a new self-transfer before reserving an intent or requesting payment", async () => {
    const f = await fixture();
    try {
      f.service.policy.treasury = f.wallet.address;
      await expect(
        f.service.purchase({ ...f.purchase, id: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "payment_self_transfer" });
      expect(await f.store.list("intents")).toHaveLength(1);
      expect(f.gateway.settle).not.toHaveBeenCalled();
      expect(await f.store.balance(f.wallet.address)).toBe(0);
    } finally {
      await f.store.close();
    }
  });
  it("blocks a browser self-transfer before asking the wallet for its payment signature", async () => {
    const f = await fixture();
    try {
      const { signGatewayChallenge } = await import("@/payments/client");
      const signTypedData = vi.fn();
      const config = CHAIN_CONFIGS.arcTestnet;
      await expect(
        signGatewayChallenge(
          f.challenge.body as Parameters<typeof signGatewayChallenge>[0],
          {
            policy: f.service.policy,
            enabled: true,
            preferredChain: "arcTestnet",
            maxParticipants: 8,
            networks: [
              {
                key: "arcTestnet",
                name: config.chain.name,
                chainId: config.chain.id,
                domain: config.domain,
                usdc: config.usdc,
                gatewayWallet: config.gatewayWallet,
                rpc: config.chain.rpcUrls.default.http[0],
              },
            ],
          },
          { address: TREASURY, signTypedData },
          "arcTestnet",
          "120000",
        ),
      ).rejects.toThrow("wallet to itself");
      expect(signTypedData).not.toHaveBeenCalled();
    } finally {
      await f.store.close();
    }
  });
  it("recovers an old pending self-transfer without another settlement and retains its nonce", async () => {
    const f = await fixture();
    try {
      f.service.policy.treasury = f.wallet.address;
      const selected = {
        ...(f.challenge.body as { accepts: PaymentRequirements[] }).accepts[0],
        payTo: f.wallet.address,
      };
      const signed = await new BatchEvmScheme(f.wallet).createPaymentPayload(
        2,
        selected,
      );
      const payload = {
        ...signed,
        accepted: selected,
        resource: (f.challenge.body as { resource: GatewayPayload["resource"] })
          .resource,
      };
      const nonce = signed.payload.authorization.nonce.toLowerCase();
      await f.store.transaction(async (tx) => {
        const current = (await tx.get("intents", f.purchase.id))!;
        tx.set("intents", current.id, {
          ...current,
          status: "pending",
          nonce,
          payload: JSON.stringify({ payload, selected }),
        });
        tx.set("nonces", nonce, { nonce, intent: current.id });
      });
      await expect(f.service.purchase(f.purchase)).rejects.toMatchObject({
        code: "payment_self_transfer",
      });
      expect(await f.store.get("intents", f.purchase.id)).toMatchObject({
        status: "failed",
        error: "self_transfer",
        result: null,
      });
      expect(await f.store.get("nonces", nonce)).toMatchObject({
        intent: f.purchase.id,
      });
      expect(f.gateway.reconcile).toHaveBeenCalledOnce();
      expect(f.gateway.settle).not.toHaveBeenCalled();
      expect(await f.store.balance(f.wallet.address)).toBe(0);
    } finally {
      await f.store.close();
    }
  });
  it.each([
    "insufficient_balance",
    "authorization_expired",
    "authorization_validity_too_short",
    "self_transfer",
    "unsupported_network",
  ])(
    "records definitive rejection %s instead of leaving it pending",
    async (reason) => {
      const f = await fixture();
      try {
        f.gateway.settle = vi.fn(async () => ({
          success: false,
          errorReason: reason,
          transaction: "",
          network: "eip155:5042002",
        }));
        await expect(
          f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
        ).rejects.toMatchObject({
          code:
            reason === "self_transfer"
              ? "payment_self_transfer"
              : "payment_rejected",
        });
        expect(await f.store.get("intents", f.purchase.id)).toMatchObject({
          status: "failed",
          error: reason,
          result: null,
        });
        expect(await f.store.balance(f.wallet.address)).toBe(0);
      } finally {
        await f.store.close();
      }
    },
  );
  it.each(["nonce_already_used", "unexpected_error", "unrecognized_reason"])(
    "keeps uncertain rejection %s pending and records the reason",
    async (reason) => {
      const f = await fixture();
      try {
        f.gateway.settle = vi.fn(async () => ({
          success: false,
          errorReason: reason,
          transaction: "",
          network: "eip155:5042002",
        }));
        await expect(
          f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
        ).rejects.toMatchObject({ code: "payment_pending" });
        expect(await f.store.get("intents", f.purchase.id)).toMatchObject({
          status: "pending",
          error: `Gateway: ${reason}`,
          result: null,
        });
        await expect(f.service.purchase(f.purchase)).rejects.toMatchObject({
          code: "payment_pending",
        });
        expect(f.gateway.settle).toHaveBeenCalledOnce();
      } finally {
        await f.store.close();
      }
    },
  );
  it("keeps a response with a transfer identifier pending even if its reason looks definitive", async () => {
    const f = await fixture();
    try {
      f.gateway.settle = vi.fn(async () => ({
        success: false,
        errorReason: "insufficient_balance",
        transaction: "existing-transfer",
        network: "eip155:5042002",
      }));
      await expect(
        f.service.purchase({ ...f.purchase, paymentHeader: f.header }),
      ).rejects.toMatchObject({ code: "payment_pending" });
      expect((await f.store.get("intents", f.purchase.id))?.status).toBe(
        "pending",
      );
    } finally {
      await f.store.close();
    }
  });
});
