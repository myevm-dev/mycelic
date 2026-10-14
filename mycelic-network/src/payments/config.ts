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
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error(
        "Configure MYCELIC_RECEIPT_PRIVATE_KEY before enabling production payments",
      );
    }

    mkdirSync(dataDirectory(), {
      recursive: true,
      mode: 0o700,
    });

    const path = join(dataDirectory(), "receipt-key");

    try {
      key = readFileSync(path, "utf8").trim();
    } catch {
      key = generatePrivateKey();

      try {
        writeFileSync(path, key, {
          mode: 0o600,
          flag: "wx",
        });
      } catch {
        key = readFileSync(path, "utf8").trim();
      }
    }
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Invalid receipt signing key");
  }

  return key as Hex;
}

export function receiptSigner() {
  return privateKeyToAccount(receiptPrivateKey());
}

export function publicPaymentConfig(): PublicPaymentConfig {
  const environment =
    process.env.MYCELIC_PAYMENT_ENV === "mainnet"
      ? "mainnet"
      : "testnet";

  const treasury =
    process.env.MYCELIC_TREASURY_ADDRESS || TREASURY;

  if (!isAddress(treasury, { strict: false })) {
    throw new Error("Invalid treasury address");
  }

  const issuer = receiptSigner().address;

  // Use the SDK's verified contract for the selected environment.
  const gatewayWallet =
    environment === "testnet"
      ? CHAIN_CONFIGS.arcTestnet.gatewayWallet
      : CHAIN_CONFIGS.arc.gatewayWallet;

  const networks = Object.entries(CHAIN_CONFIGS)
    .filter(
      ([, config]) =>
        config.gatewayWallet.toLowerCase() ===
        gatewayWallet.toLowerCase(),
    )
    .map(([key, config]) => ({
      key,
      name: config.chain.name,
      chainId: config.chain.id,
      domain: config.domain,
      usdc: config.usdc,
      gatewayWallet: config.gatewayWallet,
      rpc:
        config.rpcUrl ||
        config.chain.rpcUrls.default.http[0],
    }));

  const enabled =
    environment === "testnet" ||
    process.env.MYCELIC_ENABLE_MAINNET === "true";

  return {
    policy: {
      version: 1,
      serviceId:
        process.env.MYCELIC_SERVICE_ID || "mycelic.local",
      issuer,
      treasury,
      environment,
      createAmount: "3000000",
      postAmount: "12000",
    },

    networks: networks.filter((network) =>
      [
        // Mainnet networks.
        5042,
        8453,
        42161,
        10,
        1,
        137,

        // Testnet networks.
        5042002,
        84532,
        421614,
        11155111,
        11155420,
        43113,
        80002,
      ].includes(network.chainId),
    ),

    preferredChain:
      environment === "testnet" ? "arcTestnet" : "arc",

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