import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { installTestWallet, connectTestWallet } from "./wallet";

const capture = async (page: Page, name: string) => {
  const directory = process.env.MYCELIC_UI_QA_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.screenshot({ path: join(directory, `${name}.png`) });
};

/** The room currently on screen; other open rooms stay mounted but hidden. */
const current = (page: Page) => page.locator(".room-slot:not([hidden])");

const createRoom = async (page: Page, title: string) => {
  await page.getByLabel("Room name").fill(title);
  await page.getByRole("button", { name: "Create room · 3 USDC" }).click();
  await expect(
    current(page).getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    current(page).getByText("MESH ACTIVE", { exact: true }),
  ).toBeVisible();
};

test("phone layout keeps several rooms open, switches between them and keeps history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await installTestWallet(page);
  await page.goto("/chat");
  await connectTestWallet(page);
  await capture(page, "mobile-lobby");

  // Bottom tab bar replaces the header links on phones.
  const tabs = page.getByRole("navigation", { name: "Main navigation" });
  await expect(tabs.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Chat" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await createRoom(page, "Design review");
  const designLink = page.url();
  await current(page)
    .getByRole("button", { name: "Buy posting credits" })
    .click();
  await expect(current(page).getByTestId("posting-balance")).toHaveText(
    "0.12 USDC",
  );
  await current(page)
    .getByLabel("Message", { exact: true })
    .fill("Kept while I check the other room");
  await current(page).getByRole("button", { name: /^Send/ }).click();
  await expect(current(page).locator(".message")).toHaveCount(1);
  await capture(page, "mobile-room");

  const bar = page.getByRole("navigation", { name: "Open rooms" });
  await bar.getByRole("button", { name: "New or join" }).click();
  await expect(page.getByLabel("Room name")).toBeVisible();
  await createRoom(page, "Ops desk");
  await expect(bar.getByRole("button")).toHaveCount(3);
  await capture(page, "mobile-two-rooms");

  // Switching back keeps the first room's in-memory history and link.
  await bar.getByRole("button", { name: /Design review/ }).click();
  await expect(
    current(page).getByRole("heading", { name: "Design review" }),
  ).toBeVisible();
  await expect(
    current(page).getByText("Kept while I check the other room"),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe(new URL(designLink).hash);

  // Pasting the link of a room that is already open switches to it.
  await bar.getByRole("button", { name: "New or join" }).click();
  await page.getByLabel("Room invitation link").fill(designLink);
  await page.getByRole("button", { name: "Join room →" }).click();
  await expect(
    current(page).getByRole("heading", { name: "Design review" }),
  ).toBeVisible();
  await expect(bar.getByRole("button")).toHaveCount(3);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(page, "desktop-two-rooms");
  await page.setViewportSize({ width: 390, height: 844 });

  // Leaving the active room shows the next open room.
  await current(page).getByRole("button", { name: "Leave room ↗" }).click();
  await page
    .getByRole("button", { name: "Leave and clear local history" })
    .click();
  await expect(
    current(page).getByRole("heading", { name: "Ops desk" }),
  ).toBeVisible();
  await expect(bar.getByRole("button")).toHaveCount(2);
});

test("a post in a background room shows as unread on its tab", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installTestWallet(page);
  await page.goto("/chat");
  await connectTestWallet(page);
  await createRoom(page, "Design review");
  const designLink = page.url();
  const bar = page.getByRole("navigation", { name: "Open rooms" });
  await bar.getByRole("button", { name: "New or join" }).click();
  await createRoom(page, "Ops desk");

  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await installTestWallet(guest);
    await guest.goto(designLink);
    await connectTestWallet(guest);
    await guest.getByRole("button", { name: "Join room →" }).click();
    await expect(
      current(guest).getByText("2 connected participants", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await current(guest)
      .getByRole("button", { name: "Buy posting credits" })
      .click();
    await expect(current(guest).getByTestId("posting-balance")).toHaveText(
      "0.12 USDC",
    );
    await current(guest)
      .getByLabel("Message", { exact: true })
      .fill("Posted while you were away");
    await current(guest).getByRole("button", { name: /^Send/ }).click();

    const designTab = bar.getByRole("button", { name: /Design review/ });
    await expect(designTab.locator(".unread")).toHaveText("1", {
      timeout: 15_000,
    });
    await capture(page, "mobile-unread");
    await designTab.click();
    await expect(
      current(page).getByText("Posted while you were away"),
    ).toBeVisible();
    await expect(designTab.locator(".unread")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
