"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { APP_CHAINS, appRpcUrl } from "@/chains/config";
import { useState } from "react";
const config = createConfig({
  chains: APP_CHAINS,
  connectors: [injected()],
  ssr: true,
  transports: Object.fromEntries(
    APP_CHAINS.map((chain) => [chain.id, http(appRpcUrl(chain.id))]),
  ) as Record<(typeof APP_CHAINS)[number]["id"], ReturnType<typeof http>>,
});
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
