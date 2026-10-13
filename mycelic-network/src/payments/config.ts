import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isAddress, type Hex } from "viem";
import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { TREASURY, type PublicPaymentConfig } from "./shared";
export const dataDirectory = () =>
  resolve(process.env.MYCELIC_DATA_DIR || ".mycelic-data");
export function receiptPrivateKey(): Hex {
  let key = process.env.MYCELIC_RECEIPT_PRIVATE_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "Configure MYCELIC_RECEIPT_PRIVATE_KEY before enabling production payments",
      );
    mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
    const path = join(dataDirectory(), "receipt-key");
    try {
      key = readFileSync(path, "utf8").trim();
    } catch {
      key = generatePrivateKey();
      try {
        writeFileSync(path, key, { mode: 0o600, flag: "wx" });
      } catch {
        key = readFileSync(path, "utf8").trim();
      }
    }
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new Error("Invalid receipt signing key");
  return key as Hex;
}
export function receiptSigner() {
  return privateKeyToAccount(receiptPrivateKey());
}
export function publicPaymentConfig(): PublicPaymentConfig {
  const environment =
    process.env.MYCELIC_PAYMENT_ENV === "mainnet" ? "mainnet" : "testnet";
  const treasury = process.env.MYCELIC_TREASURY_ADDRESS || TREASURY;
  if (!isAddress(treasury, { strict: false }))
    throw new Error("Invalid treasury address");
  const issuer = receiptSigner().address;
  const networks = Object.entries(CHAIN_CONFIGS)
    .filter(
      ([, c]) =>
        c.gatewayWallet.toLowerCase() ===
        (environment === "testnet"
          ? "0x0077777d7eba4688bdef3e311b846f25870a19b9"
          : "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee"),
    )
    .map(([key, c]) => ({
      key,
      name: c.chain.name,
      chainId: c.chain.id,
      domain: c.domain,
      usdc: c.usdc,
      gatewayWallet: c.gatewayWallet,
      rpc: c.rpcUrl || c.chain.rpcUrls.default.http[0],
    }));
  const enabled =
    environment === "testnet" || process.env.MYCELIC_ENABLE_MAINNET === "true";
  return {
    policy: {
      version: 1,
      serviceId: process.env.MYCELIC_SERVICE_ID || "mycelic.local",
      issuer,
      treasury,
      environment,
      createAmount: "3000000",
      postAmount: "12000",
    },
    networks: networks.filter((n) =>
      [
        5042002, 84532, 421614, 11155111, 11155420, 43113, 80002, 8453, 42161,
        10, 1, 137,
      ].includes(n.chainId),
    ),
    preferredChain: environment === "testnet" ? "arcTestnet" : "base",
    enabled,
    maxParticipants: 8,
    ...(!enabled
      ? {
          reason:
            "Mainnet payments are disabled. Complete the funded deployment checks before enabling.",
        }
      : {}),
  };
}
export const gatewayUrl = () =>
  process.env.MYCELIC_PAYMENT_ENV === "mainnet"
    ? "https://gateway-api.circle.com"
    : "https://gateway-api-testnet.circle.com";
