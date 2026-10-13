import { verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import { RoomRegistry } from "./roomRegistry";
import {
  canonical,
  unsigned,
  addressSchema,
  signatureSchema,
  hashSchema,
} from "@/types/protocol";
import {
  verifyRoom,
  verifyCertificate,
  assertAccess,
} from "@/access/roomAccess";
import { assertPaymentPolicy } from "@mycelic/room-protocol";
import { publicPaymentConfig, receiptSigner } from "@/payments/config";
import { paymentStore } from "@/payments/store";
import { CircleGatewayProvider } from "@/payments/gateway";
import {
  PaymentService,
  HttpError,
  packAmount,
  type ApiResult,
} from "@/payments/service";
const globals = globalThis as typeof globalThis & {
  mycelicRegistry?: RoomRegistry;
};
export const roomState = () => ({
  registry: (globals.mycelicRegistry ??= new RoomRegistry()),
});
const operationSchema = z
  .object({
    action: z.enum([
      "create",
      "metadata",
      "heartbeat",
      "release",
      "credits",
      "balance",
      "post",
      "paymentStatus",
    ]),
    payload: z.object({
      data: z.unknown(),
      admission: z
        .object({
          certificate: z.unknown(),
          invitation: z.unknown().optional(),
        })
        .optional(),
    }),
    actor: addressSchema,
    nonce: z.string().uuid(),
    at: z.number().int(),
    signature: signatureSchema,
  })
  .strict();
export async function handleRoomOperation(
  input: unknown,
  paymentHeader?: string,
  url = "http://localhost:3000/api/rooms",
): Promise<ApiResult> {
  const operation = operationSchema.parse(input);
  if (Math.abs(Date.now() - operation.at) > 5 * 60 * 1000)
    throw new HttpError(
      401,
      "Request expired; retry with a fresh signed envelope",
    );
  if (
    !(await verifyMessage({
      address: operation.actor as Address,
      message: canonical(unsigned(operation)),
      signature: operation.signature as Hex,
    }))
  )
    throw new HttpError(401, "Invalid request signature");
  const config = publicPaymentConfig();
  if (!config.enabled)
    throw new HttpError(503, config.reason || "Payments disabled");
  const store = paymentStore();
  try {
    store.pinPolicy(config.policy);
  } catch {
    throw new HttpError(
      503,
      "Payment identity differs from the ledger. Operator recovery is required before accepting payments.",
      "payment_identity_mismatch",
    );
  }
  const service = new PaymentService(
    store,
    config.policy,
    receiptSigner(),
    new CircleGatewayProvider(),
  );
  const { registry } = roomState();
  const data = z
    .object({ roomHash: hashSchema.optional() })
    .passthrough()
    .parse(operation.payload.data);
  if (operation.action === "metadata") {
    const row = store.db
      .prepare("SELECT definition,receipt FROM rooms WHERE hash=?")
      .get(hashSchema.parse(data.roomHash)) as
      { definition: string; receipt: string } | undefined;
    if (!row) throw new HttpError(404, "Room not found");
    if (!store.rateLimit(operation.actor, "metadata", 120))
      throw new HttpError(429, "Too many metadata requests; try again shortly");
    const room = JSON.parse(row.definition);
    if (!registry.rooms.has(room.hash)) registry.create(room, room.owner);
    return {
      status: 200,
      body: {
        ...registry.metadata(room.hash),
        status: store.leaseCount(room.hash) > 0 ? "active" : "empty",
        creationReceipt: JSON.parse(row.receipt),
        activePeerCount: store.leaseCount(room.hash),
        maxParticipants:
          room.policy.mode === "direct" ? 2 : config.maxParticipants,
      },
    };
  }
  if (operation.action === "paymentStatus") {
    const admission = operation.payload.admission;
    if (!admission) throw new HttpError(401, "Wallet session required");
    const certificate = await verifyCertificate(
      admission.certificate,
      hashSchema.parse(data.roomHash),
    );
    if (certificate.session.toLowerCase() !== operation.actor.toLowerCase())
      throw new HttpError(401, "Session signer mismatch");
    if (!store.rateLimit(certificate.identity, "payment-status", 30))
      throw new HttpError(429, "Too many recovery checks; try again shortly");
    return {
      status: 200,
      body: await service.paymentStatus(
        certificate.identity,
        z.string().uuid().parse(data.intentId),
        url,
      ),
    };
  }
  let room;
  if (operation.action === "create") {
    room = await verifyRoom(data.room);
    assertPaymentPolicy(room, config.policy);
    const existing = store.db
      .prepare("SELECT definition,receipt FROM rooms WHERE hash=?")
      .get(room.hash) as { definition: string; receipt: string } | undefined;
    if (existing && existing.definition !== canonical(room))
      throw new HttpError(
        409,
        "Room already exists with a different definition",
      );
  } else {
    const row = store.db
      .prepare("SELECT definition FROM rooms WHERE hash=?")
      .get(hashSchema.parse(data.roomHash)) as
      { definition: string } | undefined;
    if (!row) throw new HttpError(404, "Room not found");
    room = await verifyRoom(JSON.parse(row.definition));
    assertPaymentPolicy(room, config.policy);
    if (!registry.rooms.has(room.hash)) registry.create(room, room.owner);
  }
  const admission = operation.payload.admission;
  if (!admission) throw new HttpError(401, "Session admission required");
  const certificate = await verifyCertificate(admission.certificate, room.hash);
  if (certificate.session.toLowerCase() !== operation.actor.toLowerCase())
    throw new HttpError(401, "Session signer mismatch");
  const invitation = admission.invitation as Parameters<typeof assertAccess>[2];
  await assertAccess(room, certificate.identity, invitation);
  const wallet = certificate.identity;
  if (!store.rateLimit(wallet, "room-operations", 240))
    throw new HttpError(
      429,
      "Wallet request limit reached; retry the same operation later",
    );
  if (operation.action === "create") {
    if (room.owner.toLowerCase() !== wallet.toLowerCase())
      throw new HttpError(403, "Only the owner can create this room");
    const existing = store.db
      .prepare("SELECT receipt FROM rooms WHERE hash=?")
      .get(room.hash) as { receipt: string } | undefined;
    if (existing)
      return {
        status: 200,
        body: { created: true, creationReceipt: JSON.parse(existing.receipt) },
      };
    return service.purchase({
      id: operation.nonce,
      wallet,
      kind: "create",
      data: { room },
      amount: config.policy.createAmount,
      url,
      paymentHeader,
    });
  }
  if (operation.action === "credits")
    return service.purchase({
      id: operation.nonce,
      wallet,
      kind: "credits",
      data: { pack: z.enum(["10", "100", "500"]).parse(data.pack) },
      amount: packAmount(data.pack),
      url,
      paymentHeader,
    });
  if (operation.action === "balance")
    return { status: 200, body: { balance: store.balance(wallet) } };
  if (operation.action === "post") {
    if (!store.hasLease(room.hash, operation.actor))
      throw new HttpError(
        403,
        "Connect or renew room admission before posting",
        "admission_required",
      );
    return {
      status: 200,
      body: await service.post({
        room,
        wallet,
        session: certificate.session,
        messageId: z.string().uuid().parse(data.messageId),
        digest: hashSchema.parse(data.digest),
      }),
    };
  }
  const leaseId = z.string().uuid().parse(data.leaseId);
  if (operation.action === "heartbeat") {
    if (
      !store.acquireLease(
        room.hash,
        operation.actor,
        leaseId,
        room.policy.mode === "direct" ? 2 : config.maxParticipants,
      )
    )
      throw new HttpError(
        409,
        "This room is full. Try again after someone leaves.",
        "room_full",
      );
  } else store.releaseLease(room.hash, operation.actor, leaseId);
  return { status: 200, body: { ok: true } };
}
