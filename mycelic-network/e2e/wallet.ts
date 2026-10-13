import type { Page } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
export async function installTestWallet(page: Page) {
  const account = privateKeyToAccount(generatePrivateKey());
  let chainId = "0x4cef52";
  await page.exposeBinding(
    "testWalletRequest",
    async (_source, request: { method: string; params?: unknown[] }) => {
      const { method, params = [] } = request;
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return [account.address];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        chainId = (params[0] as { chainId: string }).chainId;
        return null;
      }
      if (
        method === "wallet_requestPermissions" ||
        method === "wallet_getPermissions"
      )
        return [{ parentCapability: "eth_accounts" }];
      if (method === "personal_sign")
        return account.signMessage({
          message: { raw: params[0] as `0x${string}` },
        });
      if (method === "eth_signTypedData_v4") {
        const data = JSON.parse(params[1] as string);
        return account.signTypedData(data);
      }
      if (method === "eth_getBalance") return "0x0";
      throw new Error(`Unhandled test wallet method ${method}`);
    },
  );
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async (args: { method: string; params?: unknown[] }) => {
        const result = await (
          window as unknown as {
            testWalletRequest: (args: unknown) => Promise<unknown>;
          }
        ).testWalletRequest(args);
        if (args.method === "wallet_switchEthereumChain")
          for (const listener of listeners.get("chainChanged") || [])
            listener((args.params?.[0] as { chainId: string }).chainId);
        return result;
      },
      on: (name: string, fn: (...args: unknown[]) => void) => {
        const set = listeners.get(name) || new Set();
        set.add(fn);
        listeners.set(name, set);
      },
      removeListener: (name: string, fn: (...args: unknown[]) => void) =>
        listeners.get(name)?.delete(fn),
    };
  });
  return account;
}
export async function connectTestWallet(page: Page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
}
