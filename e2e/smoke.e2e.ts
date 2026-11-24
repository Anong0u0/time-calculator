/* The built app in a real browser: it opens without errors, reads a link, takes typed text, and the panels and
   undo answer the keyboard. The core and the state have their own unit tests; these only check that it all holds together. */
import { test as base, expect, type Page } from '@playwright/test';

/** Every test fails on an error the page throws or logs. */
const test = base.extend<{ noErrors: void }>({
  noErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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
  await expect(page).toHaveURL(/s=2000-01-01.*e=2000-01-31/);
  await box.blur();
  await page.keyboard.press('Control+z');
  await expect(field(page, '結束的年')).not.toHaveValue('2000');
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
  const ax = a.x + a.width / 2, ay = a.y + a.height / 2;
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

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the face fits the width', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('region', { name: '間隔' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
