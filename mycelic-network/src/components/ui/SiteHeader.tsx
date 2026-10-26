"use client";
import { NavigationLink } from "@/components/ui/NavigationLink";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
export function SiteHeader() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState("");
  return (
    <header className="site-header shell">
      <NavigationLink href="/" className="brand" aria-label="Mycelic home">
        <svg
          className="brand-mark"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m12 5-3 5 6 4-4 5M9 10l-5 3m11 1 5-3" />
          <circle cx="12" cy="3" r="2" fill="currentColor" />
          <circle cx="9" cy="10" r="2" />
          <circle cx="2.8" cy="13.8" r="1.8" />
          <circle cx="15" cy="14" r="2" />
          <circle cx="21" cy="10" r="2" fill="currentColor" />
          <circle cx="10" cy="20.8" r="1.8" />
        </svg>
        <span className="brand-word">
          mycelic <b>chat</b>
        </span>
      </NavigationLink>
      <nav aria-label="Main navigation">
        {[
          { href: "/chat", label: "Chat" },
          { href: "/docs", label: "Get started" },
          { href: "/docs#agents", label: "Agents" },
        ].map(({ href, label }) => (
          <NavigationLink
            key={label}
            href={href}
            aria-current={
              pathname === href && !href.includes("#") ? "page" : undefined
            }
          >
            {label}
          </NavigationLink>
        ))}
      </nav>
      <div className="header-actions">
        <ThemeToggle />
        <button
          className="wallet-button"
          disabled={isPending}
          onClick={async () => {
            setError("");
            if (isConnected) {
              disconnect();
              return;
            }
            try {
              if (!connectors[0])
                throw new Error(
                  "No wallet found. Install a browser wallet to connect.",
                );
              await connectAsync({ connector: connectors[0] });
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Wallet connection failed",
              );
            }
          }}
        >
          <Icon name="wallet" />
          <span>
            {isConnected
              ? `${address?.slice(0, 6)}…${address?.slice(-4)} · disconnect`
              : isPending
                ? "Connecting…"
                : "Connect wallet"}
          </span>
        </button>
      </div>
      {error && (
        <div className="header-error error" role="alert">
          {error}
          <button
            className="quiet"
            aria-label="Dismiss wallet error"
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}
    </header>
  );
}
