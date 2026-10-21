import { expect, test } from '@playwright/test';

import { en, tr } from './support';

test.describe('landing', () => {
  test('renders the Turkish landing with its call to action', async ({ page }) => {
    await page.goto('/tr');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(tr.Landing.hero.titleLine1);
    await expect(page.getByRole('button', { name: tr.Landing.hero.cta }).first()).toBeVisible();
  });

  test('renders the English landing', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(en.Landing.hero.titleLine1);
  });
});
