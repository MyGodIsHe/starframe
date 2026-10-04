import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";

test("opens a calm local system without the retired event controls", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Amarr" })).toBeVisible();
  await expect(page.getByRole("application", { name: "Interactive star system centered on Amarr's star" })).toBeVisible();
  await expect(page.getByRole("application")).toHaveAttribute("data-render-profile", testInfo.project.name === "mobile" ? "mobile" : "desktop");
  await expect(page.getByRole("application")).toHaveAttribute("data-ambient-flight-trails", "enabled");
  await expect(page.getByText("K3 V star · SDE type 45037")).toBeVisible();
  await expect(page.getByLabel("Physical scale")).toContainText("1 scene unit = 1 000 000 000 000 m");
  await expect(page.getByLabel("Physical scale")).toContainText("Gate brackets are screen aids");
  await expect(page.getByText("© 2014 CCP hf. All rights reserved.", { exact: false })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Camera distance");

  for (const label of ["Explosion", "Scan", "Communications", "Travel", "Trade", "Activity", "Route", "Reset"]) {
    await expect(page.getByRole("button", { name: label, exact: false })).toHaveCount(0);
  }
});

test("renders the full Celestial Map layer for the current system on every quality profile", async ({ page }, testInfo) => {
  await page.goto("/");
  const index = await page.evaluate(async () => fetch("/data/universe-index.json").then((response) => response.json() as Promise<{ systems: { id: number; name: string }[]; startSystemId: number }>));
  const scene = page.getByRole("application");

  await expect(scene).toHaveAttribute("data-celestial-map-system-count", String(index.systems.length - 1));
  await expect(scene).toHaveAttribute("data-celestial-map-active-system", String(index.startSystemId));
  await expect(scene).toHaveAttribute("data-celestial-map-render-profile", testInfo.project.name === "mobile" ? "mobile" : "desktop");

  await page.getByRole("button", { name: "Stargate to Ashab" }).click();
  const ashab = index.systems.find((system) => system.name === "Ashab");
  if (!ashab) throw new Error("Ashab is missing from the universe index");
  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
  await expect(scene).toHaveAttribute("data-celestial-map-active-system", String(ashab.id));
  await expect(scene).toHaveAttribute("data-celestial-map-system-count", String(index.systems.length - 1));
});

test("loads the official generated Amarr star and planets", async ({ page }) => {
  const indexRequest = page.waitForRequest("**/data/universe-index.json");
  await page.goto("/");
  await indexRequest;

  const resource = await page.evaluate(async () => fetch("/data/systems/30002187.json").then((response) => response.json() as Promise<{
    star: { id: number; typeId: number; radius: number; spectralClass: string };
    planets: { id: number; parentId: number; name: string; radius: number; orbit: { radius: number; eccentricity: number }; position: [number, number, number] }[];
  }>));

  expect(resource.star).toEqual({ id: 40139383, typeId: 45037, radius: 310900000, spectralClass: "K3 V" });
  expect(resource.planets).toContainEqual({
    id: 40139384,
    parentId: 40139383,
    typeId: 2063,
      name: "Amarr I (Mikew)",
      radius: 2080000,
      orbit: { radius: 39887699968, eccentricity: 0.016628 },
      position: [-36384790808, 2122964164, 16207055016],
  });
  expect(resource.planets).toHaveLength(9);
});

test("keeps stargate screen aids anchored to the common physical transform", async ({ page }) => {
  await page.goto("/");
  const resource = await page.evaluate(async () => fetch("/data/systems/30002187.json").then((response) => response.json() as Promise<{ gates: { id: number; position: [number, number, number] }[] }>));

  await expect(page.getByRole("application")).toHaveAttribute("data-physical-scale", "1e-12");
  for (const gate of resource.gates) {
    const marker = page.locator(`.stargate-marker[data-physical-position="${gate.position.join(",")}"]`);
    const scenePosition = (await marker.getAttribute("data-scene-position"))?.split(",").map(Number);
    expect(scenePosition).toHaveLength(3);
    for (const [index, coordinate] of gate.position.entries()) expect(scenePosition?.[index]).toBeCloseTo(coordinate / 1_000_000_000_000, 10);
  }
});

