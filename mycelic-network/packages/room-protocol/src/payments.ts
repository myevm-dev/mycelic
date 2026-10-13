import { hashMessage, verifyMessage, type Address, type Hex } from "viem";
import {
  canonical,
  unsigned,
  paymentReceiptSchema,
  paymentPolicySchema,
  type PaymentReceipt,
  type PaymentPolicy,
  type ChatMessage,
  type RoomDefinition,
} from "./types";
export const messageDigest = (message: ChatMessage) =>
  hashMessage(canonical(message));
export const roomDigest = (room: RoomDefinition) =>
  hashMessage(canonical(room));
export function assertPaymentPolicy(
  room: RoomDefinition,
  trusted: PaymentPolicy,
) {
  if (canonical(paymentPolicySchema.parse(room.payment)) !== canonical(trusted))
    throw new Error("Room payment policy does not match this service");
  if (
    !room.protocol?.modules.some(
      (m) => m.id === "ember.chat" && m.version === 3 && m.required,
    )
  )
    throw new Error("Paid rooms require chat protocol v3");
}
export async function verifyPaymentReceipt(
  input: unknown,
  policy: PaymentPolicy,
  expected: Pick<
    PaymentReceipt,
    "purpose" | "roomHash" | "sender" | "session" | "messageId" | "digest"
  >,
) {
  const receipt = paymentReceiptSchema.parse(input);
  for (const field of [
    "serviceId",
    "issuer",
    "treasury",
    "environment",
  ] as const)
    if (receipt[field] !== policy[field])
      throw new Error("Payment receipt policy mismatch");
  for (const field of [
    "purpose",
    "roomHash",
    "sender",
    "session",
    "messageId",
    "digest",
  ] as const)
    if (receipt[field] !== expected[field])
      throw new Error("Payment receipt message mismatch");
  if (
    receipt.amount !==
    (expected.purpose === "create" ? policy.createAmount : policy.postAmount)
  )
    throw new Error("Payment receipt amount mismatch");
  if (receipt.issuedAt > Date.now() + 30000)
    throw new Error("Invalid payment receipt time");
  if (
    !(await verifyMessage({
      address: policy.issuer as Address,
      message: canonical(unsigned(receipt)),
      signature: receipt.signature as Hex,
    }))
  )
    throw new Error("Invalid payment receipt signature");
  return receipt;
}
