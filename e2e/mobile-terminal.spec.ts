import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

type TerminalTestMetrics = {
  cols: number;
  rows: number;
  wheelCount: number;
  wheelDeltaY: number;
  viewportY: number;
  baseY: number;
  scrollEvents: number;
  shortcutSentCount: number;
  lastShortcutInput: string;
  resizeCount: number;
};

test.beforeEach(async ({ page }) => {
  await page.goto('/terminal/test-harness');
  await expect(page.getByTestId('terminal-test-harness')).toBeVisible();
  await page.waitForFunction(() => {
    const metrics = window.__terminalTestMetrics;
    return Boolean(metrics && metrics.rows > 0 && metrics.baseY > metrics.rows);
  });
  await resetHarness(page);
});

test('mobile layout keeps toolbar below terminal without covering xterm', async ({ page }) => {
  const terminalBox = await getBox(page.getByTestId('terminal-container'));
  const toolbarBox = await getBox(page.locator('.mobile-terminal-bar'));
  const pageBox = await getBox(page.getByTestId('terminal-test-page'));

  expect(terminalBox.width).toBeGreaterThan(300);
  expect(terminalBox.height).toBeGreaterThan(300);
  expect(toolbarBox.width).toBeGreaterThan(300);
  expect(terminalBox.y + terminalBox.height).toBeLessThanOrEqual(toolbarBox.y + 1);
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(pageBox.y + pageBox.height + 1);
});

test('shortcut bar supports horizontal drag without sending shortcut', async ({ page }) => {
  const shortcutScroll = page.locator('.terminal-shortcut-scroll');
  const before = await shortcutScroll.evaluate((element) => ({
    left: element.scrollLeft,
    max: element.scrollWidth - element.clientWidth,
  }));

  expect(before.max).toBeGreaterThan(0);

  const box = await getBox(shortcutScroll);
  await touchDrag(page, {
    from: { x: box.x + box.width - 30, y: box.y + box.height / 2 },
    to: { x: box.x + 30, y: box.y + box.height / 2 },
    steps: 8,
  });

  await expect
    .poll(() => shortcutScroll.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(before.left + 20);

  const metrics = await getMetrics(page);
  expect(metrics.shortcutSentCount).toBe(0);
});

test('shortcut tap sends input once', async ({ page }) => {
  await tapShortcut(page, 'Tab');

  const metrics = await getMetrics(page);
  expect(metrics.shortcutSentCount).toBe(1);
  expect(metrics.lastShortcutInput).toBe('\t');
});

test('terminal supports vertical touch drag and blocks page scroll', async ({ page }) => {
  const before = await prepareTerminalScroll(page);
  const box = await getBox(page.getByTestId('terminal-container'));

  await touchDrag(page, {
    from: { x: box.x + box.width / 2, y: box.y + 90 },
    to: { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 40, 330) },
    steps: 10,
  });

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(async () => (await getMetrics(page)).wheelCount).toBeGreaterThan(0);

  const after = await getMetrics(page);
  expect(after.viewportY).toBeLessThan(before.viewportY);
  expect(after.scrollEvents).toBeGreaterThan(0);
});

test('fast terminal drag emits stronger scroll input than slow drag', async ({ page }) => {
  const slow = await measureTerminalDrag(page, 18, 35);
  const fast = await measureTerminalDrag(page, 5, 5);

  expect(fast.wheelDeltaAbs).toBeGreaterThan(slow.wheelDeltaAbs * 1.2);
});

test('viewport resize refits terminal dimensions', async ({ page }) => {
  const before = await getMetrics(page);

  await page.setViewportSize({ width: 412, height: 620 });
  await page.evaluate(() => window.__terminalTestControls?.refit());

  await expect
    .poll(async () => {
      const metrics = await getMetrics(page);
      return metrics.rows;
    })
    .not.toBe(before.rows);

  const after = await getMetrics(page);
  expect(after.cols).toBeGreaterThan(0);
  expect(after.resizeCount).toBeGreaterThan(before.resizeCount);
});

async function prepareTerminalScroll(page: Page) {
  await resetHarness(page);
  return getMetrics(page);
}

async function measureTerminalDrag(page: Page, steps: number, delayMs: number) {
  const before = await prepareTerminalScroll(page);
  const box = await getBox(page.getByTestId('terminal-container'));

  await touchDrag(page, {
    from: { x: box.x + box.width / 2, y: box.y + 90 },
    to: { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 40, 330) },
    steps,
    delayMs,
  });

  await page.waitForTimeout(350);
  const after = await getMetrics(page);

  return {
    distance: before.viewportY - after.viewportY,
    wheelDeltaAbs: Math.abs(after.wheelDeltaY),
  };
}

async function tapShortcut(page: Page, label: string) {
  const button = page.locator('.terminal-shortcut-button', { hasText: label }).first();
  const box = await getBox(button);

  await touchDrag(page, {
    from: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    to: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    steps: 1,
  });
}

async function resetHarness(page: Page) {
  await page.evaluate(() => {
    window.__terminalTestControls?.scrollToBottom();
    window.scrollTo(0, 0);
  });
  await expect
    .poll(async () => {
      const metrics = await getMetrics(page);
      return metrics.baseY - metrics.viewportY;
    })
    .toBe(0);
  await page.evaluate(() => window.__terminalTestControls?.resetMetrics());
}

async function getMetrics(page: Page) {
  return page.evaluate(() => {
    const metrics = window.__terminalTestMetrics;
    if (!metrics) {
      throw new Error('Missing terminal test metrics');
    }

    return { ...metrics };
  });
}

async function getBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function touchDrag(
  page: Page,
  options: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    steps: number;
    delayMs?: number;
  }
) {
  const client = await page.context().newCDPSession(page);

  try {
    await dispatchTouch(client, 'touchStart', options.from.x, options.from.y);

    for (let index = 1; index <= options.steps; index += 1) {
      const progress = index / options.steps;
      await dispatchTouch(
        client,
        'touchMove',
        lerp(options.from.x, options.to.x, progress),
        lerp(options.from.y, options.to.y, progress)
      );

      if (options.delayMs) {
        await page.waitForTimeout(options.delayMs);
      }
    }

    await dispatchTouch(client, 'touchEnd');
  } finally {
    await client.detach();
  }
}

async function dispatchTouch(client: CDPSession, type: 'touchStart' | 'touchMove', x: number, y: number): Promise<void>;
async function dispatchTouch(client: CDPSession, type: 'touchEnd'): Promise<void>;
async function dispatchTouch(
  client: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  x = 0,
  y = 0
) {
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
  });
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

declare global {
  interface Window {
    __terminalTestMetrics?: TerminalTestMetrics;
    __terminalTestControls?: {
      resetMetrics: () => void;
      scrollToBottom: () => void;
      refit: () => void;
    };
  }
}
