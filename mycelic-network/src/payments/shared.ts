import { z } from "zod";
import { paymentPolicySchema } from "@/types/protocol";
export const TREASURY = "0x1f89928f6694dbd02fe77f9fdd7094a774f6d329" as const;
export const SELF_TRANSFER_MESSAGE =
  "Circle Gateway cannot pay a wallet to itself. Connect a payer wallet different from the payment treasury.";
export const CREATE_AMOUNT = "3000000";
export const POST_AMOUNT = "12000";
export const CREDIT_PACKS = {
  "10": "120000",
  "100": "1200000",
  "500": "6000000",
} as const;
export const requirementSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string().regex(/^eip155:\d+$/),
  asset: z.string(),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string(),
  maxTimeoutSeconds: z.number(),
  extra: z.record(z.string(), z.unknown()),
});
export type PaymentRequirements = z.infer<typeof requirementSchema>;
export const publicPaymentConfigSchema = z.object({
  policy: paymentPolicySchema,
  preferredChain: z.string(),
  networks: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      chainId: z.number(),
      domain: z.number(),
      usdc: z.string(),
      gatewayWallet: z.string(),
      rpc: z.string(),
    }),
  ),
  enabled: z.boolean(),
  maxParticipants: z.number().int().min(2).max(8).default(8),
  reason: z.string().optional(),
});
export type PublicPaymentConfig = z.infer<typeof publicPaymentConfigSchema>;
export const stringify = (input: unknown) =>
  JSON.stringify(input, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
