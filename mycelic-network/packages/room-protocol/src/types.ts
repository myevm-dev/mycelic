import { z } from "zod";
export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
export const moduleIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/)
  .max(80);
export const capabilitySchema = z
  .object({
    id: moduleIdSchema,
    version: z.number().int().min(1).max(65535),
    required: z.boolean(),
  })
  .strict();
export type Capability = z.infer<typeof capabilitySchema>;
/** Signed application capabilities. Old manifests keep their original signature bytes. */
export const roomProtocolSchema = z
  .object({
    version: z.literal(1),
    modules: z.array(capabilitySchema).min(1).max(32),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.modules.map((m) => m.id)).size !== value.modules.length)
      ctx.addIssue({
        code: "custom",
        message: "Room capabilities must have unique module IDs",
      });
  });
export type RoomProtocol = z.infer<typeof roomProtocolSchema>;
export const policySchema = z
  .object({
    mode: z.enum(["group", "direct"]),
    allowlist: z.array(addressSchema).max(100).default([]),
    nft: z
      .object({
        chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        contract: addressSchema,
        standard: z.enum(["erc721", "erc1155"]),
        tokenId: z.string().regex(/^\d+$/).optional(),
      })
      .optional(),
    inviteRequired: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (
      v.mode === "direct" &&
      new Set(v.allowlist.map((a) => a.toLowerCase())).size !== 2
    )
      ctx.addIssue({
        code: "custom",
        message: "Direct rooms require exactly two distinct wallet addresses.",
      });
    if (v.nft?.standard === "erc1155" && !v.nft.tokenId)
      ctx.addIssue({
        code: "custom",
        message: "ERC-1155 requires a token ID.",
      });
  });
export type AccessPolicy = z.infer<typeof policySchema>;
export const paymentPolicySchema = z
  .object({
    version: z.literal(1),
    serviceId: z.string().min(1).max(200),
    issuer: addressSchema,
    treasury: addressSchema,
    environment: z.enum(["testnet", "mainnet"]),
    createAmount: z.literal("3000000"),
    postAmount: z.literal("12000"),
  })
  .strict();
export type PaymentPolicy = z.infer<typeof paymentPolicySchema>;
export const paymentReceiptSchema = z
  .object({
    version: z.literal(1),
    purpose: z.enum(["create", "post"]),
    serviceId: z.string(),
    issuer: addressSchema,
    treasury: addressSchema,
    environment: z.enum(["testnet", "mainnet"]),
    roomHash: hashSchema,
    sender: addressSchema,
    session: addressSchema,
    messageId: z.string(),
    digest: hashSchema,
    amount: z.string().regex(/^\d+$/),
    issuedAt: z.number().int().positive(),
    signature: signatureSchema,
  })
  .strict();
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;
export const roomSchema = z.object({
  hash: hashSchema,
  title: z.string().min(1).max(80),
  owner: addressSchema,
  createdAt: z.number().int().positive(),
  policy: policySchema,
  protocol: roomProtocolSchema.optional(),
  payment: paymentPolicySchema.optional(),
  signature: signatureSchema,
});
export type RoomDefinition = z.infer<typeof roomSchema>;
export const invitationSchema = z.object({
  roomHash: hashSchema,
  wallet: addressSchema,
  expiresAt: z.number().int().positive(),
  id: z.string().uuid(),
  signature: signatureSchema,
});
export type Invitation = z.infer<typeof invitationSchema>;
export const certificateSchema = z.object({
  roomHash: hashSchema,
  identity: addressSchema,
  session: addressSchema,
  expiresAt: z.number().int().positive(),
  signature: signatureSchema,
});
export type SessionCertificate = z.infer<typeof certificateSchema>;
export const messageSchema = z.object({
  id: z.string().uuid(),
  roomHash: hashSchema,
  sender: addressSchema,
  session: addressSchema,
  text: z.string().min(1).max(4000),
  createdAt: z.number().int().positive(),
  signature: signatureSchema,
});
export type ChatMessage = z.infer<typeof messageSchema>;
export const recordSchema = z.object({
  message: messageSchema,
  certificate: certificateSchema,
  invitation: invitationSchema.optional(),
  receipt: paymentReceiptSchema.optional(),
});
export type ChatRecord = z.infer<typeof recordSchema>;
export type SaveDepth =
  { kind: "full" } | { kind: "last"; count: number } | { kind: "none" };
export type ArchiveHead = {
  id: string;
  uri: string;
  digest: string;
  savedAt: number;
  messageCount: number;
  depth: SaveDepth;
  author: string;
};
export type RoomMetadata = {
  room: RoomDefinition;
  creationReceipt?: PaymentReceipt;
  lastSavedTimestamp: number | null;
  storageUri: string | null;
  archives: ArchiveHead[];
  activePeerCount: number;
  status: "active" | "hibernating" | "empty";
};
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export const unsigned = <T extends { signature: string }>(
  value: T,
): Omit<T, "signature"> => {
  const { signature: omitted, ...body } = value;
  void omitted;
  return body;
};
