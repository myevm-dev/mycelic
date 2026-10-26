import { type Address } from "viem";
import { type PrivateKeyAccount } from "viem/accounts";
import {
  canonical,
  type RoomDefinition,
  type RoomMetadata,
  type ArchiveHead,
  type SessionCertificate,
  type Invitation,
  type PaymentReceipt,
} from "@/types/protocol";
import { CREDIT_PACKS } from "@/payments/shared";
import type { PaymentRequired } from "@/payments/client";
export interface RoomClient {
  createRoom(room: RoomDefinition): Promise<void>;
  getRoomMetadata(roomHash: string): Promise<RoomMetadata>;
  updateRoomMetadata(
    roomHash: string,
    lastSavedTimestamp: number,
    storageUri: string,
    archive: ArchiveHead,
  ): Promise<void>;
  heartbeat(roomHash: string, leaseId: string): Promise<void>;
  release(roomHash: string, leaseId: string): Promise<void>;
  getPostingBalance(roomHash: string): Promise<number>;
  checkPendingPayments(roomHash?: string): Promise<PaymentStatus[]>;
  buyPostingCredits(
    roomHash: string,
    pack: keyof typeof CREDIT_PACKS,
  ): Promise<number>;
  payMessageFee(
    roomHash: string,
    messageId: string,
    digest: string,
  ): Promise<{ receipt: PaymentReceipt; balance: number }>;
}
export type PaymentStatus = {
  id: string;
  kind: "create" | "credits";
  amount: string;
  status: string;
  balance: number;
  result?: unknown;
  error?: string;
};
export class RoomApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public intentId?: string,
  ) {
    super(message);
  }
}
type Attempt = { id: string; header?: string; url?: string };
export class LocalRoomClient implements RoomClient {
  private admission:
    { certificate: SessionCertificate; invitation?: Invitation } | undefined;
  /** Admission per open room, so several rooms can stay connected at once. */
  private admissions = new Map<
    string,
    { certificate: SessionCertificate; invitation?: Invitation }
  >();
  private pay:
    | ((challenge: PaymentRequired, amount: string) => Promise<string>)
    | undefined;
  private attempts = new Map<string, Attempt>();
  constructor(
    private account: PrivateKeyAccount,
    private endpoint = "/api/rooms",
  ) {
    if (typeof window !== "undefined")
      try {
        const saved = JSON.parse(
          sessionStorage.getItem("mycelic.payment-attempts") || "[]",
        );
        for (const [key, value] of saved)
          if (typeof key === "string" && typeof value.id === "string")
            this.attempts.set(key, value);
      } catch {
        /* Ignore corrupt local attempt metadata. */
      }
  }
  private persistAttempts() {
    if (typeof window !== "undefined")
      try {
        sessionStorage.setItem(
          "mycelic.payment-attempts",
          JSON.stringify(
            [...this.attempts].map(([key, a]) => [
              key,
              { id: a.id, url: a.url },
            ]),
          ),
        );
      } catch {
        /* In-memory retry still works if browser storage is blocked. */
      }
  }
  setAdmission(certificate: SessionCertificate, invitation?: Invitation) {
    this.admission = { certificate, invitation };
    this.admissions.set(certificate.roomHash.toLowerCase(), this.admission);
  }
  /** Forget a room's admission after leaving it. */
  clearAdmission(roomHash: string) {
    this.admissions.delete(roomHash.toLowerCase());
  }
  private admissionFor(data: unknown) {
    const record = (data ?? {}) as {
      roomHash?: unknown;
      room?: { hash?: unknown };
    };
    const hash =
      typeof record.roomHash === "string"
        ? record.roomHash
        : typeof record.room?.hash === "string"
          ? record.room.hash
          : undefined;
    return (hash && this.admissions.get(hash.toLowerCase())) || this.admission;
  }
  setPaymentSigner(
    callback: (challenge: PaymentRequired, amount: string) => Promise<string>,
  ) {
    this.pay = callback;
  }
  private async call<T>(
    action: string,
    data: unknown,
    amount?: string,
  ): Promise<T> {
    const admission = this.admissionFor(data);
    const key = canonical({
      action,
      data,
      wallet: admission?.certificate.identity,
    });
    const attempt = this.attempts.get(key) ?? { id: crypto.randomUUID() };
    if (amount) {
      this.attempts.set(key, attempt);
      this.persistAttempts();
    }
    const envelope = () => ({
      action,
      payload: { data, admission },
      actor: this.account.address as Address,
      nonce: attempt.id,
      at: Date.now(),
    });
    const send = async () => {
      const body = envelope();
      const signature = await this.account.signMessage({
        message: canonical(body),
      });
      return fetch(attempt.url || this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(attempt.header ? { "PAYMENT-SIGNATURE": attempt.header } : {}),
        },
        body: JSON.stringify({ ...body, signature }),
        cache: "no-store",
      });
    };
    let response = await send();
    let result = await response.json();
    if (
      amount &&
      result.code === "creation_pending" &&
      typeof result.intentId === "string" &&
      /^[0-9a-f-]{36}$/i.test(result.intentId)
    ) {
      attempt.id = result.intentId;
      attempt.header = undefined;
      attempt.url = undefined;
      this.persistAttempts();
      response = await send();
      result = await response.json();
    }
    if (
      amount &&
      response.status === 402 &&
      response.headers.has("PAYMENT-REQUIRED")
    ) {
      if (!this.pay)
        throw new Error(
          "Connect a wallet or configure an agent payment signer",
        );
      const challenge = result as PaymentRequired;
      const target = new URL(
        challenge.resource.url,
        typeof window !== "undefined" ? window.location.origin : this.endpoint,
      );
      const endpoint = new URL(
        this.endpoint,
        typeof window !== "undefined" ? window.location.origin : this.endpoint,
      );
      if (
        target.origin !== endpoint.origin ||
        target.pathname !== endpoint.pathname ||
        target.searchParams.get("intent") !== attempt.id
      )
        throw new Error("Untrusted payment resource URL");
      attempt.url = target.toString();
      this.persistAttempts();
      attempt.header = await this.pay(challenge, amount);
      response = await send();
      result = await response.json();
    }
    if (
      result.code === "payment_rejected" ||
      result.code === "payment_self_transfer" ||
      result.code === "intent_expired"
    ) {
      this.attempts.delete(key);
      this.persistAttempts();
    }
    if (!response.ok)
      throw new RoomApiError(
        response.status,
        result.error || `Room service failed (${response.status})`,
        result.code,
        result.intentId || (amount ? attempt.id : undefined),
      );
    this.attempts.delete(key);
    this.persistAttempts();
    return result as T;
  }
  async checkPendingPayments(roomHash?: string): Promise<PaymentStatus[]> {
    const admission =
      (roomHash && this.admissions.get(roomHash.toLowerCase())) ||
      this.admission;
    if (!admission) throw new Error("Authorize your wallet session first");
    const wallet = admission.certificate.identity;
    const results: PaymentStatus[] = [];
    for (const [key, attempt] of [...this.attempts]) {
      const context = JSON.parse(key);
      if (context.wallet?.toLowerCase() !== wallet.toLowerCase()) continue;
      const status = await this.call<PaymentStatus>("paymentStatus", {
        roomHash: admission.certificate.roomHash,
        intentId: attempt.id,
      });
      results.push(status);
      if (["accepted", "failed", "expired"].includes(status.status)) {
        this.attempts.delete(key);
        this.persistAttempts();
      }
    }
    return results;
  }
  async createRoom(room: RoomDefinition) {
    await this.call("create", { room }, "3000000");
  }
  getRoomMetadata(roomHash: string) {
    return this.call<RoomMetadata>("metadata", { roomHash });
  }
  async updateRoomMetadata() {
    throw new Error("Archives are disabled for ephemeral chat");
  }
  async heartbeat(roomHash: string, leaseId: string) {
    await this.call("heartbeat", { roomHash, leaseId });
  }
  async release(roomHash: string, leaseId: string) {
    await this.call("release", { roomHash, leaseId });
  }
  async getPostingBalance(roomHash: string) {
    return (await this.call<{ balance: number }>("balance", { roomHash }))
      .balance;
  }
  async buyPostingCredits(roomHash: string, pack: keyof typeof CREDIT_PACKS) {
    return (
      await this.call<{ balance: number }>(
        "credits",
        { roomHash, pack },
        CREDIT_PACKS[pack],
      )
    ).balance;
  }
  payMessageFee(roomHash: string, messageId: string, digest: string) {
    return this.call<{ receipt: PaymentReceipt; balance: number }>("post", {
      roomHash,
      messageId,
      digest,
    });
  }
}