test("keeps SDE orbital ellipses visible without planet selection controls", async ({ page }) => {
  await page.goto("/");

  const scene = page.getByRole("application");
  await expect(scene).toHaveAttribute("data-orbit-context", "sde-ellipses");
  await expect(scene).toHaveAttribute("data-orbit-count", "9");
  await expect(page.getByRole("button", { name: /^Select / })).toHaveCount(0);
  await expect(page.getByText(/^Радиус /)).toHaveCount(0);
  await expect(page.getByText(/^Расстояние /)).toHaveCount(0);
});

test("renders every Amarr stargate with its real destination and a shared hover and focus state", async ({ page }) => {
  await page.goto("/");

  const index = JSON.parse(await readFile(new URL("../src/data/universe-index.json", import.meta.url), "utf8")) as {
    systems: { id: number; name: string }[];
    edges: { gates: { id: number; destinationGateId: number }[] }[];
  };
  const expectedGates = await page.evaluate(async (startSystemId) => {
    const system = await fetch(`/data/systems/${startSystemId}.json`).then((response) => response.json() as Promise<{ gates: { id: number; destinationGateId: number; destinationSystemId: number; position: [number, number, number] }[] }>);
    return system.gates.map((gate) => ({
      ...gate,
    }));
  }, 30002187);
  const gates = page.getByRole("button", { name: /^Stargate to / });
  await expect(gates).toHaveCount(expectedGates.length);
  expect(expectedGates).toHaveLength(6);

  for (const gate of expectedGates) {
    const destinationName = index.systems.find((systemEntry) => systemEntry.id === gate.destinationSystemId)?.name;
    expect(destinationName).toBeTruthy();
    expect(index.edges.some((edge) => edge.gates.some((entry) => entry.id === gate.id && entry.destinationGateId === gate.destinationGateId) && edge.gates.some((entry) => entry.id === gate.destinationGateId && entry.destinationGateId === gate.id))).toBe(true);
    const gateButton = page.getByRole("button", { name: `Stargate to ${destinationName}` });
    await expect(gateButton).toHaveAccessibleName(`Stargate to ${destinationName}`);
    await gateButton.hover();
    await expect(page.getByRole("status")).toContainText(`Stargate destination: ${destinationName}`);
  }

  for (const gate of expectedGates) {
    const destinationName = index.systems.find((systemEntry) => systemEntry.id === gate.destinationSystemId)?.name;
    const gateButton = page.getByRole("button", { name: `Stargate to ${destinationName}` });
    await gateButton.focus();
    await expect(gateButton).toBeFocused();
    await expect(page.getByRole("status")).toContainText(`Stargate destination: ${destinationName}`);
  }

});

