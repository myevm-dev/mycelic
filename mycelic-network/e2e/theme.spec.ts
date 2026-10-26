import { installTestWallet, connectTestWallet } from "./wallet";
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const capture = async (page: Page, name: string) => {
  const directory = process.env.MYCELIC_UI_QA_DIR;

  if (!directory) return;

  await mkdir(directory, { recursive: true });
  await page.waitForLoadState("networkidle");

  await page.screenshot({
    path: join(directory, `${name}.png`),
    fullPage: true,
  });
};

test("homepage project navigation and theme preference persist across pages", async ({
  page,
}) => {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));

  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated/i.test(message.text())
    ) {
      errors.push(message.text());
    }
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
  });

  await page.goto("/");

  await expect(page).toHaveTitle("Mycelic Chat");
  await expect(
    page.getByRole("heading", { name: /Rooms for people/ }),
  ).toBeVisible();

  const modes = page.locator(".mode-grid");

  await expect(modes.locator(":scope > article")).toHaveCount(3);

  for (const name of ["Human ↔ Human", "Human ↔ Agent", "Agent ↔ Agent"]) {
    await expect(
      modes.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }

  await expect(page.getByText(/coming soon/i)).toHaveCount(0);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await capture(page, "home-dark");

  await page
    .getByRole("button", {
      name: "Switch to light mode",
    })
    .click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await capture(page, "home-light");

  await page
    .getByRole("link", {
      name: "Open Mycelic Chat",
      exact: true,
    })
    .click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("heading", { name: "Mycelic Chat." }),
  ).toBeVisible();

  await capture(page, "chat-light");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page
    .getByRole("link", {
      name: "Mycelic home",
    })
    .click();

  await page
    .getByRole("link", {
      name: "Agent quickstart",
      exact: true,
    })
    .click();

  await expect(page).toHaveURL(/\/docs#agents$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("tab", { name: "For agents" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Commands", exact: true }),
  ).toBeVisible();

  await capture(page, "agents-light");

  await page
    .getByRole("button", {
      name: "Switch to dark mode",
    })
    .click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("tab", { name: "For people" }).click();

  await expect(
    page.getByRole("heading", { name: /Your first room/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Commands", exact: true }),
  ).toBeHidden();

  await capture(page, "people-dark");

  expect(errors).toEqual([]);
});

test("small screens stay within the viewport in both themes", async ({
  page,
}) => {
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "reduce",
  });

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");

    await expect(
      page.getByRole("link", {
        name: "Open Mycelic Chat",
        exact: true,
      }),
    ).toBeVisible();

    await expect(page.locator(".mode-grid > article")).toHaveCount(3);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    if (width === 390) {
      await capture(page, "home-mobile-light");
    }

    await page
      .getByRole("button", {
        name: "Switch to dark mode",
      })
      .click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    if (width === 390) {
      await capture(page, "home-mobile-dark");
    }

    await page
      .getByRole("button", {
        name: "Switch to light mode",
      })
      .click();
  }
});

test("legacy root room links retain their fragment and join the chat route", async ({
  page,
  browser,
}) => {
  await installTestWallet(page);
  await page.goto("/chat");
  await connectTestWallet(page);

  await page.getByLabel("Room name").fill("Legacy link room");

  await page
    .getByRole("button", {
      name: "Create room · 3 USDC",
    })
    .click();

  await expect(page.getByText("MESH ACTIVE", { exact: true })).toBeVisible();

  const link = new URL(page.url());
  const fragment = link.hash;

  link.pathname = "/";

  const context = await browser.newContext();

  try {
    const guest = await context.newPage();

    await installTestWallet(guest);
    await guest.goto(link.toString());
    await connectTestWallet(guest);

    await expect(guest).toHaveURL(`${link.origin}/chat${fragment}`);

    await guest
      .getByRole("button", {
        name: "Join room →",
      })
      .click();

    await expect(guest.getByText("MESH ACTIVE", { exact: true })).toBeVisible();

    const skip = guest.getByRole("link", {
      name: "Skip to content",
    });

    await skip.focus();
    await skip.press("Enter");

    await expect(guest).toHaveURL(`${link.origin}/chat${fragment}`);
    await expect(guest.locator("main")).toBeFocused();
  } finally {
    await context.close();
  }
});
