import { expect, test } from '@playwright/test';

test('application shell loads without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('tablist', { name: 'Laboratories' })).toBeVisible();
  await expect(page.getByTestId('inspector-stored')).toBeVisible();
  for (const name of [/Quantization/, /Matri/, /Network/, /Numbers|Number Inspector/]) {
    await page.getByRole('tab', { name }).click();
  }
  expect(errors).toEqual([]);
});