test("shows the same accessible jump preview tree for a hovered or focused stargate and clears it on exit", async ({ page }) => {
  await page.goto("/");

  const gates = page.getByRole("button", { name: /^Stargate to / });
  const firstGate = gates.nth(0);
  const secondGate = gates.nth(1);
  const scene = page.getByRole("application");

  await firstGate.hover();
  const preview = page.getByRole("region", { name: "Jump preview tree" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("listitem")).not.toHaveCount(0);
  await expect(scene).toHaveAttribute("data-jump-preview-system-ids", /.+/);
  await expect(scene).toHaveAttribute("data-jump-preview-edges", /.+/);
  const activeSystemId = await scene.getAttribute("data-celestial-map-active-system");
  const previewSystemIds = await scene.getAttribute("data-jump-preview-system-ids");
  const hoverPreview = await preview.textContent();
  const hoverEdges = await scene.getAttribute("data-jump-preview-edges");
  expect(hoverEdges?.startsWith(`${activeSystemId}:${previewSystemIds?.split(",")[0]}`)).toBe(true);

  await page.mouse.move(0, 0);
  await expect(preview).toHaveAttribute("data-leaving", "true");
  await expect(preview).toHaveCount(0);

  await firstGate.focus();
  await expect(preview).toHaveText(hoverPreview ?? "");
  await expect(scene).toHaveAttribute("data-jump-preview-edges", hoverEdges ?? "");

  await firstGate.blur();
  await page.mouse.move(0, 0);
  await expect(preview).toHaveCount(0);

  await secondGate.hover();
  await expect(preview).toBeVisible();
  await expect(preview).not.toHaveText(hoverPreview ?? "");

  await page.mouse.move(0, 0);
  await expect(preview).toHaveCount(0);
});

test("activating a stargate loads its destination and restores orbit navigation", async ({ page }) => {
  await page.goto("/");

  const gate = page.getByRole("button", { name: "Stargate to Ashab" });
  await gate.click();

  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
  await expect(page.getByRole("application", { name: "Interactive star system centered on Ashab's star" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Stargate to / })).not.toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Ashab local system");

  const scene = page.getByRole("application", { name: "Interactive star system centered on Ashab's star" });
  const beforeOrbit = await page.getByRole("status").textContent();
  const box = await scene.boundingBox();
  if (!box) throw new Error("Destination scene has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.getByRole("status")).not.toHaveText(beforeOrbit ?? "");
});

test("activates a stargate through its enlarged continuous scene hitbox", async ({ page }) => {
  await page.goto("/");

  const gate = page.getByRole("button", { name: "Stargate to Ashab" });
  await expect.poll(() => gate.evaluate((element) => element.style.transform)).not.toBe("");
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Scene canvas has no bounds");
  const position = (await gate.getAttribute("data-scene-position"))?.split(",").map(Number);
  if (!position || position.length !== 3) throw new Error("Stargate has no scene position");

  // Amarr's dynamic zoom range clamps the default camera distance down from 12 to the system's own max (nearest orbit / farthest object with margin);
  // derive that same value from the live system data instead of hardcoding it, since it depends on Amarr's real geometry.
  const defaultDistance = await page.evaluate(async () => {
    const scale = 1e-12;
    const FARTHEST_OBJECT_MARGIN = 1.65;
    const system = await fetch("/data/systems/30002187.json").then((response) => response.json() as Promise<{ planets: { orbit?: { radius: number } }[]; gates: { position: [number, number, number] }[] }>);
    const orbitRadii = system.planets.map((planet) => (planet.orbit?.radius ?? 0) * scale);
    const gateDistances = system.gates.map((gate) => Math.hypot(...gate.position) * scale);
    const farthest = Math.max(...orbitRadii, ...gateDistances);
    return farthest * FARTHEST_OBJECT_MARGIN;
  });
  const azimuth = 0.55;
  const elevation = 0.25;
  const horizontal = Math.cos(elevation) * defaultDistance;

  const camera = new PerspectiveCamera(75, bounds.width / bounds.height);
  camera.position.set(Math.sin(azimuth) * horizontal, Math.sin(elevation) * defaultDistance, Math.cos(azimuth) * horizontal);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const hitboxPoint = new Vector3(...position)
    .project(camera);

  await page.addStyleTag({ content: ".stargate-marker { pointer-events: none !important; }" });
  const x = bounds.x + (hitboxPoint.x + 1) * bounds.width / 2;
  const y = bounds.y + (1 - hitboxPoint.y) * bounds.height / 2;
  await page.mouse.move(bounds.x + 8, bounds.y + bounds.height - 8);
  await expect(canvas).not.toHaveCSS("cursor", "pointer");
  await page.mouse.move(x, y);
  await expect(canvas).toHaveCSS("cursor", "pointer");
  await expect(gate).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(x, y);

  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
});

test("supports consecutive stargate transitions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Stargate to Ashab" }).click();
  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();

  const nextGate = page.getByRole("button", { name: /^Stargate to / }).first();
  const nextDestination = (await nextGate.textContent())?.match(/Stargate to (.+)$/)?.[1];
  if (!nextDestination) throw new Error("The next stargate has no destination name");
  await nextGate.click();

  await expect(page.getByRole("heading", { name: nextDestination })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(`${nextDestination} local system`);
});

