import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Health Explorer 3D model, rendered by the real three.js scene in Chromium
 * (software WebGL2). These are harness results; installed-app and device
 * checks are recorded separately in EVIDENCE.md.
 */

async function openExplorer(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/11 observations across 5 of 6 types/i)).toBeVisible();
  await page.getByRole("button", { name: /^Health Explorer$/i }).first().click();
  await expect(page.getByRole("heading", { name: "Health Explorer", level: 1 })).toBeVisible();
}

const stage = (page: Page) => page.getByRole("img", { name: /3D anatomical navigation illustration/ });

async function waitForModel(page: Page) {
  await expect(stage(page)).toBeVisible();
  await expect(page.getByText("Loading 3D model…")).toHaveCount(0, { timeout: 15_000 });
  await expect(stage(page).locator("canvas")).toHaveCount(1);
}

/** Tap at a fraction of the model stage (figure faces the default camera). */
async function tapStage(page: Page, fx: number, fy: number) {
  const box = (await stage(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

const detailHeading = (page: Page, name: string) => page.getByRole("heading", { name, level: 2 });
const listButton = (page: Page, name: RegExp) =>
  page.getByRole("group", { name: "Body systems" }).getByRole("button", { name });

test.describe("Health Explorer 3D model (harness)", () => {
  for (const size of [
    { width: 1440, height: 900, label: "wide" },
    { width: 900, height: 1200, label: "portrait" },
  ]) {
    test(`selects each region on the model and via the list, in agreement (${size.label})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openExplorer(page);
      await waitForModel(page);
      await expect(page.getByRole("button", { name: "3D model" })).toHaveAttribute("aria-pressed", "true");

      const regions = [
        { fx: 0.5, fy: 0.37, name: "Cardiovascular", list: /^Cardiovascular/ },
        { fx: 0.565, fy: 0.72, name: "Musculoskeletal", list: /^Musculoskeletal/ },
        { fx: 0.5, fy: 0.37, name: "Cardiovascular", list: /^Cardiovascular/ },
        { fx: 0.655, fy: 0.42, name: "Musculoskeletal", list: /^Musculoskeletal/ },
        { fx: 0.5, fy: 0.16, name: "Sleep & cognition", list: /^Sleep & cognition/ },
      ];
      for (const r of regions) {
        await tapStage(page, r.fx, r.fy);
        await expect(detailHeading(page, r.name)).toBeVisible();
        await expect(listButton(page, r.list)).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId("body-model-caption")).toContainText(r.name);
      }

      // Background taps and the gap between the legs select nothing new.
      await tapStage(page, 0.08, 0.95);
      await tapStage(page, 0.5, 0.8);
      await expect(detailHeading(page, "Sleep & cognition")).toBeVisible();

      // The list drives the model controls and the panel too.
      for (const name of ["Immune context", "Nutrition & metabolism", "Cardiovascular"]) {
        await listButton(page, new RegExp(`^${name}`)).click();
        await expect(detailHeading(page, name)).toBeVisible();
      }
      await expect(page.getByRole("button", { name: /Select Chest: Cardiovascular/ })).toHaveAttribute("aria-pressed", "true");

      // Next actions follow the same selection.
      await expect(page.getByRole("button", { name: /^Record heart rate$/i }).first()).toBeVisible();
    });
  }

  test("rotates by drag and buttons, resets, and does not select while dragging", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExplorer(page);
    await waitForModel(page);
    await listButton(page, /^Sleep & cognition/).click();

    const box = (await stage(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.37);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.37, { steps: 12 });
    await page.mouse.up();
    // A drag that ended on the torso must not select it.
    await expect(detailHeading(page, "Sleep & cognition")).toBeVisible();

    // After a half turn the torso is still under the centre (seen from behind).
    await page.getByRole("button", { name: "Reset view" }).click();
    for (let i = 0; i < 8; i += 1) await page.getByRole("button", { name: "Rotate left" }).click();
    await tapStage(page, 0.5, 0.37);
    await expect(detailHeading(page, "Cardiovascular")).toBeVisible();
    await page.getByRole("button", { name: "Reset view" }).click();
    await tapStage(page, 0.5, 0.16);
    await expect(detailHeading(page, "Sleep & cognition")).toBeVisible();
    await page.screenshot({ path: "test-results/body-model-wide.png", fullPage: false });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("button", { name: /^Settings$/i }).first().click();
    await page.getByRole("button", { name: /^Health Explorer$/i }).first().click();
    await waitForModel(page);
    await listButton(page, /^Cardiovascular/).click();
    await page.screenshot({ path: "test-results/body-model-dark.png", fullPage: false });
  });

  test("keyboard selection has visible focus and matches the list", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExplorer(page);
    await waitForModel(page);
    const chest = page.getByRole("button", { name: /Select Chest: Cardiovascular/ });
    await chest.focus();
    await page.keyboard.press("Enter");
    await expect(detailHeading(page, "Cardiovascular")).toBeVisible();
    await page.keyboard.press("Tab");
    const limbs = page.getByRole("button", { name: /Select Limbs: Musculoskeletal, Not assessed/ });
    await expect(limbs).toBeFocused();
    const outline = await limbs.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Space");
    await expect(listButton(page, /^Musculoskeletal/)).toHaveAttribute("aria-pressed", "true");
  });

  test("passes axe WCAG 2.2 AA with the model, in dark, light and forced colours", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const media of [{ colorScheme: "dark" as const }, { colorScheme: "light" as const }, { forcedColors: "active" as const }]) {
      await page.emulateMedia(media);
      await openExplorer(page);
      await waitForModel(page);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    }
    // Forced colours: selection is drawn in the system Highlight colour.
    const sel = await page.locator('[data-probe="selected"]').evaluate((el) => getComputedStyle(el).color);
    const idle = await page.locator('[data-probe="idle"]').evaluate((el) => getComputedStyle(el).color);
    expect(sel).not.toBe(idle);
    await page.screenshot({ path: "test-results/body-model-forced-colors.png" });
  });

  test("reduced motion starts on the diagram; the model stays one click away", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExplorer(page);
    await expect(page.getByRole("button", { name: "Diagram" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("body-visual-status")).toContainText("reduced motion");
    await expect(stage(page)).toHaveCount(0);
    await page.getByRole("button", { name: "3D model" }).click();
    await waitForModel(page);
  });

  test("simulated renderer failure: no WebGL2 falls back to the diagram and list", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === "webgl2" || type === "webgl") return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any).call(this, type, ...rest);
      };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExplorer(page);
    await expect(page.getByTestId("body-visual-status")).toContainText("3D graphics are not available");
    await expect(page.getByRole("button", { name: "3D model" })).toHaveCount(0);
    await page.getByRole("button", { name: /Select Musculoskeletal/ }).click();
    await expect(detailHeading(page, "Musculoskeletal")).toBeVisible();
    await listButton(page, /^Immune context/).click();
    await expect(detailHeading(page, "Immune context")).toBeVisible();
  });

  test("context loss falls back; hide/show frees and restores the renderer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openExplorer(page);
    await waitForModel(page);

    // Simulate backgrounding: hidden → renderer and canvas released.
    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
    await setHidden(true);
    await expect(stage(page).locator("canvas")).toHaveCount(0);
    await setHidden(false);
    await waitForModel(page);
    await tapStage(page, 0.5, 0.37);
    await expect(detailHeading(page, "Cardiovascular")).toBeVisible();

    // Simulated GPU loss while visible → diagram fallback, then retry.
    await stage(page)
      .locator("canvas")
      .evaluate((c: HTMLCanvasElement) => c.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext());
    await expect(page.getByTestId("body-visual-status")).toContainText("could not be shown");
    await expect(page.getByRole("group", { name: "Anatomical navigation diagram for body systems" })).toBeVisible();
    await page.getByRole("button", { name: "Try the 3D model again" }).click();
    await waitForModel(page);
  });

  test("records cold load time and responsiveness", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByText(/11 observations across 5 of 6 types/i)).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __longTasks: number[] }).__longTasks = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) (window as unknown as { __longTasks: number[] }).__longTasks.push(e.duration);
      }).observe({ type: "longtask", buffered: false });
    });
    const t0 = Date.now();
    await page.getByRole("button", { name: /^Health Explorer$/i }).first().click();
    await waitForModel(page);
    const coldLoadMs = Date.now() - t0;

    // Responsiveness during interaction: 30 drag steps, then a list click.
    const box = (await stage(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    const d0 = Date.now();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 30 });
    const dragMs = Date.now() - d0;
    await page.mouse.up();
    const c0 = Date.now();
    await listButton(page, /^Cardiovascular/).click();
    await expect(detailHeading(page, "Cardiovascular")).toBeVisible();
    const selectMs = Date.now() - c0;
    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    const metrics = {
      coldLoadMs,
      dragMsFor30Steps: dragMs,
      listSelectMs: selectMs,
      longTaskCount: longTasks.length,
      longestTaskMs: Math.round(Math.max(0, ...longTasks)),
    };
    console.log(`BODY_MODEL_METRICS ${JSON.stringify(metrics)}`);
    test.info().annotations.push({ type: "metrics", description: JSON.stringify(metrics) });
    expect(coldLoadMs).toBeLessThan(10_000);
  });
});
