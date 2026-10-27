import { expect, test } from '@playwright/test';

test('works offline after the first visit (verified by reloading without a network)', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('tablist', { name: 'Laboratories' })).toBeVisible();
  // Wait until the worker controls the page and reports a complete cache.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 30_000 });
  await page.getByRole('button', { name: 'About and help' }).click();
  await expect(page.getByTestId('offline-status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await page.keyboard.press('Escape');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Laboratories' })).toBeVisible();
  await expect(page.getByTestId('inspector-stored')).toBeVisible();

  // Every laboratory (lazy chunks, chart library and the compute worker) loads from the cache.
  await page.getByRole('tab', { name: /Quantization/ }).click();
  await expect(page.getByRole('table').filter({ hasText: 'MSE' }).first()).toBeVisible();
  await page.getByRole('tab', { name: /Matri/ }).click();
  await expect(page.getByText(/max \|error\|/i).first()).toBeVisible();
  await page.getByRole('tab', { name: /Network/ }).click();
  await expect(page.getByTestId('nn-summary')).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();

  // A deep link inside the app is answered with the cached shell.
  await page.goto('./?from=offline');
  await expect(page.getByRole('tablist', { name: 'Laboratories' })).toBeVisible();
  expect(errors).toEqual([]);
  await context.setOffline(false);
});
