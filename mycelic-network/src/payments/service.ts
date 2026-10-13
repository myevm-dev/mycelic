import { z } from "zod";
import { hashMessage, type Hex } from "viem";
import { type PrivateKeyAccount } from "viem/accounts";
import {
  canonical,
  type PaymentReceipt,
  type RoomDefinition,
  type PaymentPolicy,
} from "@/types/protocol";
import { roomDigest } from "@mycelic/room-protocol";
import { CREDIT_PACKS } from "./shared";
import { type PaymentStore } from "./store";
import { type GatewayProvider, validateGatewayPayload } from "./gateway";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export type ApiResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};
export type IntentRow = {
  id: string;
  owner: string;
  kind: "create" | "credits";
  data: string;
  amount: string;
  expires: number;
  status: string;
  nonce: string | null;
  payload: string | null;
  result: string | null;
  error: string | null;
};
export class PaymentService {
  constructor(
    readonly store: PaymentStore,
    readonly policy: PaymentPolicy,
    readonly signer: PrivateKeyAccount,
    readonly gateway: GatewayProvider,
  ) {}
  async signReceipt(body: Omit<PaymentReceipt, "signature">) {
    return {
      ...body,
      signature: await this.signer.signMessage({ message: canonical(body) }),
    };
  }
  async purchase(args: {
    id: string;
    wallet: string;
    kind: "create" | "credits";
    data: unknown;
    amount: string;
    url: string;
    paymentHeader?: string;
  }): Promise<ApiResult> {
    const row = this.store.transaction(() => {
      const get = () =>
        this.store.db
          .prepare("SELECT * FROM intents WHERE id=?")
          .get(args.id) as IntentRow | undefined;
      let current = get();
      if (
        current &&
        (current.owner !== args.wallet.toLowerCase() ||
          current.kind !== args.kind ||
          current.data !== canonical(args.data) ||
          current.amount !== args.amount)
      )
        throw new HttpError(
          409,
          "Payment intent was reused for a different operation",
        );
      if (args.kind === "create" && !current?.nonce && !current?.result) {
        const room = (args.data as { room: RoomDefinition }).room;
        const claim = this.store.db
          .prepare(
            "SELECT i.* FROM creation_claims c JOIN intents i ON i.id=c.intent WHERE c.room=?",
          )
          .get(room.hash) as IntentRow | undefined;
        if (claim && claim.owner !== args.wallet.toLowerCase())
          throw new HttpError(
            409,
            "Room creation is reserved by another owner",
          );
        if (claim && claim.data !== canonical(args.data))
          throw new HttpError(
            409,
            "Room hash already has a different pending definition",
          );
        if (
          claim &&
          claim.id !== args.id &&
          (["failed", "expired"].includes(claim.status) ||
            (claim.status === "ready" && claim.expires < Date.now()))
        ) {
          this.store.db
            .prepare("DELETE FROM creation_claims WHERE room=?")
            .run(room.hash);
          if (claim.status === "ready")
            this.store.db
              .prepare("UPDATE intents SET status='expired' WHERE id=?")
              .run(claim.id);
        } else if (claim && claim.id !== args.id)
          throw new HttpError(
            409,
            "This room already has a creation payment. Resume the original operation.",
            "creation_pending",
            { intentId: claim.id },
          );
      }
      if (!current) {
        this.store.db
          .prepare(
            "INSERT INTO intents(id,owner,kind,data,amount,expires) VALUES(?,?,?,?,?,?)",
          )
          .run(
            args.id,
            args.wallet.toLowerCase(),
            args.kind,
            canonical(args.data),
            args.amount,
            Date.now() + 15 * 60 * 1000,
          );
        if (args.kind === "create")
          this.store.db
            .prepare("INSERT INTO creation_claims(room,intent) VALUES(?,?)")
            .run((args.data as { room: RoomDefinition }).room.hash, args.id);
        current = get();
      }
      return current!;
    });
    if (row.result) return { status: 200, body: JSON.parse(row.result) };
    if (row.status === "expired")
      throw new HttpError(
        410,
        "Unpaid payment intent expired",
        "intent_expired",
      );
    if (row.status === "failed")
      throw new HttpError(
        402,
        row.error || "Gateway rejected this authorization",
        "payment_rejected",
      );
    const url = new URL(args.url);
    url.search = "";
    url.searchParams.set("intent", args.id);
    const resource = url.toString();
    // Once a nonce is assigned, never sign or accept a replacement payment for this intent.
    if (row.nonce) {
      const stored = JSON.parse(row.payload!) as {
        selected: { network: string };
        payload: unknown;
      };
      const accepted = await this.gateway.reconcile(row.nonce, {
        payer: row.owner,
        to: this.policy.treasury,
        network: stored.selected.network,
      });
      if (
        accepted &&
        (accepted.payer.toLowerCase() !== row.owner ||
          accepted.to.toLowerCase() !== this.policy.treasury.toLowerCase() ||
          accepted.amount !== row.amount ||
          accepted.network !== stored.selected.network)
      )
        throw new HttpError(
          409,
          "Gateway reconciliation fields mismatch; operator review required",
          "payment_pending",
          { intentId: row.id },
        );
      if (
        accepted &&
        ["received", "batched", "confirmed", "completed"].includes(
          accepted.status,
        )
      ) {
        if (
          accepted.payer.toLowerCase() !== row.owner ||
          accepted.to.toLowerCase() !== this.policy.treasury.toLowerCase() ||
          accepted.amount !== row.amount ||
          accepted.network !== stored.selected.network
        )
          throw new HttpError(
            409,
            "Gateway reconciliation fields mismatch; operator review required",
          );
        return {
          status: 200,
          body: await this.fulfill(row),
          headers: { "X-Mycelic-Intent": row.id },
        };
      }
      if (accepted?.status === "failed") {
        this.store.db
          .prepare(
            "UPDATE intents SET status='failed',error='Gateway confirmed failed transfer' WHERE id=? AND result IS NULL",
          )
          .run(row.id);
        throw new HttpError(
          402,
          "Gateway confirmed that this transfer failed. No credit issued.",
          "payment_rejected",
          { intentId: row.id },
        );
      }
      throw new HttpError(
        409,
        "Payment is pending or needs reconciliation. Retry this same operation; do not authorize a new payment.",
        "payment_pending",
        { intentId: row.id },
      );
    }
    if (row.expires < Date.now())
      throw new HttpError(
        410,
        "Unpaid payment intent expired",
        "intent_expired",
      );
    let accepts;
    try {
      accepts = await this.gateway.requirements(row.amount);
    } catch {
      throw new HttpError(
        503,
        "Gateway is unavailable. No payment was submitted; retry the same operation.",
        "gateway_unavailable",
        { intentId: row.id },
      );
    }
    if (!accepts.length)
      throw new HttpError(
        503,
        "Gateway currently advertises no supported payment networks",
      );
    const required = {
      x402Version: 2,
      resource: {
        url: resource,
        description:
          row.kind === "create"
            ? "Create an ephemeral Mycelic chat room"
            : "Purchase Mycelic posting credits",
        mimeType: "application/json",
      },
      accepts,
    };
    if (!args.paymentHeader)
      return {
        status: 402,
        body: required,
        headers: {
          "X-Mycelic-Intent": row.id,
          "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString(
            "base64",
          ),
        },
      };
    const { payload, selected } = await validateGatewayPayload(
      args.paymentHeader,
      accepts,
      args.wallet,
      resource,
    );
    try {
      const assigned = this.store.db
        .prepare(
          "UPDATE intents SET nonce=?,payload=?,status='pending' WHERE id=? AND nonce IS NULL AND result IS NULL",
        )
        .run(
          payload.payload.authorization.nonce.toLowerCase(),
          JSON.stringify({ payload, selected }),
          row.id,
        );
      if (!assigned.changes)
        throw new HttpError(
          409,
          "Payment already in progress; retry the same operation",
        );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        409,
        "Payment nonce is already assigned to an operation",
      );
    }
    let settlement;
    try {
      settlement = await this.gateway.settle(payload, selected);
    } catch {
      throw new HttpError(
        409,
        "Gateway response was interrupted. Payment recorded for reconciliation; retry the same operation.",
        "payment_pending",
        { intentId: row.id },
      );
    }
    if (!settlement.success) {
      // Nonce conflicts and unknown outcomes can mean a previous request was accepted.
      if (
        ![
          "insufficient_funds",
          "invalid_signature",
          "invalid_payload",
          "expired_authorization",
        ].includes(settlement.errorReason || "")
      )
        throw new HttpError(
          409,
          "Gateway outcome needs reconciliation. Check this payment before authorizing another.",
          "payment_pending",
          { intentId: row.id },
        );
      this.store.db
        .prepare(
          "UPDATE intents SET status='failed',error=? WHERE id=? AND result IS NULL",
        )
        .run(
          settlement.errorReason || "Gateway rejected authorization",
          row.id,
        );
      throw new HttpError(
        402,
        `Gateway rejected payment: ${settlement.errorReason || "unknown reason"}. No credit issued. Keep the intent ID for support.`,
        "payment_rejected",
      );
    }
    if (
      settlement.payer?.toLowerCase() !== row.owner ||
      settlement.network !== selected.network
    )
      throw new HttpError(
        409,
        "Gateway acceptance mismatch; reconciliation required",
      );
    const result = await this.fulfill(row);
    return {
      status: 200,
      body: result,
      headers: {
        "X-Mycelic-Intent": row.id,
        "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settlement)).toString(
          "base64",
        ),
      },
    };
  }
  private async fulfill(row: IntentRow) {
    const data = JSON.parse(row.data);
    const room: RoomDefinition | undefined = data.room;
    const receipt = room
      ? await this.signReceipt({
          version: 1,
          purpose: "create",
          ...this.receiptPolicy(),
          roomHash: room.hash,
          sender: room.owner,
          session: room.owner,
          messageId: row.id,
          digest: roomDigest(room),
          amount: this.policy.createAmount,
          issuedAt: Date.now(),
        })
      : undefined;
    return this.store.transaction(() => {
      const current = this.store.db
        .prepare("SELECT result FROM intents WHERE id=?")
        .get(row.id) as { result: string | null };
      if (current.result) return JSON.parse(current.result);
      let result: unknown;
      if (room) {
        const existing = this.store.db
          .prepare("SELECT definition FROM rooms WHERE hash=?")
          .get(room.hash) as { definition: string } | undefined;
        if (existing && existing.definition !== canonical(room))
          throw new HttpError(
            409,
            "Room hash already belongs to another definition",
          );
        this.store.db
          .prepare(
            "INSERT OR IGNORE INTO rooms(hash,definition,receipt) VALUES(?,?,?)",
          )
          .run(room.hash, canonical(room), JSON.stringify(receipt));
        result = { created: true, creationReceipt: receipt };
      } else {
        this.store.db
          .prepare(
            "INSERT INTO credits(wallet,amount) VALUES(?,?) ON CONFLICT(wallet) DO UPDATE SET amount=amount+excluded.amount",
          )
          .run(row.owner, Number(row.amount));
        result = { purchased: true, balance: this.store.balance(row.owner) };
      }
      this.store.db
        .prepare("UPDATE intents SET status='accepted',result=? WHERE id=?")
        .run(JSON.stringify(result), row.id);
      return result;
    });
  }
  async paymentStatus(wallet: string, id: string, url: string) {
    let row = this.store.db
      .prepare("SELECT * FROM intents WHERE id=?")
      .get(id) as IntentRow | undefined;
    if (!row || row.owner !== wallet.toLowerCase())
      throw new HttpError(404, "Payment intent not found");
    if (row.status === "ready" && row.expires < Date.now()) {
      this.store.db
        .prepare(
          "UPDATE intents SET status='expired' WHERE id=? AND nonce IS NULL",
        )
        .run(row.id);
      row = { ...row, status: "expired" };
    }
    let recoveryError: string | undefined;
    if (row.status === "pending") {
      try {
        await this.purchase({
          id: row.id,
          wallet: row.owner,
          kind: row.kind,
          data: JSON.parse(row.data),
          amount: row.amount,
          url,
        });
      } catch (error) {
        recoveryError =
          error instanceof Error ? error.message : "Recovery unavailable";
      }
      row = this.store.db
        .prepare("SELECT * FROM intents WHERE id=?")
        .get(id) as IntentRow;
    }
    return {
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      status: row.status,
      balance: this.store.balance(wallet),
      ...(row.result ? { result: JSON.parse(row.result) } : {}),
      ...(recoveryError || row.error
        ? { error: recoveryError || row.error }
        : {}),
    };
  }
  receiptPolicy() {
    const { serviceId, issuer, treasury, environment } = this.policy;
    return { serviceId, issuer, treasury, environment };
  }
  async post(args: {
    room: RoomDefinition;
    wallet: string;
    session: string;
    messageId: string;
    digest: string;
  }) {
    z.string().uuid().parse(args.messageId);
    z.string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .parse(args.digest);
    const receipt = await this.signReceipt({
      version: 1,
      purpose: "post",
      ...this.receiptPolicy(),
      roomHash: args.room.hash,
      sender: args.wallet,
      session: args.session,
      messageId: args.messageId,
      digest: args.digest,
      amount: this.policy.postAmount,
      issuedAt: Date.now(),
    });
    return this.store.transaction(() => {
      const existing = this.store.db
        .prepare("SELECT digest,receipt FROM posts WHERE room=? AND id=?")
        .get(args.room.hash, args.messageId) as
        { digest: string; receipt: string } | undefined;
      if (existing) {
        const paid = JSON.parse(existing.receipt) as PaymentReceipt;
        if (
          existing.digest !== args.digest ||
          paid.sender !== args.wallet ||
          paid.session !== args.session
        )
          throw new HttpError(
            409,
            "Message ID cannot be reused for different content or identity",
          );
        return { receipt: paid, balance: this.store.balance(args.wallet) };
      }
      const deducted = this.store.db
        .prepare(
          "UPDATE credits SET amount=amount-? WHERE wallet=? AND amount>=?",
        )
        .run(
          Number(this.policy.postAmount),
          args.wallet.toLowerCase(),
          Number(this.policy.postAmount),
        );
      if (!deducted.changes)
        throw new HttpError(
          402,
          "Posting credits exhausted. Purchase a pack before posting.",
        );
      this.store.db
        .prepare("INSERT INTO posts(room,id,digest,receipt) VALUES(?,?,?,?)")
        .run(
          args.room.hash,
          args.messageId,
          args.digest,
          JSON.stringify(receipt),
        );
      return { receipt, balance: this.store.balance(args.wallet) };
    });
  }
}
export const packAmount = (pack: unknown) =>
  CREDIT_PACKS[z.enum(["10", "100", "500"]).parse(pack)];
export const operationDigest = (data: unknown): Hex =>
  hashMessage(canonical(data));
