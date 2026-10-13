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

  await expect(page).toHaveTitle("Mycelic");
  await expect(
    page.getByRole("heading", { name: /Your people/ }),
  ).toBeVisible();

  const projects = page.locator(".project-grid");

  await expect(projects.locator(":scope > article")).toHaveCount(4);

  for (const name of [
    "Mycelic Chat",
    "Mycelic Games",
    "Mycelic Voice",
    "Mycelic Forum",
  ]) {
    await expect(
      projects.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }

  await expect(
    projects.getByText("Coming soon", { exact: true }),
  ).toHaveCount(3);

  await expect(
    projects.getByText("Open Chat", { exact: true }),
  ).toBeVisible();

  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );

  await capture(page, "home-dark");

  await page.getByRole("button", {
    name: "Switch to light mode",
  }).click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );

  await capture(page, "home-light");

  await page.getByRole("link", {
    name: "Explore Chat",
    exact: true,
  }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(
    page.getByRole("heading", { name: "Mycelic Chat." }),
  ).toBeVisible();

  await capture(page, "chat-light");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );

  await page.getByRole("link", {
    name: "Mycelic home",
  }).click();

  await page.getByRole("link", {
    name: "Preview Games",
    exact: true,
  }).click();

  await expect(page).toHaveURL(/\/games$/);
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(
    page.getByText("Coming soon", { exact: true }),
  ).toBeVisible();

  await capture(page, "games-light");

  await page.getByRole("button", {
    name: "Switch to dark mode",
  }).click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );

  await capture(page, "games-dark");

  await page.getByRole("link", {
    name: "Chat help",
    exact: true,
  }).click();

  await expect(
    page.getByRole("heading", { name: "Chat help." }),
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test("small screens stay within viewport and reduced motion disables node animation", async ({
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
        name: "Explore Chat",
        exact: true,
      }),
    ).toBeVisible();

    await expect(
      page.locator(".project-grid > article"),
    ).toHaveCount(4);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    expect(
      await page
        .locator(".network-point")
        .first()
        .evaluate(
          (element) => getComputedStyle(element).animationName,
        ),
    ).toBe("none");

    if (width === 390) {
      await capture(page, "home-mobile-light");
    }

    await page.getByRole("button", {
      name: "Switch to dark mode",
    }).click();

    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );

    if (width === 390) {
      await capture(page, "home-mobile-dark");
    }

    await page.getByRole("button", {
      name: "Switch to light mode",
    }).click();
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

  await page.getByRole("button", {
    name: "Create room · 3 USDC",
  }).click();

  await expect(
    page.getByText("MESH ACTIVE", { exact: true }),
  ).toBeVisible();

  const link = new URL(page.url());
  const fragment = link.hash;

  link.pathname = "/";

  const context = await browser.newContext();

  try {
    const guest = await context.newPage();

    await installTestWallet(guest);
    await guest.goto(link.toString());
    await connectTestWallet(guest);

    await expect(guest).toHaveURL(
      `${link.origin}/chat${fragment}`,
    );

    await guest.getByRole("button", {
      name: "Join room →",
    }).click();

    await expect(
      guest.getByText("MESH ACTIVE", { exact: true }),
    ).toBeVisible();

    const skip = guest.getByRole("link", {
      name: "Skip to content",
    });

    await skip.focus();
    await skip.press("Enter");

    await expect(guest).toHaveURL(
      `${link.origin}/chat${fragment}`,
    );
    await expect(guest.locator("main")).toBeFocused();
  } finally {
    await context.close();
  }
});