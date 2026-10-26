import { chromium } from "@playwright/test";
import { createInterface } from "node:readline";
import { type Hex, parseUnits } from "viem";
import { MycelicAgentClient } from "../../src/agents/restClient";
import type { ChatRecord } from "../../src/types/protocol";
import "../../src/agents/bridgeTypes";
const origin = process.env.MYCELIC_URL || "http://127.0.0.1:3000";
const key = process.env.AGENT_WALLET_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
  throw new Error(
    "Set AGENT_WALLET_PRIVATE_KEY locally. Never include it in a prompt or command argument.",
  );
const target = new URL(origin);
if (
  target.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(target.hostname)
)
  throw new Error("Agent payments require HTTPS except on localhost");
const client = new MycelicAgentClient(
  origin,
  key as Hex,
  process.env.MYCELIC_PAYMENT_CHAIN || undefined,
  parseUnits(process.env.AGENT_MAX_SPEND_USDC || "4.20", 6),
);
await client.initialize();
if (
  client.config.policy.environment === "mainnet" &&
  process.env.AGENT_ALLOW_MAINNET !== "true"
)
  throw new Error("Agent mainnet spending requires AGENT_ALLOW_MAINNET=true");
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--allow-loopback-in-peer-connection",
  ],
});
const page = await browser.newPage();
await page.goto(`${origin}/agent`);
await page.waitForFunction(() => !!window.mycelicAgent);
const pending = new Map<string, ChatRecord>();
const postIds = new Map<string, string>();
const joinBridge = async () => {
  const joined = client.joined!;
  await page.evaluate((args) => window.mycelicAgent!.join(args), {
    ...joined,
    sessionKey: client.sessionKey,
  });
};
console.log(
  JSON.stringify({
    ready: true,
    wallet: client.wallet.address,
    environment: client.config.policy.environment,
    maximumSpend: process.env.AGENT_MAX_SPEND_USDC || "4.20",
  }),
);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  for await (const line of input) {
    if (!line.trim()) continue;
    let id: unknown;
    try {
      const command = JSON.parse(line);
      id = command.id;
      let result: unknown;
      if (command.method === "create") {
        await client.create(
          String(command.title || "Agent room"),
          command.policy,
        );
        await joinBridge();
        result = { link: client.link() };
      } else if (command.method === "join") {
        await client.join(String(command.link));
        await joinBridge();
        result = { joined: true };
      } else if (command.method === "buyCredits")
        result = { balance: await client.buyCredits(command.pack || "10") };
      else if (command.method === "payments")
        result = await client.checkPendingPayments();
      else if (command.method === "balance")
        result = { balance: await client.balance() };
      else if (command.method === "send") {
        const status = await page.evaluate(() => window.mycelicAgent!.status());
        if (!status.connected)
          throw new Error("Connect before purchasing a paid post");
        if (!id || typeof id !== "string")
          throw new Error(
            "send requires a stable string request id for retries",
          );
        let record = pending.get(id);
        if (record && record.message.text !== String(command.text).trim())
          throw new Error("Retry id cannot change message text");
        if (!record) {
          const messageId = postIds.get(id) || crypto.randomUUID();
          postIds.set(id, messageId);
          record = await client.preparePost(String(command.text), messageId);
          pending.set(id, record);
        }
        await page.evaluate((r) => window.mycelicAgent!.send(r), record);
        result = { messageId: record.message.id, sent: true };
      } else if (command.method === "read")
        result = await page.evaluate(() => window.mycelicAgent!.read());
      else if (command.method === "status")
        result = await page.evaluate(() => window.mycelicAgent!.status());
      else if (command.method === "leave") {
        await page.evaluate(() => window.mycelicAgent!.leave());
        client.joined = null;
        pending.clear();
        postIds.clear();
        result = { left: true };
      } else
        throw new Error(
          "Unknown method. Use create, join, buyCredits, payments, balance, send, read, status or leave.",
        );
      console.log(JSON.stringify({ id, result }));
    } catch (error) {
      console.log(
        JSON.stringify({
          id,
          error: error instanceof Error ? error.message : "Command failed",
        }),
      );
    }
  }
} finally {
  await page.evaluate(() => window.mycelicAgent?.leave()).catch(() => {});
  await browser.close();
}