test("accelerates before replacing the local system, then decelerates into it", async ({ page }) => {
  await page.goto("/");

  const scene = page.getByRole("application", { name: "Interactive star system centered on Amarr's star" });
  const gate = page.getByRole("button", { name: "Stargate to Ashab" });
  await gate.hover();
  await expect(page.getByRole("region", { name: "Jump preview tree" })).toBeVisible();
  await gate.click();

  await expect(scene).toHaveAttribute("data-travel-phase", "accelerating");
  await expect(page.getByRole("region", { name: "Jump preview tree" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Amarr" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Accelerating through the stargate");
  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
  const destinationScene = page.getByRole("application", { name: "Interactive star system centered on Ashab's star" });
  await expect(destinationScene).toHaveAttribute("data-travel-phase", "decelerating");
  await expect(destinationScene).not.toHaveAttribute("data-travel-phase");
  await expect(destinationScene).toHaveAttribute("data-local-system-detail", "full");
});

test("clears the jump preview for the duration of stargate travel", async ({ page }) => {
  await page.goto("/");

  const gate = page.getByRole("button", { name: "Stargate to Ashab" });
  const preview = page.getByRole("region", { name: "Jump preview tree" });
  const scene = page.getByRole("application");
  await gate.hover();
  await expect(preview).toBeVisible();

  await gate.click();

  await expect(scene).toHaveAttribute("data-travel-phase", "accelerating");
  await expect(gate).not.toBeFocused();
  await expect(preview).toHaveCount(0, { timeout: 100 });
  await expect(scene).toHaveAttribute("data-celestial-preview-arc-count", "0");
  await expect(scene).not.toHaveAttribute("data-jump-preview-system-ids");
  await expect(scene).not.toHaveAttribute("data-jump-preview-edges");
  await gate.focus();
  await expect(preview).toHaveCount(0, { timeout: 100 });
  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
  await expect(page.getByRole("application")).not.toHaveAttribute("data-travel-phase");

  const nextGate = page.getByRole("button", { name: /^Stargate to / }).first();
  await nextGate.focus();
  await expect(preview).toBeVisible();
});

test("keeps the player's orbit and zoom controls active through a stargate jump", async ({ page }) => {
  await page.goto("/");

  const scene = page.getByRole("application", { name: "Interactive star system centered on Amarr's star" });
  await page.getByRole("button", { name: "Stargate to Ashab" }).click();
  await expect(scene).toHaveAttribute("data-travel-phase", /accelerating|decelerating/);
  const box = await scene.boundingBox();
  if (!box) throw new Error("Scene canvas has no bounds during travel");
  const beforeZoom = (await page.getByRole("status").textContent())?.match(/Camera distance (\d+\.\d+)/)?.[1];
  if (!beforeZoom) throw new Error("Camera distance was not reported during travel");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 - 40);
  await page.mouse.up();
  await page.mouse.wheel(0, -200);

  await expect.poll(async () => {
    const text = await page.getByRole("status").textContent();
    const distance = text?.match(/Camera distance (\d+\.\d+)/)?.[1];
    return distance === undefined ? undefined : Number(distance);
  }).toBeLessThan(Number(beforeZoom));
  const cameraState = (await page.getByRole("status").textContent())?.match(/Camera distance (\d+\.\d+)\. Camera bearing (-?\d+\.\d+)/);
  if (!cameraState) throw new Error("Camera state was not reported during travel");
  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(`Camera distance ${cameraState[1]}. Camera bearing ${cameraState[2]}`);
});

test("keeps the current system and offers a retry when a destination cannot load", async ({ page }) => {
  await page.goto("/");
  const destinationUrl = await page.evaluate(async () => {
    const [system, index] = await Promise.all([
      fetch("/data/systems/30002187.json").then((response) => response.json() as Promise<{ gates: { destinationSystemId: number; }[] }>),
      fetch("/data/universe-index.json").then((response) => response.json() as Promise<{ systems: { id: number; name: string }[] }>),
    ]);
    const ashabId = index.systems.find((entry) => entry.name === "Ashab")?.id;
    const ashabGate = system.gates.find((gate) => gate.destinationSystemId === ashabId);
    if (!ashabGate) throw new Error("Amarr has no gate to Ashab");
    return `**/data/systems/${ashabGate.destinationSystemId}.json`;
  });
  await page.route(destinationUrl, (route) => route.fulfill({ status: 503, body: "unavailable" }));

  await page.getByRole("button", { name: "Stargate to Ashab" }).click();

  await expect(page.getByRole("heading", { name: "Amarr" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Unable to load the destination system");
  const retry = page.getByRole("button", { name: "Retry stargate" });
  await expect(retry).toBeVisible();
  await page.unroute(destinationUrl);
  await retry.click();
  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
});

test("waits for the destination resource before starting travel", async ({ page }) => {
  await page.goto("/");
  const destinationUrl = await page.evaluate(async () => {
    const [system, index] = await Promise.all([
      fetch("/data/systems/30002187.json").then((response) => response.json() as Promise<{ gates: { destinationSystemId: number; }[] }>),
      fetch("/data/universe-index.json").then((response) => response.json() as Promise<{ systems: { id: number; name: string }[] }>),
    ]);
    const ashabId = index.systems.find((entry) => entry.name === "Ashab")?.id;
    const ashabGate = system.gates.find((gate) => gate.destinationSystemId === ashabId);
    if (!ashabGate) throw new Error("Amarr has no gate to Ashab");
    return `**/data/systems/${ashabGate.destinationSystemId}.json`;
  });
  let releaseDestination: (() => void) | undefined;
  const destinationReady = new Promise<void>((resolve) => { releaseDestination = resolve; });
  await page.route(destinationUrl, async (route) => {
    await destinationReady;
    await route.continue();
  });

  const scene = page.getByRole("application", { name: "Interactive star system centered on Amarr's star" });
  await page.getByRole("button", { name: "Stargate to Ashab" }).click();
  await expect(scene).not.toHaveAttribute("data-travel-phase", /.{1,}/);
  releaseDestination?.();
  await expect(scene).toHaveAttribute("data-travel-phase", "accelerating");
});

test("renders constellation glyphs from real stars instead of the retired markers", async ({ page }) => {
  await page.goto("/?snapshotTime=0");

  const scene = page.getByRole("application");
  await expect(page.getByRole("complementary", { name: "Constellation symbol" })).toHaveCount(0);
  await expect(scene).toHaveAttribute("data-constellation-glyph-count", /[1-9]\d*/);
  await expect(scene).toHaveAttribute("data-constellation-spike-star-count", /[1-9]\d*/);
  await expect(scene).toHaveAttribute("data-constellation-spikes-per-star", "8");
  await expect(scene).not.toHaveAttribute("data-constellation-marker-count", /.*/);
});

test("draws a glyph star wider the closer its solar system is", async ({ page }) => {
  await page.goto("/?snapshotTime=0");

  const scene = page.getByRole("application");
  await expect(scene).toHaveAttribute("data-constellation-star-diameters", /[\d.]+:[\d.]+/);
  const [narrowest, widest] = (await scene.getAttribute("data-constellation-star-diameters"))!.split(":").map(Number);
  // The sky over the starting system spans a few light years of glyph stars, so the nearest has to
  // come out markedly wider than the farthest - a size cue that only varied by a hair would read as
  // every star being drawn the same.
  expect(widest).toBeGreaterThan(narrowest * 1.3);
});

test("draws every figure out to the same share of its own constellation", async ({ page }) => {
  await page.goto("/?snapshotTime=0");

  const scene = page.getByRole("application");
  await expect(scene).toHaveAttribute("data-constellation-glyph-reach", /[\d.]+:[\d.]+/);
  const [smallest, largest] = (await scene.getAttribute("data-constellation-glyph-reach"))!.split(":").map(Number);
  // A figure is framed on its constellation rather than fitted to whichever systems its anchors
  // reached, so every figure in the sky comes out at one multiple of its own constellation's radius.
  // The figures used to range from a quarter of that radius to a third over it, which is what made a
  // glyph read as artwork standing beside its stars instead of as the same object.
  expect(smallest).toBeCloseTo(1.15, 2);
  expect(largest).toBeCloseTo(1.15, 2);
});

test("keeps drawing constellation glyphs and their spiked stars while decelerating through a stargate", async ({ page }) => {
  await page.goto("/?snapshotTime=0");
  await page.getByRole("button", { name: "Stargate to Ashab" }).click();

  // The glyph layer is rebuilt for the destination mid-journey; the point of the assertion is that
  // it never goes empty while doing so, which is what a torn-down-and-rebuilt layer would look like.
  const scene = page.getByRole("application", { name: "Interactive star system centered on Ashab's star" });
  await expect(scene).toHaveAttribute("data-travel-phase", "decelerating");
  await expect(scene).toHaveAttribute("data-constellation-glyph-count", /[1-9]\d*/);
  await expect(scene).toHaveAttribute("data-constellation-spike-star-count", /[1-9]\d*/);
  await expect(scene).toHaveAttribute("data-constellation-spikes-per-star", "8");
});

test("keeps stargate labels projection-anchored while the camera rotates", async ({ page }) => {
  await page.goto("/");

  const gate = page.getByRole("button", { name: "Stargate to Ashab" });
  await expect(gate).toBeVisible();
  const before = await gate.boundingBox();
  const cameraStatus = page.getByRole("status");
  const beforeCameraStatus = await cameraStatus.textContent();

  if (!before) throw new Error("Stargate has no bounds");

  await page.locator(".scene-input").evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 400, clientY: 400, pointerId: 1 }));
    element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 540, clientY: 400, pointerId: 1 }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 540, clientY: 400, pointerId: 1 }));
  });

  await expect(cameraStatus).not.toHaveText(beforeCameraStatus ?? "");
  await expect(gate).toBeVisible();
  await expect.poll(async () => {
    const after = await gate.boundingBox();
    return after && Math.hypot(after.x - before.x, after.y - before.y);
  }).toBeGreaterThan(10);
});

