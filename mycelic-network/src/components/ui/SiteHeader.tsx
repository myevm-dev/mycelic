"use client";
import Image from "next/image";
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
        <Image
          src="/mycelic-logo.png"
          alt="Mycelic"
          width={2048}
          height={680}
          sizes="(max-width: 520px) 120px, 170px"
          className="brand-logo"
          loading="eager"
        />
      </NavigationLink>
      <nav aria-label="Main navigation" className="main-nav">
        {(
          [
            { href: "/", label: "Home", icon: "home", mobileOnly: true },
            { href: "/chat", label: "Chat", icon: "chat" },
            { href: "/docs", label: "Get started", icon: "book" },
            { href: "/docs#agents", label: "Agents", icon: "agent" },
          ] as const
        ).map((item) => (
          <NavigationLink
            key={item.label}
            href={item.href}
            className={"mobileOnly" in item ? "nav-mobile-only" : undefined}
            aria-current={
              pathname === item.href && !item.href.includes("#")
                ? "page"
                : undefined
            }
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavigationLink>
        ))}
      </nav>
      <div className="header-actions">
        <ThemeToggle />
        <button
          className="wallet-button"
          aria-label={
            isConnected
              ? `Disconnect wallet ${address?.slice(0, 6)}…${address?.slice(-4)}`
              : isPending
                ? "Connecting wallet"
                : "Connect wallet"
          }
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
          <span className="wallet-full">
            {isConnected
              ? `${address?.slice(0, 6)}…${address?.slice(-4)} · disconnect`
              : isPending
                ? "Connecting…"
                : "Connect wallet"}
          </span>
          <span className="wallet-short" aria-hidden="true">
            {isConnected
              ? `${address?.slice(0, 4)}…${address?.slice(-3)}`
              : isPending
                ? "…"
                : "Connect"}
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
