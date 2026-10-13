import { createPublicClient, http } from "viem";
import {
  arc,
  base,
  arbitrum,
  optimism,
  mainnet,
  polygon,
  arcTestnet,
  baseSepolia,
  arbitrumSepolia,
  sepolia,
  optimismSepolia,
  avalancheFuji,
  polygonAmoy,
} from "viem/chains";

/**
 * Shared chains for wallet connection, payment network switching,
 * and optional NFT access checks.
 */
export const APP_CHAINS = [
  arc,
  base,
  arbitrum,
  optimism,
  mainnet,
  polygon,
  arcTestnet,
  baseSepolia,
  arbitrumSepolia,
  sepolia,
  optimismSepolia,
  avalancheFuji,
  polygonAmoy,
] as const;

export const appRpcUrl = (
  chainId: number,
): string | undefined => {
  const urls: Record<number, string | undefined> = {
    [arc.id]:
      process.env.NEXT_PUBLIC_ARC_RPC_URL ||
      arc.rpcUrls.default.http[0],
    [base.id]: process.env.NEXT_PUBLIC_BASE_RPC_URL,
    [arbitrum.id]: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL,
    [optimism.id]: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL,
    [mainnet.id]: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL,
    [polygon.id]: process.env.NEXT_PUBLIC_POLYGON_RPC_URL,
  };

  if (!APP_CHAINS.some((chain) => chain.id === chainId)) {
    throw new Error("Chain not enabled by this app");
  }

  return urls[chainId] || undefined;
};

export const getAppNftClient = (chainId: number) => {
  const chain = APP_CHAINS.find(
    (candidate) => candidate.id === chainId,
  );

  if (!chain) {
    throw new Error("NFT network not enabled by this app");
  }

  return createPublicClient({
    chain,
    transport: http(appRpcUrl(chainId)),
  });
};