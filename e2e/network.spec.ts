import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto('./');
  await page.evaluate(() => indexedDB.deleteDatabase('ai-quantization-laboratory'));
  await page.goto('./');
});

test('modify a network and observe quantized vs baseline predictions', async ({ page }) => {
  await page.getByRole('tab', { name: /Network/ }).click();
  await page.getByTestId('nn-scenario').selectOption('outlier');
  const rows = page.getByTestId('nn-summary').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('INT4 per-tensor');
  await expect(page.getByTestId('nn-map-var')).toBeVisible();
  // per-channel keeps more predictions than per-tensor
  const agree = page.getByTestId('nn-summary').locator('td[data-metric="agreement"]');
  const a1 = parseFloat((await agree.nth(0).textContent())!);
  const a2 = parseFloat((await agree.nth(1).textContent())!);
  expect(a2).toBeGreaterThan(a1);
  // change the architecture and rebuild with seeded weights
  await page.getByRole('button', { name: /Architecture & parameters/ }).click();
  await page.getByTestId('nn-rebuild').click();
  await expect(page.getByTestId('nn-preset')).toHaveValue('');
  await expect(rows).toHaveCount(4);
  // edit the input of the selected sample and add it as a new sample
  await page.getByRole('button', { name: 'Add as new sample' }).click();
  await expect(page.getByText('Predictions on 201 samples')).toBeVisible();
});

test('complete a guided walkthrough and return to the previous work', async ({ page }) => {
  await page.getByTestId('inspector-input').fill('42.5');
  await expect(page.getByTestId('inspector-stored')).toHaveText('42.5');
  await page.getByTestId('open-lessons').click();
  await page.getByTestId('start-lesson-fp8-fp4').click();
  const panel = page.getByTestId('lesson-panel');
  await expect(panel).toContainText('Two FP8 formats');
  await expect(page.getByTestId('inspector-stored')).toHaveText('288');
  await page.getByTestId('lesson-next').click();
  await expect(page.getByTestId('lesson-task')).toContainText('Try it');
  await page.getByRole('radio', { name: 'Saturating', exact: true }).click();
  await expect(page.getByTestId('lesson-task')).toContainText('Done!');
  await page.getByTestId('lesson-next').click();
  await page.getByTestId('lesson-show-me').click();
  await expect(page.getByTestId('lesson-task')).toContainText('Done!');
  await page.getByTestId('lesson-next').click();
  await page.getByTestId('lesson-next').click(); // Finish
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('inspector-input')).toHaveValue('42.5');
  await expect(page.getByTestId('inspector-stored')).toHaveText('42.5');
});
