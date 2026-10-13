import {
  BatchEvmScheme,
  CHAIN_CONFIGS,
} from "@circle-fin/x402-batching/client";
import { canonical } from "@/types/protocol";
import { requirementSchema, type PublicPaymentConfig } from "./shared";
export type PaymentSigner = ConstructorParameters<typeof BatchEvmScheme>[0];
export type PaymentRequired = {
  x402Version: 2;
  resource: { url: string; description: string; mimeType: string };
  accepts: unknown[];
};
export async function signGatewayChallenge(
  required: PaymentRequired,
  config: PublicPaymentConfig,
  signer: PaymentSigner,
  chainKey: string,
  expectedAmount: string,
) {
  const chain = config.networks.find((n) => n.key === chainKey);
  if (!chain || !config.enabled)
    throw new Error("Payment network is not enabled");
  const selected = required.accepts
    .map((v) => requirementSchema.parse(v))
    .find((r) => r.network === `eip155:${chain.chainId}`);
  if (
    !selected ||
    selected.payTo.toLowerCase() !== config.policy.treasury.toLowerCase() ||
    selected.amount !== expectedAmount ||
    selected.asset.toLowerCase() !== chain.usdc.toLowerCase() ||
    selected.extra.name !== "GatewayWalletBatched" ||
    selected.extra.version !== "1" ||
    String(selected.extra.verifyingContract).toLowerCase() !==
      chain.gatewayWallet.toLowerCase()
  )
    throw new Error(
      "Payment challenge does not match the displayed treasury, amount or network",
    );
  const payload = await new BatchEvmScheme(signer).createPaymentPayload(
    2,
    selected,
  );
  // Browser-safe base64; payment fields are ASCII, resource text may be UTF-8.
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      ...payload,
      accepted: selected,
      resource: required.resource,
    }),
  );
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}
export const gatewayChain = (key: string) =>
  CHAIN_CONFIGS[key as keyof typeof CHAIN_CONFIGS];
export const samePolicy = (a: unknown, b: unknown) =>
  canonical(a) === canonical(b);
