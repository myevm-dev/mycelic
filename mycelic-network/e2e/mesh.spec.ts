import { installTestWallet, connectTestWallet } from "./wallet";
import { test, expect } from "@playwright/test";
test("two actual WebRTC peers authenticate, backfill and exchange paid messages", async ({
  page,
  browser,
}) => {
  const sockets: string[] = [];
  page.on("websocket", (s) => sockets.push(s.url()));
  await page.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    const connections: RTCPeerConnection[] = [];
    (window as typeof window & { rtcDebug?: RTCPeerConnection[] }).rtcDebug =
      connections;
    window.RTCPeerConnection = new Proxy(Native, {
      construct(target, args) {
        const rtc = new target(...args);
        connections.push(rtc);
        return rtc;
      },
    });
  });
  await installTestWallet(page);
  await page.goto("/chat");
  await connectTestWallet(page);
  await page.getByLabel("Room name").fill("Actual mesh");
  await page.getByRole("button", { name: "Create room · 3 USDC" }).click();
  await expect(page.getByText("MESH ACTIVE", { exact: true })).toBeVisible();
  const link = page.url();
  await page.getByRole("button", { name: "Buy posting credits" }).click();
  await expect(page.getByTestId("posting-balance")).toHaveText("0.12 USDC");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Backfill before the second peer joins");
  await page
    .getByRole("button", { name: "Send · 0.012 USDC →", exact: true })
    .click();
  await expect(
    page.getByText("Backfill before the second peer joins", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext();
  const peer = await context.newPage();
  await installTestWallet(peer);
  await peer.goto(link);
  await connectTestWallet(peer);
  await peer.getByRole("button", { name: "Join room →" }).click();
  await expect(peer.getByText("MESH ACTIVE", { exact: true })).toBeVisible();
  try {
    await expect(
      page.getByText("2 connected participants", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    console.log(
      "RTC diagnostic",
      sockets,
      await page.evaluate(() =>
        (
          (window as typeof window & { rtcDebug?: RTCPeerConnection[] })
            .rtcDebug ?? []
        ).map((r) => ({
          connection: r.connectionState,
          ice: r.iceConnectionState,
          signal: r.signalingState,
          localType: r.localDescription?.type,
          remoteType: r.remoteDescription?.type,
        })),
      ),
    );
    throw error;
  }
  await expect(
    peer.getByText("2 connected participants", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    peer.getByText("Backfill before the second peer joins", { exact: true }),
  ).toBeVisible();
  await peer.getByRole("button", { name: "Buy posting credits" }).click();
  await expect(peer.getByTestId("posting-balance")).toHaveText("0.12 USDC");
  await peer
    .getByLabel("Message", { exact: true })
    .fill("Reply over a real data channel");
  await peer
    .getByRole("button", { name: "Send · 0.012 USDC →", exact: true })
    .click();
  await expect(
    page.getByText("Reply over a real data channel", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Returning the conversation");
  await page
    .getByRole("button", { name: "Send · 0.012 USDC →", exact: true })
    .click();
  await expect(
    peer.getByText("Returning the conversation", { exact: true }),
  ).toBeVisible();
  await peer.getByRole("button", { name: "Leave room ↗" }).click();
  await peer
    .getByRole("button", { name: "Leave and clear local history" })
    .click();
  await expect(
    page.getByText("1 connected participant", { exact: true }),
  ).toBeVisible();
  await context.close();
});
