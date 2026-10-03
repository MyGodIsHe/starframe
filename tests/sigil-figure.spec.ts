import { expect, test, type Locator, type Page } from "@playwright/test";

// Drag constants from SigilFigureViewport.tsx's drag() handler.
const AZIMUTH_PER_PIXEL = 0.012;

async function dragBy(page: Page, scene: Locator, dx: number, dy: number): Promise<void> {
  const box = await scene.boundingBox();
  if (!box) throw new Error("The figure viewport has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.mouse.up();
}

async function drawing(scene: Locator): Promise<(string | null)[]> {
  return Promise.all([
    scene.getAttribute("data-sigil-line-length"),
    scene.getAttribute("data-sigil-stroke-count"),
    scene.getAttribute("data-sigil-outline-count"),
    scene.getAttribute("data-sigil-anchors-in-sight"),
  ]);
}

// The first WebGL paint races `page.goto`; see the note in local-system.spec.ts.
async function waitForFirstRenderedFrame(page: Page): Promise<void> {
  await expect(page.getByRole("application")).toHaveAttribute("data-sigil-stroke-count", /[1-9]\d*/);
  await page.waitForTimeout(500);
}

test("opens on the generated bolt, as an outline with detail inside it", async ({ page }) => {
  await page.goto("/sigil.html");
  const scene = page.getByRole("application");

  await expect(page.getByRole("heading", { name: "Bolt" })).toBeVisible();
  await expect(scene).toHaveAttribute("data-sigil-figure", "bolt");
  await expect(scene).toHaveAttribute("data-sigil-outline-count", /[1-9]\d*/);
  // An anchor is a point on the surface, so the body covers some of them from any one side.
  await expect(scene).toHaveAttribute("data-sigil-anchors-in-sight", /^[1-4]$/);
  await expect(page.getByLabel("Sculpted body")).toContainText("faces");
  await expect(page.getByRole("status")).toContainText("Observer bearing");
});

test("turns to the other generated figures the library ships", async ({ page }) => {
  await page.goto("/sigil.html?figure=ring");
  const scene = page.getByRole("application");

  await expect(page.getByRole("heading", { name: "Ring" })).toBeVisible();
  await expect(scene).toHaveAttribute("data-sigil-figure", "ring");
  await expect(scene).toHaveAttribute("data-sigil-outline-count", /[1-9]\d*/);

  await page.getByRole("link", { name: "Atom" }).click();

  await expect(scene).toHaveAttribute("data-sigil-figure", "atom");
});

test("turns the figure when the observer walks round it", async ({ page }) => {
  await page.goto("/sigil.html");
  const scene = page.getByRole("application");
  const before = await scene.getAttribute("data-sigil-observer");
  // How much line the body leaves, how many strokes it is cut into, how much of that is the outline
  // and how many anchors are in sight. A count on its own can repeat from two sides of a
  // symmetrical figure; the length cannot, and together they say the drawing is a different one.
  const drawingBefore = await drawing(scene);

  await dragBy(page, scene, Math.round(Math.PI / 2 / AZIMUTH_PER_PIXEL), 0);

  await expect(scene).not.toHaveAttribute("data-sigil-observer", before!);
  await expect.poll(() => drawing(scene)).not.toEqual(drawingBefore);
});

test("holds the drawing still when only the camera moves", async ({ page }) => {
  await page.goto("/sigil.html");
  const scene = page.getByRole("application");

  await page.getByRole("button", { name: "Hold the observer here" }).click();
  const observer = await scene.getAttribute("data-sigil-observer");
  const drawingBefore = await drawing(scene);

  await dragBy(page, scene, Math.round(Math.PI / 2 / AZIMUTH_PER_PIXEL), 40);

  await expect(page.getByLabel("Sculpted body")).toContainText("Observer held.");
  await expect(scene).toHaveAttribute("data-sigil-observer", observer!);
  expect(await drawing(scene)).toEqual(drawingBefore);
});

test("draws the figure", async ({ page }) => {
  await page.goto("/sigil.html");
  await waitForFirstRenderedFrame(page);

  // Counted in pixels rather than as a share of the page, and counted tight. This page is one figure
  // of thin line on an empty ground - a bolt is about two thousand lit pixels in a frame of nine
  // hundred thousand - so a tolerance written as a percentage of the frame lets the whole figure move
  // to a different bearing and still pass, which it did twice while this figure was being drawn.
  await expect(page).toHaveScreenshot("sigil-figure.png", { animations: "disabled", maxDiffPixels: 400 });
});
