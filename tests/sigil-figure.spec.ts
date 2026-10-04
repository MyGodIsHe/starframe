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

  await page.getByRole("link", { name: "Hammer" }).click();

  await expect(page.getByRole("heading", { name: "Hammer" })).toBeVisible();
  await expect(scene).toHaveAttribute("data-sigil-figure", "hammer");
  // A block hafted on a grip: the body covers its own far side from every side, so some of the five
  // anchors are always out of sight.
  await expect(scene).toHaveAttribute("data-sigil-anchors-in-sight", /^[1-4]$/);
  await expect(scene).toHaveAttribute("data-sigil-outline-count", /[1-9]\d*/);

  await page.getByRole("link", { name: "Gear" }).click();

  await expect(page.getByRole("heading", { name: "Gear" })).toBeVisible();
  await expect(scene).toHaveAttribute("data-sigil-figure", "gear");
  // A toothed plate: its anchors stand on tooth tips on both faces, so the plate itself covers some
  // of them from wherever the observer is standing.
  await expect(scene).toHaveAttribute("data-sigil-anchors-in-sight", /^[1-3]$/);
  await expect(scene).toHaveAttribute("data-sigil-outline-count", /[1-9]\d*/);

  await page.getByRole("link", { name: "Diamond" }).click();

  await expect(page.getByRole("heading", { name: "Diamond" })).toBeVisible();
  await expect(scene).toHaveAttribute("data-sigil-figure", "diamond");
  // A cut stone is convex, so nothing of it is ever seen through it: the anchors on its far side
  // are behind the body itself, and only the ones facing the observer are left.
  await expect(scene).toHaveAttribute("data-sigil-anchors-in-sight", /^[1-4]$/);
  await expect(scene).toHaveAttribute("data-sigil-outline-count", /[1-9]\d*/);
});

test("draws the body with volume, not as flat wire", async ({ page }) => {
  await page.goto("/sigil.html");
  const scene = page.getByRole("application");

  // Glyph Relief: the near side of the body is drawn wider than its far side, and the back of it is
  // the part that goes out of focus. One width for the whole drawing would mean a wire figure.
  const span = (await scene.getAttribute("data-sigil-relief-span"))!.split(",").map(Number);

  expect(span[0]).toBeLessThan(1);
  expect(span[1]).toBeGreaterThan(1);
  expect(Number(await scene.getAttribute("data-sigil-blur-max"))).toBeGreaterThan(0);
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
