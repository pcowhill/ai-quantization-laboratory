import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto('./');
  await page.evaluate(() => indexedDB.deleteDatabase('ai-quantization-laboratory'));
  await page.goto('./');
});

test('inspect a number, flip a bit and compare formats', async ({ page }) => {
  const input = page.getByTestId('inspector-input');
  await input.fill('0.1');
  await expect(page.getByTestId('inspector-stored')).toHaveText('0.0999755859375');
  await expect(page.getByTestId('inspector-hex')).toHaveText('0x2E66');
  // flip the sign bit
  await page.getByTestId('bit-0').click();
  await expect(page.getByTestId('inspector-stored')).toHaveText('−0.0999755859375');
  // compare formats
  await page.getByTestId('inspector-input').fill('70000');
  const rows = page.getByTestId('compare-table').locator('tbody tr');
  await expect(rows).toHaveCount(9);
  await expect(rows.filter({ hasText: 'FP16' }).first()).toContainText('+∞');
  await expect(rows.filter({ hasText: 'BF16' }).first()).toContainText('70144');
  // switch format via the selector
  await page.getByTestId('inspector-format').selectOption('fp8_e4m3');
  await expect(page.getByTestId('inspector-stored')).toContainText('NaN');
});

test('load a dataset, change the quantization method and see metrics update', async ({ page }) => {
  await page.getByRole('tab', { name: /Quantization/ }).click();
  await page.getByTestId('data-catalog').selectOption('single-outlier');
  const mseCell = page.getByTestId('metrics-table').locator('tbody tr').first().locator('td[data-metric="mse"]');
  await expect(mseCell).toBeVisible();
  const before = await mseCell.textContent();
  await page.getByTestId('wb-calibration').selectOption('percentile');
  await expect(mseCell).not.toHaveText(before!);
  await page.getByTestId('wb-format').selectOption('int4');
  await expect(page.getByTestId('storage-total')).toContainText('KiB');
  await expect(page.getByTestId('chart-distribution')).toBeVisible();
});

test('import a CSV file', async ({ page }) => {
  await page.getByRole('tab', { name: /Quantization/ }).click();
  await page.getByRole('radio', { name: 'Import' }).click();
  await page.getByTestId('data-file').setInputFiles({ name: 'weights.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b,c\n0.5,-1.25,3\n2,0.001,-7\n') });
  await expect(page.getByTestId('import-notes')).toContainText('Imported 2×3');
  await expect(page.getByTestId('metrics-table').locator('tbody tr')).toHaveCount(3);
  // a malformed file is rejected with a precise message
  await page.getByTestId('data-file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('1,2\n3\n') });
  await expect(page.getByTestId('import-errors')).toContainText('Row 2 has 1 values');
});

test('matrix laboratory: integer kernel path and trace', async ({ page }) => {
  await page.getByRole('tab', { name: /Matri/ }).click();
  await page.getByTestId('matrix-preset').selectOption('stagnation');
  await expect(page.getByTestId('matrix-results').locator('tbody tr')).toHaveCount(1);
  const err = await page.getByTestId('matrix-max-error').textContent();
  await page.getByTestId('ar-acc').selectOption('fp32');
  await expect(page.getByTestId('matrix-max-error')).not.toHaveText(err!);
  await page.getByTestId('matrix-preset').selectOption('int8-kernel');
  await expect(page.getByTestId('matrix-results')).toContainText('Integer kernel');
  await expect(page.getByTestId('dot-trace').locator('tbody tr')).toHaveCount(32);
});

test('undo and redo restore laboratory state', async ({ page }) => {
  await page.getByTestId('inspector-input').fill('1/3');
  await expect(page.getByTestId('inspector-stored')).toHaveText('0.333251953125');
  await page.waitForTimeout(500);
  await page.getByTestId('inspector-format').selectOption('bf16');
  await expect(page.getByTestId('inspector-stored')).toHaveText('0.333984375');
  await page.waitForTimeout(500);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('inspector-stored')).toHaveText('0.333251953125');
  await page.getByTestId('redo').click();
  await expect(page.getByTestId('inspector-stored')).toHaveText('0.333984375');
});
