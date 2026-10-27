import { expect, test } from '@playwright/test';

test('application shell loads without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'AI Quantization Laboratory' })).toBeVisible();
  expect(errors).toEqual([]);
});
