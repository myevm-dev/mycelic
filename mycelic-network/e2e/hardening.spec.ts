import { test, expect } from "@playwright/test";
import { installTestWallet, connectTestWallet } from "./wallet";
test("a lost accepted pack response recovers without a second authorization", async ({
  page,
}) => {
  await installTestWallet(page);
  await page.goto("/chat");
  await connectTestWallet(page);
  await page.getByRole("button", { name: "Create room · 3 USDC" }).click();
  await expect(page.getByText("MESH ACTIVE", { exact: true })).toBeVisible();
  let dropped = false;
  let authorized = 0;
  await page.route("**/api/rooms**", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    if (body?.action === "credits" && request.headers()["payment-signature"]) {
      authorized++;
      const response = await route.fetch();
      if (!dropped && response.ok()) {
        dropped = true;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Buy posting credits" }).click();
  await expect(page.locator(".error[role=alert]")).toBeVisible();
  expect(dropped).toBe(true);
  await page.getByRole("button", { name: "Check pending payments" }).click();
  await expect(page.getByTestId("posting-balance")).toHaveText("0.12 USDC");
  expect(authorized).toBe(1);
  await page.getByRole("button", { name: "Check pending payments" }).click();
  await expect(page.getByTestId("posting-balance")).toHaveText("0.12 USDC");
  expect(authorized).toBe(1);
});
test("health and oversized API requests have bounded public responses", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: "ready",
    environment: "testnet",
    version: "0.6.1",
  });
  const oversized = await request.post("/api/rooms", {
    data: "x".repeat(100001),
    headers: { "content-type": "application/json" },
  });
  expect(oversized.status()).toBe(413);
});
