import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect as baseExpect, test, type Locator, type Page } from '@playwright/test';

import { chooseBase, enterAsGuest, openCategory, tr } from './support';

/*
 * What a new character is offered, per body base. The name stays empty on
 * purpose: nameless drafts are never autosaved, so these tests write nothing.
 */

const c = tr.Creator;

/*
 * Headless Chromium renders the stage in software: while it warms up, the
 * page's main thread can stall for well over ten seconds, and every DOM read
 * waits with it. Generous timeouts, and one worker for the fixture tests, keep
 * that from reading as a failure.
 */
const expect = baseExpect.configure({ timeout: 30_000 });

/** Skin sets of the fixture manifest, by the gender of the face that owns them. */
const FIXTURE_SKINS = {
  female: ['Ada', 'Aera', 'Aoi', 'Danielle', 'Hana', 'Malika', 'Valerie', 'Zuri'],
  male: ['Bruce', 'Cooper', 'Ettore', 'Lucian', 'Omar', 'Taro', 'Trey', 'Wallace'],
};

async function openCreator(page: Page, query = '?fixture=1'): Promise<void> {
  await enterAsGuest(page);
  await page.goto(`/tr/create${query}`);
  await expect(page.getByRole('tablist', { name: c.categoriesLabel })).toBeVisible({
    timeout: 60_000,
  });
}

/** Accessible names of a group's radios, trimmed and sorted. */
async function radioNames(group: Locator): Promise<string[]> {
  const names = await group.getByRole('radio').allInnerTexts();
  return names.map((name) => name.trim()).sort((a, b) => a.localeCompare(b));
}

test.describe('creator options (fixture manifest)', () => {
  test.describe.configure({ mode: 'default' });

  test('a new character starts in underwear, with no garment picked', async ({ page }) => {
    test.setTimeout(120_000);
    await openCreator(page);

    for (const base of ['female', 'male'] as const) {
      // Female is the default base; male comes from switching, which keeps it undressed.
      if (base === 'male') await chooseBase(page, 'male');
      const panel = await openCategory(page, c.categories.outfit);
      const slots = panel.getByRole('radiogroup', { name: c.outfit.slotsLabel, exact: true });

      for (const slot of ['top', 'bottom', 'shoes', 'full'] as const) {
        await slots.getByRole('radio', { name: c.outfit.slots[slot], exact: true }).click();
        const grid = panel.getByRole('radiogroup', { name: c.outfit.slots[slot], exact: true });
        const picked = grid.getByRole('radio', { checked: true });
        await expect(picked, `${base} ${slot}`).toHaveAccessibleName(c.outfit.none);
      }
    }
  });

  test('skins follow the base gender and an off-gender pick is replaced', async ({ page }) => {
    test.setTimeout(120_000);
    await openCreator(page);
    const skinGroup = (panel: Locator) =>
      panel.getByRole('radiogroup', { name: c.skin.sets, exact: true });

    // Female base: only female skins. Pick one the male base cannot keep.
    let panel = await openCategory(page, c.categories.skin);
    await expect(skinGroup(panel).getByRole('radio')).toHaveCount(FIXTURE_SKINS.female.length);
    await expect.poll(() => radioLabels(skinGroup(panel))).toEqual(FIXTURE_SKINS.female);
    const zuri = skinGroup(panel).getByRole('radio', { name: 'Zuri', exact: true });
    await zuri.click();
    await expect(zuri).toHaveAttribute('aria-checked', 'true');

    // Male base: only male skins, and the female pick is gone for a male one.
    await chooseBase(page, 'male');
    panel = await openCategory(page, c.categories.skin);
    await expect(skinGroup(panel).getByRole('radio')).toHaveCount(FIXTURE_SKINS.male.length);
    await expect.poll(() => radioLabels(skinGroup(panel))).toEqual(FIXTURE_SKINS.male);
    const picked = skinGroup(panel).getByRole('radio', { checked: true });
    await expect(picked).toHaveCount(1);
    expect(FIXTURE_SKINS.male).toContain(await picked.getAttribute('aria-label'));

    // And back: the female list returns with a female skin selected.
    await chooseBase(page, 'female');
    panel = await openCategory(page, c.categories.skin);
    await expect.poll(() => radioLabels(skinGroup(panel))).toEqual(FIXTURE_SKINS.female);
    const back = skinGroup(panel).getByRole('radio', { checked: true });
    await expect(back).toHaveCount(1);
    expect(FIXTURE_SKINS.female).toContain(await back.getAttribute('aria-label'));
  });

  test('a framing picked over the stage reads as pressed until the next category', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openCreator(page);
    const framing = page.getByRole('group', { name: c.camera.label, exact: true });
    const preset = (name: keyof typeof c.camera.presets) =>
      framing.getByRole('button', { name: c.camera.presets[name], exact: true });

    // Identity frames the whole body; the bust is a pick of one's own.
    await expect(preset('body')).toHaveAttribute('aria-pressed', 'true');
    await preset('torso').click();
    await expect(preset('torso')).toHaveAttribute('aria-pressed', 'true');
    await expect(preset('body')).toHaveAttribute('aria-pressed', 'false');

    // A new category frames itself again: the face tab shows the face.
    await openCategory(page, c.categories.face);
    await expect(preset('head')).toHaveAttribute('aria-pressed', 'true');
    await expect(preset('torso')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the male body has no curvy preset and a curvy pick lands on average', async ({ page }) => {
    test.setTimeout(120_000);
    await openCreator(page);
    const names = c.body.presetNames;
    const presetGroup = (panel: Locator) =>
      panel.getByRole('radiogroup', { name: c.body.presets, exact: true });

    let panel = await openCategory(page, c.categories.body);
    // Schema order; curvy is the female body's own.
    await expect(presetGroup(panel).getByRole('radio')).toHaveText([
      names.slim,
      names.average,
      names.athletic,
      names.curvy,
    ]);
    const curvy = presetGroup(panel).getByRole('radio', { name: names.curvy, exact: true });
    await curvy.click();
    await expect(curvy).toHaveAttribute('aria-checked', 'true');

    await chooseBase(page, 'male');
    panel = await openCategory(page, c.categories.body);
    await expect(presetGroup(panel).getByRole('radio')).toHaveText([
      names.slim,
      names.average,
      names.athletic,
    ]);
    await expect(presetGroup(panel).getByRole('radio', { checked: true })).toHaveAccessibleName(
      names.average,
    );
  });
});

