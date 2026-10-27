import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('snapshot, compare, export and re-import an experiment; it survives a reload', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const input = page.getByTestId('inspector-input');
  const exact = page.getByTestId('inspector-exact-input');
  await input.fill('0.1');
  await expect(exact).toHaveText('0.1');

  // Rename and snapshot.
  await page.getByTestId('open-experiments').click();
  const panel = page.getByTestId('experiments');
  await panel.getByTestId('exp-name').fill('Point one study');
  await panel.getByTestId('exp-name').press('Enter');
  await panel.locator('#snap-name').fill('decimal 0.1');
  await panel.getByTestId('take-snapshot').click();
  await expect(panel.getByTestId('snapshot-list')).toContainText('decimal 0.1');
  await page.keyboard.press('Escape');

  // Change the state, then compare current vs the snapshot.
  await input.fill('1e-8');
  // The inspector commits typed text after a short debounce; wait until it has.
  await expect(exact).toHaveText('0.00000001');
  await page.getByTestId('open-experiments').click();
  await panel.getByRole('radio', { name: 'Compare' }).click();
  await panel.getByTestId('compare-b').selectOption({ label: 'Point one study › decimal 0.1' });
  await panel.getByTestId('compare-run').click();
  await expect(panel.getByTestId('compare-diff')).toContainText('inspector.input');
  await expect(panel.getByTestId('compare-diff')).toContainText('"1e-8"');

  // Export the experiment as a JSON file.
  await panel.getByRole('radio', { name: 'Current' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Export JSON' }).click()]);
  const file = testInfo.outputPath('export.json');
  await download.saveAs(file);
  const json = JSON.parse(readFileSync(file, 'utf8')) as { format: string; experiments: { name: string; snapshots: unknown[] }[] };
  expect(json.experiments[0]!.name).toBe('Point one study');
  expect(json.experiments[0]!.snapshots).toHaveLength(1);

  // Import it back: it appears as a separate experiment and becomes current.
  await panel.getByRole('radio', { name: 'All experiments' }).click();
  await panel.getByTestId('exp-import-file').setInputFiles(file);
  await expect(panel.getByTestId('experiment-list').locator('li')).toHaveCount(2);
  await expect(panel.getByTestId('experiment-list')).toContainText('Point one study (imported)');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('1e-8');

  // Invalid files are rejected with an explanation.
  await page.getByTestId('open-experiments').click();
  await panel.getByRole('radio', { name: 'All experiments' }).click();
  await panel.getByTestId('exp-import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"not":"an experiment"}') });
  await expect(panel.getByTestId('import-errors')).toBeVisible();
  await expect(panel.getByTestId('experiment-list').locator('li')).toHaveCount(2);

  // Everything is persisted locally.
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByTestId('open-experiments').click();
  await panel.getByRole('radio', { name: 'All experiments' }).click();
  await expect(panel.getByTestId('experiment-list').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('memory-only')).toHaveCount(0);
  expect(errors).toEqual([]);
});
