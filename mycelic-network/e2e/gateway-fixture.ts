// Test-process preload only. Production application code has no mock payment mode.
import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
if (
  process.env.MYCELIC_E2E !== "true" ||
  process.env.MYCELIC_DATA_DIR !== ".mycelic-test-data" ||
  process.env.MYCELIC_PAYMENT_ENV !== "testnet" ||
  (process.env.NODE_ENV === "production" &&
    process.env.MYCELIC_E2E_USE_PRODUCTION !== "true")
)
  throw new Error(
    "Gateway fixture is restricted to the isolated browser test server",
  );
const realFetch = globalThis.fetch;
const transfers = new Map<string, unknown>();
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.startsWith("https://gateway-api-testnet.circle.com/")) {
    if (url.endsWith("/x402/supported"))
      return Response.json({
        kinds: Object.values(CHAIN_CONFIGS)
          .filter((c) => c.gatewayWallet.startsWith("0x007"))
          .map((c) => ({
            x402Version: 2,
            scheme: "exact",
            network: `eip155:${c.chain.id}`,
            extra: {
              name: "GatewayWalletBatched",
              version: "1",
              verifyingContract: c.gatewayWallet,
              assets: [{ symbol: "USDC", address: c.usdc, decimals: 6 }],
            },
          })),
        extensions: [],
        signers: {},
      });
    if (url.endsWith("/x402/settle")) {
      const data = JSON.parse(String(init?.body));
      const a = data.paymentPayload.payload.authorization;
      transfers.set(a.nonce, {
        fromAddress: a.from,
        toAddress: a.to,
        amount: a.value,
        nonce: a.nonce,
        token: "USDC",
        sendingNetwork: data.paymentRequirements.network,
        status: "received",
        id: a.nonce,
      });
      return Response.json({
        success: true,
        payer: a.from,
        network: data.paymentRequirements.network,
        transaction: a.nonce,
      });
    }
    if (url.includes("/x402/transfers"))
      return Response.json({
        transfers: [
          transfers.get(new URL(url).searchParams.get("nonce") || ""),
        ].filter(Boolean),
      });
    if (url.endsWith("/balances")) {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        balances: body.sources.map((s: { domain: number }) => ({
          domain: s.domain,
          balance: "100",
          withdrawing: "0",
          withdrawable: "0",
        })),
      });
    }
    throw new Error(`Unmocked Gateway request: ${url}`);
  }
  return realFetch(input, init);
};