/** Swatch radios carry their skin name as aria-label; sorted for comparison. */
async function radioLabels(group: Locator): Promise<string[]> {
  const labels = await group
    .getByRole('radio')
    .evaluateAll((radios) => radios.map((radio) => radio.getAttribute('aria-label') ?? ''));
  return labels.sort((a, b) => a.localeCompare(b));
}

/*
 * Groom labels on the real manifest. The pipeline writes each style's {tr, en}
 * label from groom_labels.json; an archive built before that still carries the
 * converter's English names, so the manifest is served with the same labels
 * applied (a no-op once the archive is rebuilt). The test is about the web:
 * a Turkish page shows the Turkish names, never raw ids.
 */
const GROOM_LABELS = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../pipeline/src/asset_pipeline/mh/groom_labels.json'),
    'utf8',
  ),
) as Record<string, { tr: string; en: string }>;

interface ManifestGroom {
  id: string;
  label: string | { tr: string; en: string };
}

test('groom styles show their Turkish labels, not raw ids', async ({ page, request }) => {
  test.setTimeout(180_000);
  const manifest = await request.get('/assets/mh/manifest.json');
  test.skip(!manifest.ok(), 'No MetaHuman export on this machine');

  await page.route('**/assets/mh/manifest.json', async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { grooms: ManifestGroom[] };
    json.grooms = json.grooms.map((groom) => {
      const label = GROOM_LABELS[groom.id.split('.').slice(2).join('.')];
      return typeof groom.label === 'string' && label ? { ...groom, label } : groom;
    });
    await route.fulfill({ response, json });
  });
  // Only the option lists matter here: skip the heavy meshes and textures.
  await page.route(/\/assets\/mh\/.+\.(glb|ktx2)$/, (route) => route.fulfill({ status: 404 }));

  const turkish = new Set(Object.values(GROOM_LABELS).map((label) => label.tr));
  const english = new Set(Object.values(GROOM_LABELS).map((label) => label.en));
  const expectTurkish = async (group: Locator, none: string) => {
    await expect(group.getByRole('radio').nth(1)).toBeVisible();
    const names = (await radioNames(group)).filter((name) => name !== none);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name, 'a raw groom id').not.toMatch(/_/);
      expect(english.has(name) && !turkish.has(name), `"${name}" is the English label`).toBe(false);
      expect(turkish, `"${name}" is not a curated Turkish label`).toContain(name);
    }
  };

  await openCreator(page, '');

  // Hair on the default (female) base.
  let panel = await openCategory(page, c.categories.hair);
  await expectTurkish(
    panel.getByRole('radiogroup', { name: c.hair.styles, exact: true }),
    c.hair.none,
  );

  // Brows, beards and moustaches on the male base.
  await chooseBase(page, 'male');
  panel = await openCategory(page, c.categories.facialHair);
  for (const slot of ['eyebrows', 'beard', 'mustache'] as const) {
    await expectTurkish(
      panel.getByRole('radiogroup', { name: c.facialHair[slot], exact: true }),
      c.facialHair.none,
    );
  }
});
