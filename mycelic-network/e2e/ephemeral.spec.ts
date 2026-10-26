import { test, expect } from "@playwright/test";
import { installTestWallet, connectTestWallet } from "./wallet";
test("ephemeral chat clears history, preserves wallet credits, and disables archives", async ({
  page,
}) => {
  await installTestWallet(page);
  await page.goto("/chat");
  await connectTestWallet(page);
  await page.getByRole("button", { name: "Create room · 3 USDC" }).click();
  await expect(page.getByText("MESH ACTIVE", { exact: true })).toBeVisible();
  const link = page.url();
  await page.getByLabel("Message", { exact: true }).fill("Unpaid attempt");
  await page.getByRole("button", { name: "Send · 0.012 USDC →" }).click();
  await expect(page.locator(".error[role=alert]")).toContainText("exhausted");
  await expect(page.locator(".message")).toHaveCount(0);
  await page.getByRole("button", { name: "Buy posting credits" }).click();
  await expect(page.getByTestId("posting-balance")).toHaveText("0.12 USDC");
  await page.getByRole("button", { name: "Retry same message" }).click();
  await expect(page.getByTestId("posting-balance")).toHaveText("0.108 USDC");
  await expect(page.locator(".message")).toHaveCount(1);
  await page.getByRole("button", { name: "Leave room ↗" }).click();
  await page
    .getByRole("button", { name: "Leave and clear local history" })
    .click();
  await page.getByLabel("Room invitation link").fill(link);
  await page.getByRole("button", { name: "Join room →" }).click();
  await expect(page.getByText("MESH ACTIVE", { exact: true })).toBeVisible();
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.getByTestId("posting-balance")).toHaveText("0.108 USDC");
  expect((await page.request.post("/api/archive", { data: {} })).status()).toBe(
    410,
  );
});
test("retired preview routes redirect to the single product", async ({
  page,
}) => {
  for (const path of ["/games", "/voice", "/forum"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: /Rooms for people/ }),
    ).toBeVisible();
  }
  const llms = await page.request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain('"method":"create"');
});
