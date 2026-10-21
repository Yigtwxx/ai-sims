import { expect, test } from '@playwright/test';

import { tr } from './support';

// The curation screen exists in development (the server Playwright reuses) only.
test('curation screen lists the asset categories', async ({ page }) => {
  const response = await page.goto('/tr/curate?fixture=1');
  test.skip(response?.status() === 404, 'Curation is off on this server');

  await expect(page.getByRole('heading', { level: 1, name: tr.Curate.title })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: tr.Curate.tabsLabel });
  await expect(tabs.getByRole('tab')).toHaveCount(8);
  await expect(page.getByText(tr.Curate.status.fixture)).toBeVisible();

  // Hiding an item marks it and counts it as unsaved work (saving is off on fixtures).
  const first = page.getByRole('tabpanel').getByRole('listitem').first();
  await first.getByRole('button', { name: /gizle$/ }).click();
  await expect(first.getByText(tr.Curate.item.hidden)).toBeVisible();
  await expect(page.getByRole('button', { name: tr.Curate.save })).toBeDisabled();
});
