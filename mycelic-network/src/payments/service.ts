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
import { type PaymentLedger, type IntentRow, postKey } from "./ledger";
export type { IntentRow } from "./ledger";
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
export class PaymentService {
  constructor(
    readonly store: PaymentLedger,
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
    const row = await this.store.transaction(async (tx) => {
      let current = await tx.get("intents", args.id);
      const definition = canonical(args.data);
      if (
        current &&
        (current.owner !== args.wallet.toLowerCase() ||
          current.kind !== args.kind ||
          current.data !== definition ||
          current.amount !== args.amount)
      )
        throw new HttpError(
          409,
          "Payment intent was reused for a different operation",
        );
      if (args.kind === "create" && !current?.nonce && !current?.result) {
        const room = (args.data as { room: RoomDefinition }).room;
        const reservation = await tx.get("creation_claims", room.hash);
        const claim = reservation
          ? await tx.get("intents", reservation.intent)
          : undefined;
        if (claim && claim.owner !== args.wallet.toLowerCase())
          throw new HttpError(
            409,
            "Room creation is reserved by another owner",
          );
        if (claim && claim.data !== definition)
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
          tx.delete("creation_claims", room.hash);
          if (claim.status === "ready")
            tx.set("intents", claim.id, { ...claim, status: "expired" });
        } else if (claim && claim.id !== args.id)
          throw new HttpError(
            409,
            "This room already has a creation payment. Resume the original operation.",
            "creation_pending",
            { intentId: claim.id },
          );
      }
      if (!current) {
        current = {
          id: args.id,
          owner: args.wallet.toLowerCase(),
          kind: args.kind,
          data: definition,
          amount: args.amount,
          expires: Date.now() + 15 * 60 * 1000,
          status: "ready",
          nonce: null,
          payload: null,
          result: null,
          error: null,
        };
        tx.set("intents", args.id, current);
        if (args.kind === "create") {
          const room = (args.data as { room: RoomDefinition }).room;
          tx.set("creation_claims", room.hash, {
            room: room.hash,
            intent: args.id,
          });
        }
      }
      return current;
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
        await this.failIntent(row.id, "Gateway confirmed failed transfer");
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
      await this.store.transaction(async (tx) => {
        const current = await tx.get("intents", row.id);
        const nonce = payload.payload.authorization.nonce.toLowerCase();
        const assignment = await tx.get("nonces", nonce);
        if (
          !current ||
          current.nonce ||
          current.result ||
          current.status !== "ready"
        )
          throw new HttpError(
            409,
            "Payment already in progress; retry the same operation",
          );
        if (current.expires < Date.now())
          throw new HttpError(
            410,
            "Unpaid payment intent expired",
            "intent_expired",
          );
        if (assignment)
          throw new HttpError(
            409,
            "Payment nonce is already assigned to an operation",
          );
        tx.set("nonces", nonce, { nonce, intent: row.id });
        tx.set("intents", row.id, {
          ...current,
          nonce,
          payload: JSON.stringify({ payload, selected }),
          status: "pending",
        });
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // A failed/uncertain database commit must never trigger Gateway submission.
      throw new HttpError(
        503,
        "Payment ledger unavailable. Retry the same operation before authorizing another payment.",
        "ledger_unavailable",
        { intentId: row.id },
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
      await this.failIntent(
        row.id,
        settlement.errorReason || "Gateway rejected authorization",
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
    return this.store.transaction(async (tx) => {
      const current = await tx.get("intents", row.id);
      if (!current) throw new HttpError(404, "Payment intent not found");
      if (current.result) return JSON.parse(current.result);
      if (!current.nonce || current.status !== "pending")
        throw new HttpError(409, "Payment is not pending acceptance");
      let result: unknown;
      if (room) {
        const existing = await tx.get("rooms", room.hash);
        if (existing && existing.definition !== canonical(room))
          throw new HttpError(
            409,
            "Room hash already belongs to another definition",
          );
        if (!existing)
          tx.set("rooms", room.hash, {
            hash: room.hash,
            definition: canonical(room),
            receipt: JSON.stringify(receipt),
          });
        result = {
          created: true,
          creationReceipt: existing ? JSON.parse(existing.receipt) : receipt,
        };
      } else {
        const balance = (await tx.get("credits", row.owner))?.amount || 0;
        const next = balance + Number(row.amount);
        if (!Number.isSafeInteger(next))
          throw new HttpError(409, "Credit balance exceeds supported range");
        tx.set("credits", row.owner, { wallet: row.owner, amount: next });
        result = { purchased: true, balance: next };
      }
      tx.set("intents", row.id, {
        ...current,
        status: "accepted",
        result: JSON.stringify(result),
      });
      return result;
    });
  }
  private async failIntent(id: string, error: string) {
    await this.store.transaction(async (tx) => {
      const current = await tx.get("intents", id);
      if (current && !current.result)
        tx.set("intents", id, { ...current, status: "failed", error });
    });
  }
  async paymentStatus(wallet: string, id: string, url: string) {
    let row = await this.store.transaction(async (tx) => {
      const current = await tx.get("intents", id);
      if (!current || current.owner !== wallet.toLowerCase())
        throw new HttpError(404, "Payment intent not found");
      if (
        current.status === "ready" &&
        current.expires < Date.now() &&
        !current.nonce
      ) {
        const expired = { ...current, status: "expired" };
        tx.set("intents", id, expired);
        return expired;
      }
      return current;
    });
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
      row = (await this.store.get("intents", id))!;
    }
    return {
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      status: row.status,
      balance: await this.store.balance(wallet),
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
    return this.store.transaction(async (tx) => {
      const key = postKey(args.room.hash, args.messageId);
      const existing = await tx.get("posts", key);
      const wallet = args.wallet.toLowerCase();
      const balance = (await tx.get("credits", wallet))?.amount || 0;
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
        return { receipt: paid, balance };
      }
      const amount = Number(this.policy.postAmount);
      if (balance < amount)
        throw new HttpError(
          402,
          "Posting credits exhausted. Purchase a pack before posting.",
        );
      tx.set("credits", wallet, { wallet, amount: balance - amount });
      tx.set("posts", key, {
        room: args.room.hash,
        id: args.messageId,
        digest: args.digest,
        receipt: JSON.stringify(receipt),
      });
      return { receipt, balance: balance - amount };
    });
  }
}
export const packAmount = (pack: unknown) =>
  CREDIT_PACKS[z.enum(["10", "100", "500"]).parse(pack)];
export const operationDigest = (data: unknown): Hex =>
  hashMessage(canonical(data));
