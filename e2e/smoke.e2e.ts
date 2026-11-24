/* The built app in a real browser: it opens without errors, reads a link, takes typed text, and the panels and
   undo answer the keyboard. The core and the state have their own unit tests; these only check that it all holds together. */
import { test as base, expect, type Page } from '@playwright/test';

/** Every test fails on an error the page throws or logs. */
const test = base.extend<{ noErrors: void }>({
  noErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const commandBox = (page: Page) => page.getByLabel('輸入任何時間文字');

test('a link opens with its start, zone and span', async ({ page }) => {
  await page.goto('./?s=2026-12-24T18:00&tz=Asia/Taipei&d=3h');
  await expect(field(page, '開始的時')).toHaveValue('18');
  await expect(field(page, '結束的日')).toHaveValue('24');
  await expect(field(page, '結束的時')).toHaveValue('21');
  await expect(page.getByRole('region', { name: '間隔' })).toContainText('+3小時');
  await expect(page.getByRole('region', { name: '時區' })).toContainText('東京');
});

test('typed text sets both ends, the address follows, and undo takes it back', async ({ page }) => {
  await page.goto('./');
  const box = commandBox(page);
  await box.fill('2000/1/1 到 2000/1/31');
  await box.press('Enter');
  await expect(field(page, '開始的年')).toHaveValue('2000');
  await expect(field(page, '結束的日')).toHaveValue('31');
  await expect(page.getByRole('region', { name: '間隔' })).toContainText('30天');
  await expect(page.getByRole('region', { name: '間隔' }).getByLabel('換算成各種單位')).toContainText('工作日');
  await expect(page.getByRole('region', { name: '讀法' }).getByLabel('換算成各種單位')).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.search === '?s=2000-01-01&e=2000-01-31');
  await box.blur();
  await page.keyboard.press('Control+z');
  await expect(field(page, '結束的年')).not.toHaveValue('2000');
  await expect(page).toHaveURL((url) => url.search === '');
});

test('panels answer the keyboard, and the calendar shows the whole year', async ({ page }) => {
  await page.goto('./');
  await commandBox(page).blur();
  const cal = page.getByRole('region', { name: '月曆' });
  await expect(cal).toBeVisible();
  await page.keyboard.press('5');
  await expect(cal).toBeHidden();
  await page.keyboard.press('0');
  await expect(cal).toBeVisible();
  await page.keyboard.press('y');
  await expect(cal.locator('.ym')).toHaveCount(12);
});

test('a shortcut dragged onto another row moves there', async ({ page }) => {
  await page.goto('./');
  const chips = (row: string) => page.locator(`[data-chip-row="${row}"] > [data-ci]`);
  const startCount = await chips('start').count();
  const spanCount = await chips('span').count();
  const a = (await chips('span').first().boundingBox())!;
  const z = (await chips('start').first().boundingBox())!;
  const ax = a.x + a.width / 2,
    ay = a.y + a.height / 2;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  // a few pixels first, on the chip itself, so the drag starts there
  await page.mouse.move(ax + 4, ay);
  await page.mouse.move(ax + 9, ay);
  await page.mouse.move(z.x + 3, z.y + z.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(chips('span')).toHaveCount(spanCount - 1);
  await expect(chips('start')).toHaveCount(startCount + 1);
});

test.describe('full-screen and adaptive hidden-panel layouts', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const views = [
    { name: '滿版倒數', q: '?v=span.rail', region: '間隔' },
    { name: '滿版時鐘', q: '?v=start', region: '開始' },
    { name: '滿版月曆', q: '?v=cal&cm=month', region: '月曆' },
    { name: '滿版年曆', q: '?v=cal&cm=year', region: '月曆' },
    { name: '時區看板', q: '?v=zones.map', region: '時區' },
    { name: '滿版讀法', q: '?v=read', region: '讀法' },
    { name: '滿版時長', q: '?v=dur', region: '時長' },
  ];

  for (const v of views) {
    test(`${v.name} fills the viewport cleanly without overflow or corner overlap`, async ({ page }) => {
      await page.goto(`./${v.q}`);
      const panel = page.getByRole('region', { name: v.region });
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.width).toBeGreaterThan(1300);
      expect(box.height).toBeGreaterThan(780);
      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - window.innerWidth,
        y: document.documentElement.scrollHeight - window.innerHeight,
      }));
      expect(overflow.x).toBeLessThanOrEqual(0);
      expect(overflow.y).toBeLessThanOrEqual(0);
    });
  }

  test('full-screen equation uses 2-tier hero stage with full-width span over start and end', async ({ page }) => {
    await page.goto('./?v=top.start.span.end.rail.chips');
    const spanBox = (await page.getByRole('region', { name: '間隔' }).boundingBox())!;
    const startBox = (await page.getByRole('region', { name: '開始' }).boundingBox())!;
    const endBox = (await page.getByRole('region', { name: '跨年' }).boundingBox())!;
    expect(spanBox.width).toBeGreaterThan(1300);
    expect(startBox.y).toBeGreaterThan(spanBox.y + spanBox.height * 0.9);
    expect(endBox.y).toBeGreaterThan(spanBox.y + spanBox.height * 0.9);
    expect(endBox.x).toBeGreaterThan(startBox.x + startBox.width * 0.9);
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    expect(overflow.y).toBeLessThanOrEqual(0);
  });

  test('one equation piece paired with one lens splits side-by-side, and 4 lenses without equation form a 2×2 grid', async ({
    page,
  }) => {
    await page.goto('./?v=span.cal');
    const spanBox = (await page.getByRole('region', { name: '間隔' }).boundingBox())!;
    const calBox = (await page.getByRole('region', { name: '月曆' }).boundingBox())!;
    expect(calBox.x).toBeGreaterThan(spanBox.x + spanBox.width * 0.8);
    expect(spanBox.height).toBeGreaterThan(780);
    expect(calBox.height).toBeGreaterThan(780);

    await page.goto('./?v=zones.cal.read.dur');
    const zBox = (await page.getByRole('region', { name: '時區' }).boundingBox())!;
    const cBox = (await page.getByRole('region', { name: '月曆' }).boundingBox())!;
    const rBox = (await page.getByRole('region', { name: '讀法' }).boundingBox())!;
    const dBox = (await page.getByRole('region', { name: '時長' }).boundingBox())!;
    expect(cBox.x).toBeGreaterThan(zBox.x + zBox.width * 0.8);
    expect(rBox.y).toBeGreaterThan(zBox.y + zBox.height * 0.8);
    expect(dBox.x).toBeGreaterThan(rBox.x + rBox.width * 0.8);
  });

  test('solo equation piece + 2 or 3 lenses uses Bento layouts with zero overflow', async ({ page }) => {
    await page.goto('./?v=span.zones.cal');
    const sp = (await page.getByRole('region', { name: '間隔' }).boundingBox())!;
    const ca = (await page.getByRole('region', { name: '月曆' }).boundingBox())!;
    const zo = (await page.getByRole('region', { name: '時區' }).boundingBox())!;
    expect(ca.x).toBeGreaterThan(sp.x + sp.width * 0.8);
    expect(zo.y).toBeGreaterThan(sp.y + sp.height * 0.8);
    expect(zo.width).toBeGreaterThan(1300);

    await page.goto('./?v=span.zones.cal.read');
    const sp2 = (await page.getByRole('region', { name: '間隔' }).boundingBox())!;
    const ca2 = (await page.getByRole('region', { name: '月曆' }).boundingBox())!;
    const zo2 = (await page.getByRole('region', { name: '時區' }).boundingBox())!;
    const rd2 = (await page.getByRole('region', { name: '讀法' }).boundingBox())!;
    expect(ca2.x).toBeGreaterThan(sp2.x + sp2.width * 0.8);
    expect(zo2.y).toBeGreaterThan(sp2.y + sp2.height * 0.8);
    expect(rd2.x).toBeGreaterThan(zo2.x + zo2.width * 0.8);
  });

  test('narrow square tablet uses compact 2-tier mini-stage and wide short windows skip tabs', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('./?v=top.start.span.end.rail.cal');
    const eqBox = (await page.locator('.a-eq').boundingBox())!;
    const calBox = (await page.getByRole('region', { name: '月曆' }).boundingBox())!;
    expect(eqBox.height).toBeLessThan(340);
    expect(calBox.height).toBeGreaterThan(560);

    await page.setViewportSize({ width: 1440, height: 540 });
    await page.goto('./?v=start.span.end.zones.cal');
    await expect(page.getByRole('tablist', { name: '檢視' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '時區' })).toBeVisible();
    await expect(page.getByRole('region', { name: '月曆' })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the face fits the width', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('region', { name: '間隔' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('full-screen countdown on a phone keeps the horizontal progress rail and fits cleanly', async ({ page }) => {
    await page.goto('./?v=span.rail');
    const span = page.getByRole('region', { name: '間隔' });
    await expect(span).toBeVisible();
    await expect(page.locator('.eq .track')).toBeVisible();
    const box = (await span.boundingBox())!;
    expect(box.height).toBeGreaterThan(700);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
