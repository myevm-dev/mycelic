import { test, expect } from "@playwright/test";
import { generatePrivateKey } from "viem/accounts";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { installTestWallet, connectTestWallet } from "./wallet";
test("a capped REST x402 agent joins a human room and exchanges paid WebRTC messages", async ({
  page,
}) => {
  const warm = await page.context().newPage();
  await warm.goto("/agent");
  await warm.waitForFunction(() => !!window.mycelicAgent);
  await warm.close();
  await installTestWallet(page);
  await page.goto("/chat");
  await connectTestWallet(page);
  await page.getByRole("button", { name: "Create room · 3 USDC" }).click();
  await expect(page.getByText("MESH ACTIVE", { exact: true })).toBeVisible();
  const link = page.url();
  const process = spawn("node", ["--import=tsx", "scripts/agents/cli.ts"], {
    env: {
      ...globalThis.process.env,
      MYCELIC_URL: "http://127.0.0.1:3111",
      AGENT_WALLET_PRIVATE_KEY: generatePrivateKey(),
      AGENT_MAX_SPEND_USDC: "0.12",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE:
        globalThis.process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = createInterface({ input: process.stdout });
  const queue: unknown[] = [];
  let wake: ((data: unknown) => void) | null = null;
  let diagnostics = "";
  process.stderr.on("data", (data) => {
    diagnostics += data.toString();
  });
  output.on("line", (line) => {
    try {
      const value = JSON.parse(line);
      if (wake) {
        const notify = wake;
        wake = null;
        notify(value);
      } else queue.push(value);
    } catch {
      /* Non-JSON diagnostics are excluded from command results. */
    }
  });
  const next = async () => {
    if (queue.length) return queue.shift() as Record<string, unknown>;
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Agent response timed out: ${diagnostics}`)),
        20000,
      );
      wake = (data) => {
        clearTimeout(timeout);
        resolve(data as Record<string, unknown>);
      };
    });
  };
  const command = async (data: unknown) => {
    process.stdin.write(JSON.stringify(data) + "\n");
    return next();
  };
  try {
    expect((await next()).ready).toBe(true);
    expect(
      (await command({ id: "join", method: "join", link })).error,
    ).toBeUndefined();
    await expect(
      page.getByText("2 connected participants", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect(
      (await command({ id: "credits", method: "buyCredits", pack: "10" }))
        .error,
    ).toBeUndefined();
    const sent = await command({
      id: "post-1",
      method: "send",
      text: "An agent paid for this message",
    });
    expect(sent.error).toBeUndefined();
    await expect(
      page.getByText("An agent paid for this message", { exact: true }),
    ).toBeVisible();
    const retry = await command({
      id: "post-1",
      method: "send",
      text: "An agent paid for this message",
    });
    expect(retry.error).toBeUndefined();
    const credits = await command({ id: "balance", method: "balance" });
    expect(credits.result).toEqual({ balance: 108000 });
    const overspend = await command({
      id: "credits-2",
      method: "buyCredits",
      pack: "10",
    });
    expect(overspend.error).toContain("spending limit");
    await page.getByRole("button", { name: "Buy posting credits" }).click();
    await expect(page.getByTestId("posting-balance")).toHaveText("0.12 USDC");
    await page
      .getByLabel("Message", { exact: true })
      .fill("Human reply to agent");
    await page.getByRole("button", { name: "Send · 0.012 USDC →" }).click();
    await expect
      .poll(async () =>
        JSON.stringify((await command({ id: "read", method: "read" })).result),
      )
      .toContain("Human reply to agent");
    expect(
      (await command({ id: "leave", method: "leave" })).error,
    ).toBeUndefined();
    await expect(
      page.getByText("1 connected participant", { exact: true }),
    ).toBeVisible();
  } finally {
    process.stdin.end();
    await new Promise<void>((resolve) => {
      process.once("exit", () => resolve());
      setTimeout(() => {
        process.kill();
        resolve();
      }, 3000);
    });
    output.close();
  }
});
