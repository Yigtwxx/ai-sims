import { expect, test } from '@playwright/test';

import { en, tr } from './support';

test.describe('landing', () => {
  test('renders the Turkish story and starts the creator from its last chapter', async ({
    page,
  }) => {
    await page.goto('/tr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr.Landing.story.idea.title);

    // The call to action fades in with the last chapter, at the end of the story.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const cta = page.getByRole('button', { name: tr.Landing.story.start.cta });
    await expect(cta).toBeVisible();
    await expect
      .poll(async () =>
        Number(await cta.evaluate((el) => getComputedStyle(el.closest('div[style]')!).opacity)),
      )
      .toBeGreaterThan(0.9);

    await cta.click();
    // Guest sign-in is a server action against MongoDB: beside the creator
    // tests' software-rendered stages it can take well over the default 5 s.
    await expect(page).toHaveURL(/\/tr\/create/, { timeout: 30_000 });
  });

  test('jumps between chapters from the step list', async ({ page }) => {
    await page.goto('/tr');
    const steps = page.getByRole('navigation', { name: tr.Landing.story.steps.label });
    await steps.getByRole('button', { name: tr.Landing.story.steps.lips }).click();
    await expect(steps.getByRole('button', { name: tr.Landing.story.steps.lips })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  test('renders the English landing', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.Landing.story.idea.title);
  });
});
