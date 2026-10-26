"use client";
import { useState } from "react";
import { useAccount, useWalletClient, useSwitchChain } from "wagmi";
import {
  createPublicClient,
  http,
  parseAbi,
  parseUnits,
  formatUnits,
} from "viem";
import { gatewayChain } from "@/payments/client";
import type { PublicPaymentConfig } from "@/payments/shared";
const tokenAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const depositAbi = parseAbi(["function deposit(address token,uint256 value)"]);
export function PaymentPanel({
  config,
  chainKey,
  onChainChange,
}: {
  config: PublicPaymentConfig;
  chainKey: string;
  onChainChange: (key: string) => void;
}) {
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [amount, setAmount] = useState("5");
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const refresh = async () => {
    if (!address) throw new Error("Connect your wallet first");
    const response = await fetch("/api/payments/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: address, chain: chainKey }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Gateway balance unavailable");
    setBalance(result.available);
    return result.available as string;
  };
  const fund = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!address || !wallet)
        throw new Error("Connect an EOA browser wallet first");
      const chain = gatewayChain(chainKey);
      const units = parseUnits(amount, 6);
      if (units <= 0n || units > 1000000000n)
        throw new Error("Choose a deposit between 0 and 1,000 USDC");
      await switchChainAsync({ chainId: chain.chain.id });
      const publicClient = createPublicClient({
        chain: chain.chain,
        transport: http(chain.rpcUrl || chain.chain.rpcUrls.default.http[0]),
      });
      setNotice("Approve only the selected deposit amount in your wallet.");
      const approval = await wallet.writeContract({
        account: address,
        chain: chain.chain,
        address: chain.usdc,
        abi: tokenAbi,
        functionName: "approve",
        args: [chain.gatewayWallet, units],
      });
      const approved = await publicClient.waitForTransactionReceipt({
        hash: approval,
      });
      if (approved.status !== "success")
        throw new Error("USDC approval reverted");
      setNotice(
        "Confirm your Gateway deposit. This transaction uses network gas.",
      );
      const tx = await wallet.writeContract({
        account: address,
        chain: chain.chain,
        address: chain.gatewayWallet,
        abi: depositAbi,
        functionName: "deposit",
        args: [chain.usdc, units],
      });
      const deposited = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });
      if (deposited.status !== "success")
        throw new Error("Gateway deposit reverted");
      setNotice(
        "Deposit confirmed onchain. Gateway availability may take longer; refresh before paying.",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="card payment-panel"
      id="gateway"
      aria-label="Gateway wallet"
    >
      <div className="section-topline">
        <h2>Gateway wallet</h2>
        <span className="pill">
          {config.policy.environment === "testnet"
            ? "Test USDC only"
            : "USDC payments"}
        </span>
      </div>
      <p>
        Fund Gateway once, then buy room creation or posting credits with an
        offchain signature.
      </p>
      <div className="row">
        <label>
          Payment network
          <select
            value={chainKey}
            disabled={busy}
            onChange={(e) => {
              onChainChange(e.target.value);
              setBalance(null);
            }}
          >
            {config.networks.map((n) => (
              <option key={n.key} value={n.key}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Deposit USDC
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <div className="row">
        <button
          className="secondary"
          disabled={busy || !address}
          onClick={() => void fund()}
        >
          {busy ? "Check your wallet…" : "Deposit into Gateway"}
        </button>
        <button
          className="quiet"
          disabled={busy || !address}
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          Refresh Gateway balance
        </button>
      </div>
      {balance !== null && (
        <p role="status">
          Available on this payment network: {formatUnits(BigInt(balance), 6)}{" "}
          USDC
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="fine">
        Gateway deposits remain in your wallet’s Gateway balance until spent.
        Posting packs are prepaid Mycelic service credits, usable across rooms
        by the same wallet. They are not withdrawable tokens. Deposits and
        withdrawals can incur gas.{" "}
        <a
          href="https://developers.circle.com/gateway-nanopayments/quickstarts/buyer"
          target="_blank"
          rel="noreferrer"
        >
          Funding and withdrawal guide
        </a>
      </p>
      <details>
        <summary>Payment recipient</summary>
        <p className="treasury-address">{config.policy.treasury}</p>
      </details>
    </section>
  );
}
