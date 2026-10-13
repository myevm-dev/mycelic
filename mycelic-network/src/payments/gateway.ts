import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { gatewayUrl, publicPaymentConfig } from "./config";
import { canonical } from "@/types/protocol";
import type { PaymentRequirements } from "./shared";
const authSchema = z
  .object({
    from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    value: z.string().regex(/^\d+$/),
    validAfter: z.string().regex(/^\d+$/),
    validBefore: z.string().regex(/^\d+$/),
    nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .strict();
const payloadSchema = z.object({
  x402Version: z.literal(2),
  resource: z.object({
    url: z.string(),
    description: z.string(),
    mimeType: z.string(),
  }),
  accepted: z.record(z.string(), z.unknown()),
  payload: z
    .object({
      signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
      authorization: authSchema,
    })
    .strict(),
});
export type GatewayPayload = z.infer<typeof payloadSchema>;
export type Settlement = {
  success: boolean;
  payer?: string;
  network: string;
  transaction: string;
  errorReason?: string;
};
export interface GatewayProvider {
  requirements(amount: string): Promise<PaymentRequirements[]>;
  settle(
    payload: GatewayPayload,
    requirements: PaymentRequirements,
  ): Promise<Settlement>;
  reconcile(
    nonce: string,
    expected?: { payer: string; to: string; network: string },
  ): Promise<{
    payer: string;
    to: string;
    amount: string;
    network: string;
    status: string;
    transaction: string;
  } | null>;
}
export class CircleGatewayProvider implements GatewayProvider {
  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${gatewayUrl()}/v1/x402/${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok && path !== "settle")
      throw new Error("Gateway service unavailable; retry the same operation");
    return { body, ok: response.ok };
  }
  async requirements(amount: string) {
    const config = publicPaymentConfig();
    if (!config.enabled) throw new Error(config.reason);
    const { body } = await this.request("supported");
    const supported = z
      .object({
        kinds: z
          .array(
            z.object({
              x402Version: z.number(),
              scheme: z.string(),
              network: z.string(),
              extra: z
                .object({
                  name: z.string().optional(),
                  version: z.string().optional(),
                  verifyingContract: z.string().optional(),
                  assets: z
                    .array(
                      z.object({
                        address: z.string(),
                        symbol: z.string(),
                        decimals: z.number(),
                      }),
                    )
                    .optional(),
                })
                .optional(),
            }),
          )
          .max(100),
      })
      .parse(body);
    return supported.kinds
      .filter(
        (k) =>
          k.x402Version === 2 &&
          k.scheme === "exact" &&
          k.extra?.name === "GatewayWalletBatched" &&
          k.extra?.version === "1",
      )
      .flatMap((k) => {
        const network = config.networks.find(
          (n) => `eip155:${n.chainId}` === k.network,
        );
        if (
          !network ||
          String(k.extra?.verifyingContract).toLowerCase() !==
            network.gatewayWallet.toLowerCase() ||
          !k.extra?.assets?.some(
            (a) =>
              a.symbol === "USDC" &&
              a.decimals === 6 &&
              a.address.toLowerCase() === network.usdc.toLowerCase(),
          )
        )
          return [];
        return [
          {
            scheme: "exact" as const,
            network: k.network,
            asset: network.usdc,
            amount,
            payTo: config.policy.treasury,
            maxTimeoutSeconds: 604900,
            extra: {
              name: "GatewayWalletBatched",
              version: "1",
              verifyingContract: network.gatewayWallet,
            },
          },
        ];
      });
  }
  async settle(payload: GatewayPayload, requirements: PaymentRequirements) {
    const { body, ok } = await this.request("settle", {
      method: "POST",
      body: JSON.stringify({
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
    });
    const settlement = z
      .object({
        success: z.boolean(),
        payer: z.string().optional(),
        network: z.string(),
        transaction: z.string(),
        errorReason: z.string().optional(),
      })
      .parse(body);
    if (!ok && settlement.success)
      throw new Error("Invalid Gateway acceptance response");
    return settlement;
  }
  async reconcile(
    nonce: string,
    expected?: { payer: string; to: string; network: string },
  ) {
    const url = new URL(`${gatewayUrl()}/v1/x402/transfers`);
    url.searchParams.set("nonce", nonce);
    if (expected) {
      url.searchParams.set("from", expected.payer);
      url.searchParams.set("to", expected.to);
      url.searchParams.set("network", expected.network);
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "Gateway reconciliation unavailable; retry the same payment later",
      );
    const result = await response.json();
    const transfers = z
      .array(
        z.object({
          id: z.string(),
          nonce: z.string(),
          token: z.string(),
          fromAddress: z.string(),
          toAddress: z.string(),
          amount: z.string().regex(/^\d+$/),
          sendingNetwork: z.string(),
          status: z.enum([
            "received",
            "batched",
            "confirmed",
            "completed",
            "failed",
          ]),
        }),
      )
      .max(100)
      .parse(result.transfers);
    const transfer = transfers.find(
      (t) =>
        t.nonce.toLowerCase() === nonce.toLowerCase() &&
        t.token === "USDC" &&
        (!expected ||
          (t.fromAddress.toLowerCase() === expected.payer.toLowerCase() &&
            t.toAddress.toLowerCase() === expected.to.toLowerCase() &&
            t.sendingNetwork === expected.network)),
    );
    if (!transfer) return null;
    return {
      payer: transfer.fromAddress,
      to: transfer.toAddress,
      amount: transfer.amount,
      network: transfer.sendingNetwork,
      status: transfer.status,
      transaction: transfer.id,
    };
  }
}
export async function validateGatewayPayload(
  header: string,
  requirements: PaymentRequirements[],
  wallet: string,
  resource: string,
) {
  if (header.length > 20000) throw new Error("Payment header too large");
  const payload = payloadSchema.parse(
    JSON.parse(Buffer.from(header, "base64").toString("utf8")),
  );
  const selected = requirements.find(
    (r) => canonical(r) === canonical(payload.accepted),
  );
  if (!selected || payload.resource.url !== resource)
    throw new Error("Payment requirements or resource mismatch");
  const a = payload.payload.authorization;
  if (
    a.from.toLowerCase() !== wallet.toLowerCase() ||
    a.to.toLowerCase() !== selected.payTo.toLowerCase() ||
    a.value !== selected.amount
  )
    throw new Error("Payment payer, treasury or amount mismatch");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(a.validAfter) > now || BigInt(a.validBefore) < now + 604800n)
    throw new Error("Invalid Gateway authorization lifetime");
  const recovered = await recoverTypedDataAddress({
    domain: {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: Number(selected.network.split(":")[1]),
      verifyingContract: selected.extra.verifyingContract as Address,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: a.from as Address,
      to: a.to as Address,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: a.nonce as Hex,
    },
    signature: payload.payload.signature as Hex,
  });
  if (recovered.toLowerCase() !== wallet.toLowerCase())
    throw new Error("Invalid Gateway payer signature");
  return { payload, selected };
}
export const configuredChain = (key: string) =>
  CHAIN_CONFIGS[key as keyof typeof CHAIN_CONFIGS];
