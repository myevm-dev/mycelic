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
test("Voice is coming soon and keeps the shared theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("link", { name: "Preview Voice", exact: true }).click();
  await expect(page).toHaveURL(/\/voice$/);
  await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /A room to talk/ }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
