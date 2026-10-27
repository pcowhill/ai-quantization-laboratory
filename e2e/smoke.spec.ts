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

test('no horizontal page scroll and the theme toggle works', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('inspector-stored')).toBeVisible();
  for (const name of [/Quantization/, /Matri/, /Network/]) {
    await page.getByRole('tab', { name }).click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${String(name)}`).toBeLessThanOrEqual(0);
  }
  const html = page.locator('html');
  await page.getByTestId('theme-toggle').click(); // system → light
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click(); // light → dark
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgb(244, 245, 244)');
});
