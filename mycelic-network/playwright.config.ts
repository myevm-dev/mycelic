import { generatePrivateKey } from "viem/accounts";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  globalSetup: "./e2e/relay.ts",
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3111",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--allow-loopback-in-peer-connection",
      ],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      process.env.MYCELIC_E2E_USE_PRODUCTION === "true"
        ? "npm run build && npm run start -- --port 3111"
        : "npm run dev -- --port 3111",
    env: {
      NODE_OPTIONS: "--import=tsx --import=./e2e/gateway-fixture.ts",
      MYCELIC_PAYMENT_ENV: "testnet",
      MYCELIC_RECEIPT_PRIVATE_KEY: generatePrivateKey(),
      MYCELIC_E2E_USE_PRODUCTION:
        process.env.MYCELIC_E2E_USE_PRODUCTION || "false",
      MYCELIC_PUBLIC_URL: "http://127.0.0.1:3111",
      MYCELIC_E2E: "true",
      MYCELIC_DATA_DIR: ".mycelic-test-data",
      NEXT_PUBLIC_NOSTR_RELAY_URL: "ws://127.0.0.1:4127",
      NEXT_PUBLIC_STUN_URL: "stun:127.0.0.1:3479",
    },
    url: "http://127.0.0.1:3111",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
