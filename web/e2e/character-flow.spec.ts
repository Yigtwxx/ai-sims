import { expect, test } from '@playwright/test';

import { format, mockConversation, tr } from './support';

/*
 * The whole path a new visitor takes: enter as a guest, find an empty list,
 * build a character (fixture manifest), finish it, talk to it with the AI
 * and TTS routes intercepted, then find it in the list after a reload.
 */
test('guest creates a character, talks to it and finds it again', async ({ page }) => {
  test.setTimeout(240_000);
  const name = `E2E ${Date.now() % 100_000}`;
  const reply = 'Merhaba! Ben buradayım. Bugün neyi merak ediyorsun?';
  const chatCalls = await mockConversation(page, reply);

  // Enter as a guest from the header; the empty list greets us.
  await page.goto('/tr');
  await page.getByRole('banner').getByRole('button', { name: tr.Session.enter }).click();
  await expect(page).toHaveURL(/\/tr\/characters$/, { timeout: 60_000 });
  await expect(page.getByText(tr.Characters.empty.title)).toBeVisible({ timeout: 60_000 });

  // Build a character on the fixture manifest.
  await page.goto('/tr/create?fixture=1');
  const nameField = page.getByLabel(tr.Creator.nameLabel);
  await expect(nameField).toBeVisible({ timeout: 60_000 });
  await nameField.fill(name);

  await page.getByRole('tab', { name: tr.Creator.categories.face }).click();
  const hana = page.getByRole('tabpanel').getByRole('radio', { name: 'Hana', exact: true }).first();
  await hana.click();
  await expect(hana).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('tab', { name: tr.Creator.categories.hair }).click();
  const hairStyle = page
    .getByRole('tabpanel')
    .getByRole('radiogroup')
    .first()
    .getByRole('radio')
    .nth(2);
  await hairStyle.click();
  await expect(hairStyle).toHaveAttribute('aria-checked', 'true');

  // Autosave turns the draft into a saved character and the URL into its edit page.
  await expect(page).toHaveURL(/\/tr\/characters\/[^/]+\/edit\?fixture=1$/, { timeout: 30_000 });
  await expect(page.getByText(tr.Creator.autosave.saved)).toBeVisible({ timeout: 30_000 });

  // Done: finalize, thumbnail, premiere, then on to the conversation.
  await page.getByRole('button', { name: tr.Creator.actions.done, exact: true }).click();
  await page.getByRole('button', { name: tr.Creator.premiere.start }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/tr\/characters\/[^/]+\/talk\?fixture=1$/, { timeout: 60_000 });

  // Talk: the reply streams into the log; the AI never leaves the test.
  const input = page.getByLabel(tr.Talk.chat.inputLabel);
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill('Merhaba');
  await input.press('Enter');
  const log = page.getByRole('log', { name: tr.Talk.chat.log });
  await expect(log).toContainText('Merhaba', { timeout: 30_000 });
  await expect(log).toContainText(reply, { timeout: 30_000 });
  expect(chatCalls).toHaveLength(1);
  expect(chatCalls[0].locale).toBe('tr');
  expect(chatCalls[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'Merhaba' });

  // The list shows the finished character, and it survives a reload.
  await page.goto('/tr/characters');
  const card = page.getByRole('link', { name: `${name}, ${tr.Characters.actions.talk}` });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(card).toBeVisible({ timeout: 60_000 });

  // Clean up through the UI, which also covers deleting.
  await page.getByRole('button', { name: `${tr.Characters.actions.delete}: ${name}` }).click();
  const dialog = page.getByRole('alertdialog', {
    name: format(tr.Characters.deleteDialog.title, { name }),
  });
  await dialog.getByRole('button', { name: tr.Characters.deleteDialog.confirm }).click();
  await expect(card).toBeHidden({ timeout: 30_000 });
});