test("camera keeps its distance while rotating and zooms within its safe range", async ({ page }) => {
  await page.goto("/");
  const scene = page.getByRole("application", { name: "Interactive star system centered on Amarr's star" });
  // Amarr's dynamic zoom range (nearest orbit to farthest object, with margin) is 0.04-6.99 scene units; wait for it to settle before reading exact numbers.
  await expect(scene).toHaveAttribute("data-orbit-count", "9");
  await expect(page.getByRole("status")).toContainText("Camera distance 6.99");
  const initialStatus = await page.getByRole("status").textContent();
  const box = await scene.boundingBox();

  if (!box) throw new Error("Scene canvas has no bounds");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 40);
  await page.mouse.up();
  await expect(page.getByRole("status")).not.toHaveText(initialStatus ?? "");
  await expect(page.getByRole("status")).toContainText("Camera distance 6.99");

  await scene.hover();
  await page.mouse.wheel(0, -10000);
  await expect(page.getByRole("status")).toContainText("Camera distance 0.04");
  await page.mouse.wheel(0, 100000);
  await expect(page.getByRole("status")).toContainText("Camera distance 6.99");
});

test("mobile scene remains directly manipulable without a control panel", async ({ page }, testInfo) => {
  await page.goto("/");
  const scene = page.getByRole("application", { name: "Interactive star system centered on Amarr's star" });
  await expect(scene).toHaveAttribute("data-render-profile", testInfo.project.name === "mobile" ? "mobile" : "desktop");
  const before = await page.getByRole("status").textContent();
  const box = await scene.boundingBox();

  if (!box) throw new Error("Scene canvas has no bounds");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 35);
  await page.mouse.up();

  await expect(page.getByRole("status")).not.toHaveText(before ?? "");
  await expect(page.getByRole("button", { name: /^Stargate to / })).toHaveCount(6);
});

