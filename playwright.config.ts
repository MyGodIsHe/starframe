import { availableParallelism } from "node:os";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Every test drives its own page against a read-only static build, so nothing is shared between
  // them and they can all run at once. What limits the worker count is CPU, not isolation: each
  // page parses the 2.3MB universe index, builds a 5484-star celestial map, and renders it through
  // software WebGL, which is itself multi-threaded. At one worker per two cores the pages starve
  // each other and assertions time out on data that is merely late; a quarter of the cores leaves
  // each page the headroom it needs.
  fullyParallel: true,
  workers: Math.max(2, Math.floor(availableParallelism() / 4)),
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  // The default five seconds is tight for the first assertion on a page, which has to wait out the
  // index fetch and the first WebGL frame behind however many sibling pages are starting at once.
  expect: { timeout: 10_000 },
  // A test that jumps two stargates spends ten seconds in travel animation alone, before any of the
  // waiting above. Neither limit costs anything on a passing run; both buy room on a loaded machine.
  timeout: 60_000,
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
