import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Runs axe (WCAG 2.1 A/AA rules) and returns readable violations. */
async function audit(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Chart canvases are decorative to axe; each has a labelled region and a table view.
    .exclude('canvas')
    .analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`no WCAG A/AA violations in any laboratory or panel (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('./');
    await expect(page.getByTestId('inspector-stored')).toBeVisible();
    const found: string[] = [];
    found.push(...(await audit(page)).map((v) => `inspector: ${v}`));
    for (const [name, label] of [[/Quantization/, 'workbench'], [/Matri/, 'matrix'], [/Network/, 'network']] as const) {
      await page.getByRole('tab', { name }).click();
      await page.waitForTimeout(1200);
      found.push(...(await audit(page)).map((v) => `${label}: ${v}`));
    }
    await page.getByTestId('open-experiments').click();
    const panel = page.getByTestId('experiments');
    await expect(panel).toBeVisible();
    found.push(...(await audit(page)).map((v) => `experiments/current: ${v}`));
    // An armed confirmation button, still under the pointer, must stay readable.
    await panel.getByTestId('reset-matrix').click();
    found.push(...(await audit(page)).map((v) => `experiments/armed confirm: ${v}`));
    await panel.getByRole('radio', { name: 'All experiments' }).click();
    await panel.getByTestId('exp-import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(panel.getByTestId('import-errors')).toBeVisible();
    found.push(...(await audit(page)).map((v) => `experiments/library: ${v}`));
    await panel.getByRole('radio', { name: 'Compare' }).click();
    await panel.getByTestId('compare-run').click();
    await expect(panel.getByTestId('compare-result')).toBeVisible();
    found.push(...(await audit(page)).map((v) => `experiments/compare: ${v}`));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'About and help' }).click();
    await expect(page.getByTestId('help')).toBeVisible();
    found.push(...(await audit(page)).map((v) => `help: ${v}`));
    await page.keyboard.press('Escape');
    await page.getByTestId('open-lessons').click();
    await expect(page.getByTestId('lesson-catalog')).toBeVisible();
    found.push(...(await audit(page)).map((v) => `lesson catalog: ${v}`));
    await page.getByTestId('start-lesson-networks').click();
    await expect(page.getByTestId('lesson-panel')).toBeVisible();
    await page.waitForTimeout(1200);
    found.push(...(await audit(page)).map((v) => `lesson: ${v}`));
    expect(found).toEqual([]);
  });
}