test("mobile quality retains orbital context and the stargate jump preview tree", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "This assertion covers the mobile render profile.");
  await page.goto("/");

  await expect(page.getByRole("application")).toHaveAttribute("data-orbit-count", "9");
  await expect(page.getByRole("button", { name: /^Select / })).toHaveCount(0);
  const gates = page.getByRole("button", { name: /^Stargate to / });
  await expect(gates).toHaveCount(6);
  await gates.first().hover();
  await expect(page.getByRole("region", { name: "Jump preview tree" }).getByRole("listitem")).not.toHaveCount(0);
  await expect(page.getByRole("application")).toHaveAttribute("data-jump-preview-edges", /.+/);
});

test("reduced motion keeps stargate navigation available without decorative transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.route("**/data/systems/*.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });

  const scene = page.getByRole("application", { name: "Interactive star system centered on Amarr's star" });
  const gate = page.getByRole("button", { name: "Stargate to Ashab" });
  await expect(scene).toHaveAttribute("data-reduced-motion", "true");
  await expect(scene).toHaveAttribute("data-ambient-flight-trails", "disabled");
  await gate.focus();
  await gate.click();
  await expect(page.getByRole("region", { name: "Jump preview tree" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ashab" })).toBeVisible();
  await expect(page.getByRole("application", { name: "Interactive star system centered on Ashab's star" })).not.toHaveAttribute("data-travel-phase");
});

test("touch pinch changes the camera distance", async ({ page }) => {
  await page.goto("/");
  // Wait for Amarr's dynamic zoom range to settle so the pinch starts from a known camera distance (6.99).
  await expect(page.getByRole("status")).toContainText("Camera distance 6.99");
  const input = page.locator(".scene-input");

  await input.evaluate((element) => {
    const emit = (type: string, pointerId: number, clientX: number) => {
      element.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY: 200, pointerId, pointerType: "touch" }));
    };

    emit("pointerdown", 1, 100);
    emit("pointerdown", 2, 200);
    emit("pointermove", 2, 400);
  });

  await expect(page.getByRole("status")).toContainText("Camera distance 2.33");
});

test("reports a WebGL context loss instead of leaving an empty page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toBeVisible();
  await page.locator("canvas").dispatchEvent("webglcontextlost");

  await expect(page.getByRole("alert")).toContainText("WebGL is unavailable");
});
