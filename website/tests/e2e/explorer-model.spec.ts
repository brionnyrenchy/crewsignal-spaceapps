import { test, expect } from '@playwright/test';

test('Explorer renders the bundled model, synchronizes selection, rotates, and recovers from context loss', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(url.href);
  });
  await page.goto('/demo/explorer');
  const model = page.getByTestId('body-model-view');
  const canvas = model.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(model.getByText('Loading 3D model.')).toHaveCount(0);
  await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).getContext('webgl2')?.getError())).toBe(0);

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Model has no visible canvas');
  await canvas.click({ position: { x: box.width / 2, y: box.height * 0.35 } });
  await expect(page.getByRole('tab', { name: 'Cardiovascular', exact: true })).toHaveAttribute('aria-selected', 'true');

  const before = await canvas.screenshot();
  await model.getByRole('button', { name: 'Rotate left', exact: true }).click();
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await model.getByRole('button', { name: 'Reset view', exact: true }).click();

  await model.getByRole('button', { name: /Select.*chest/i }).click();
  await expect(page.getByRole('tab', { name: 'Cardiovascular', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Musculoskeletal', exact: true }).click();
  await expect(model.getByTestId('body-model-caption')).toContainText('Musculoskeletal');
  await canvas.screenshot({ path: 'test-results/explorer-model.png' });

  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await expect(page.locator('.body-explorer-visual svg')).toBeVisible();
  await expect(canvas).toHaveCount(0);
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(canvas).toBeVisible();
  await canvas.evaluate(element => {
    (element as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.getByTestId('body-visual-status')).toContainText('could not be shown');
  await expect(page.locator('.body-explorer-visual svg')).toBeVisible();
  await page.getByRole('button', { name: 'Try the 3D model again' }).click();
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('body-visual-status')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Musculoskeletal', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('reduced motion defaults to the diagram and permits an explicit 3D choice on a narrow viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/demo/explorer');
  await expect(page.getByTestId('body-visual-status')).toContainText('reduced motion');
  await expect(page.locator('.body-explorer-visual svg')).toBeVisible();
  await page.getByRole('button', { name: '3D model', exact: true }).click();
  await expect(page.getByTestId('body-model-view').locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('graphics-unavailable devices retain the diagram and system selection', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === 'webgl2') return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto('/demo/explorer');
  await expect(page.getByTestId('body-visual-status')).toContainText('not available');
  await expect(page.locator('.body-explorer-visual svg')).toBeVisible();
  await expect(page.getByRole('button', { name: '3D model', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Cardiovascular', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Cardiovascular', exact: true })).toHaveAttribute('aria-selected', 'true');
});
