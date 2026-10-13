import { z } from "zod";
import { publicPaymentConfig, gatewayUrl } from "@/payments/config";
import { readJson, requestGate, errorResponse } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return await requestGate().run(async () => {
      const data = z
        .object({
          wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
          chain: z.string(),
        })
        .parse(await readJson(request, 4000));
      const chain = publicPaymentConfig().networks.find(
        (n) => n.key === data.chain,
      );
      if (!chain) throw new Error("Unsupported payment chain");
      const response = await fetch(`${gatewayUrl()}/v1/balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "USDC",
          sources: [{ domain: chain.domain, depositor: data.wallet }],
        }),
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Gateway balance service unavailable");
      const result = await response.json();
      const entry = result.balances?.find(
        (b: { domain: number }) => b.domain === chain.domain,
      );
      // Circle's /balances balance is a decimal USDC amount. Convert to integer micro-USDC.
      const { parseUnits } = await import("viem");
      return Response.json(
        { available: parseUnits(entry?.balance || "0", 6).toString() },
        { headers: { "Cache-Control": "no-store" } },
      );
    });
  } catch (error) {
    return errorResponse(error);
  }
}
