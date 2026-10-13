import { z } from "zod";
import { sha256, toHex } from "viem";
export const envelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("AES-256-GCM"),
  roomHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  salt: z.string().regex(/^[0-9a-f]{64}$/),
  iv: z.string().regex(/^[0-9a-f]{24}$/),
  ciphertext: z
    .string()
    .min(32)
    .max(32_000_000)
    .regex(/^[0-9a-f]+$/),
});
export type EncryptedEnvelope = z.infer<typeof envelopeSchema>;
export const envelopeDigest = (envelope: EncryptedEnvelope): string =>
  sha256(toHex(JSON.stringify(envelope)));
const encoder = new TextEncoder();
const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
export const generateRoomSecret = () =>
  bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
const deriveKey = async (
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  roomHash: string,
): Promise<CryptoKey> => {
  if (!/^[0-9a-f]{64}$/.test(secret))
    throw new Error("Room secret must be 32 random bytes encoded as hex");
  const material = await crypto.subtle.importKey(
    "raw",
    fromHex(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  // Keep the original v1 domain to preserve existing archives. V2 gets a separate cipher domain.
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode(`mesh-chat/savepoint/v1/${roomHash}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};
/** Shared v1 checkpoint cipher. Content keys stay in the member app, never in storage adapters. */
export const encryptPayload = async (
  plaintext: string,
  secret: string,
  roomHash: string,
): Promise<EncryptedEnvelope> => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`v1:${roomHash}`),
      tagLength: 128,
    },
    await deriveKey(secret, salt, roomHash),
    encoder.encode(plaintext),
  );
  return envelopeSchema.parse({
    version: 1,
    algorithm: "AES-256-GCM",
    roomHash,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
  });
};
/** Decryption returns serialized content. Each module must validate its own checkpoint schema. */
export const decryptEnvelope = async (
  input: unknown,
  secret: string,
  roomHash: string,
): Promise<string> => {
  const envelope = envelopeSchema.parse(input);
  if (envelope.roomHash !== roomHash)
    throw new Error("Archive belongs to another room");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromHex(envelope.iv),
      additionalData: encoder.encode(`v1:${roomHash}`),
      tagLength: 128,
    },
    await deriveKey(secret, fromHex(envelope.salt), roomHash),
    fromHex(envelope.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
};
