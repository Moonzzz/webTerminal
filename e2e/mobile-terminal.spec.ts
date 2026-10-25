import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

const E2E_SSH_HOST = process.env.WEBTERMINAL_E2E_SSH_HOST || '127.0.0.1';
const E2E_SSH_PORT = Number(process.env.WEBTERMINAL_E2E_SSH_PORT || 2022);
const E2E_SSH_USERNAME = process.env.WEBTERMINAL_E2E_SSH_USERNAME || 'mobile-e2e';
const E2E_SSH_PASSWORD = process.env.WEBTERMINAL_E2E_SSH_PASSWORD || 'mobile-e2e-password';
const E2E_AUTH_USERNAME = process.env.WEBTERMINAL_AUTH_USERNAME || 'admin';
const E2E_AUTH_PASSWORD = process.env.WEBTERMINAL_AUTH_PASSWORD || 'webTerminal';
const E2E_FIXTURE_URL = process.env.WEBTERMINAL_E2E_FIXTURE_URL || 'http://127.0.0.1:3201';

test.beforeEach(async ({ page }) => {
  await resetFixture();
  await openRuntimeTerminal(page);
});

test('mobile layout keeps toolbar below terminal without covering xterm', async ({ page }) => {
  const terminalBox = await getBox(page.locator('.terminal-container'));
  const toolbarBox = await getBox(page.locator('.mobile-terminal-bar'));
  const pageBox = await getBox(page.locator('.terminal-page'));

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

  await expect.poll(async () => (await readFixtureState()).inputs.length).toBe(0);
});

test('shortcut tap sends input once through the real terminal session', async ({ page }) => {
  await tapShortcut(page, 'Tab');

  await expect
    .poll(async () => (await readFixtureState()).inputs.join(''))
    .toBe('\t');
});

test('terminal supports vertical touch drag and blocks page scroll', async ({ page }) => {
  await installTouchScrollProbe(page);
  const box = await getBox(page.locator('.terminal-container'));

  await touchDrag(page, {
    from: { x: box.x + box.width / 2, y: box.y + 90 },
    to: { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 40, 330) },
    steps: 10,
  });

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const probe = await readTouchScrollProbe(page);
  expect(probe.touchMoves).toBeGreaterThan(0);
  expect(probe.wheels).toBeGreaterThan(0);
  expect(probe.wheelDeltaAbs).toBeGreaterThan(0);
});

test('fast terminal drag scrolls farther than slow drag', async ({ page }) => {
  const slow = await measureTerminalDrag(page, 18, 35);

  await resetFixture();
  await openRuntimeTerminal(page);
  const fast = await measureTerminalDrag(page, 5, 5);

  expect(fast.wheelDeltaAbs).toBeGreaterThan(slow.wheelDeltaAbs * 1.2);
});

test('viewport resize refits terminal dimensions and reports backend resize', async ({ page }) => {
  const beforeRows = await getTerminalRows(page);
  const beforeWindowChangeCount = (await readFixtureState()).windowChanges.length;

  await page.setViewportSize({ width: 412, height: 620 });

  await expect.poll(() => getTerminalRows(page)).not.toBe(beforeRows);
  await expect
    .poll(async () => (await readFixtureState()).windowChanges.length)
    .toBeGreaterThan(beforeWindowChangeCount);

  const lastWindow = (await readFixtureState()).windowChanges.at(-1);
  expect(lastWindow?.cols).toBeGreaterThan(0);
  expect(lastWindow?.rows).toBeGreaterThan(0);
});

test('终端触摸拖动后可见历史内容实际移动', async ({ page }) => {
  const before = await getFirstVisibleFixtureLine(page);
  const box = await getBox(page.locator('.terminal-container'));

  await touchDrag(page, {
    from: { x: box.x + box.width / 2, y: box.y + 90 },
    to: { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 40, 330) },
    steps: 10,
    delayMs: 20,
  });

  await expect.poll(() => getFirstVisibleFixtureLine(page)).toBeLessThan(before);
  const afterTouch = await getFirstVisibleFixtureLine(page);

  await touchDrag(page, {
    from: { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 40, 330) },
    to: { x: box.x + box.width / 2, y: box.y + 90 },
    steps: 10,
    delayMs: 20,
  });
  await expect.poll(() => getFirstVisibleFixtureLine(page)).toBeGreaterThan(afterTouch);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('粘贴经真实 SSH 发送且复制模式包含终端历史', async ({ page }) => {
  const text = 'WEBTERMINAL_ACCEPTANCE_PASTE';
  await page.getByRole('button', { name: '打开粘贴输入', exact: true }).tap();
  await page.getByLabel('粘贴输入', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).tap();
  await expect.poll(async () => (await readFixtureState()).inputs.join('')).toBe(text);
  await expect.poll(async () => (await readTerminalText(page)).replace(/\n/g, '')).toContain(text);

  await page.getByRole('button', { name: '选择 terminal 文本', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '选择 terminal 文本' });
  await expect(dialog).toContainText('WEBTERMINAL_E2E_LINE_001');
  await expect(dialog).toContainText(text);
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(dialog).toBeHidden();
});

test('自定义快捷键刷新后保留并经真实 SSH 发送', async ({ page }) => {
  const text = 'WEBTERMINAL_ACCEPTANCE_SHORTCUT';
  await page.getByRole('button', { name: '自定义快捷键', exact: true }).tap();
  await page.getByLabel('自定义快捷键名称', { exact: true }).fill('验收');
  await page.getByLabel('自定义快捷键发送内容', { exact: true }).fill(text);
  await page.getByRole('button', { name: '添加', exact: true }).tap();
  await page.getByRole('button', { name: '自定义快捷键', exact: true }).tap();

  await page.reload();
  await page.getByLabel('SSH 密码', { exact: true }).fill(E2E_SSH_PASSWORD);
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await waitForTerminalText(page, 'WEBTERMINAL_E2E_PROMPT$');
  const shortcut = page.locator('.terminal-shortcut-button', { hasText: '验收' });
  await shortcut.scrollIntoViewIfNeeded();
  await tapShortcut(page, '验收');
  await expect.poll(async () => (await readFixtureState()).inputs.join('')).toBe(text);
});

async function openRuntimeTerminal(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.removeItem('webTerminal-node-memory');
    window.sessionStorage.removeItem('webTerminal-custom-node');
  });

  await page.goto('/login');
  await page.getByLabel('用户名').fill(E2E_AUTH_USERNAME);
  await page.getByLabel('密码').fill(E2E_AUTH_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page.getByRole('button', { name: '打开 SSH' })).toBeVisible();
  await fillInput(page.locator('input[placeholder="192.168.1.10"]'), E2E_SSH_HOST);
  await fillInput(page.locator('input[placeholder="22"]'), String(E2E_SSH_PORT));
  await fillInput(page.locator('input[placeholder="root"]'), E2E_SSH_USERNAME);
  await page.getByRole('button', { name: '打开 SSH' }).click();

  await expect(page).toHaveURL(/\/terminal\/custom$/);
  await page.getByLabel('SSH 密码').fill(E2E_SSH_PASSWORD);
  await page.getByRole('button', { name: '连接' }).click();

  await expect(page.locator('.terminal-container .xterm')).toBeVisible();
  await expect(page.locator('.mobile-terminal-bar')).toBeVisible();
  await waitForTerminalText(page, 'WEBTERMINAL_E2E_PROMPT$');
  await waitForVisibleScrollback(page);
}

async function waitForTerminalText(page: Page, text: string) {
  await expect.poll(() => readTerminalText(page)).toContain(text);
}

async function readTerminalText(page: Page) {
  return page.locator('.terminal-container').innerText();
}

async function waitForVisibleScrollback(page: Page) {
  await expect
    .poll(() => getFirstVisibleFixtureLine(page))
    .toBeGreaterThan(1);
}

async function getFirstVisibleFixtureLine(page: Page) {
  const text = await readTerminalText(page);
  const match = text.match(/WEBTERMINAL_E2E_LINE_(\d{3})/);
  if (!match) {
    throw new Error(`Missing visible fixture line in terminal text: ${text}`);
  }
  return Number(match[1]);
}

async function getTerminalRows(page: Page) {
  return page.locator('.terminal-container .xterm-rows').evaluate((element) => element.childElementCount);
}

async function installTouchScrollProbe(page: Page) {
  await page.evaluate(() => {
    const metrics = {
      touchMoves: 0,
      wheels: 0,
      wheelDeltaAbs: 0,
    };
    Object.defineProperty(window, '__terminalRuntimeProbe', {
      value: metrics,
      configurable: true,
    });
    document
      .querySelector('.terminal-container')
      ?.addEventListener('touchmove', () => {
        metrics.touchMoves += 1;
      }, { capture: true });
    document
      .querySelector('.xterm-scrollable-element')
      ?.addEventListener('wheel', (event) => {
        metrics.wheels += 1;
        metrics.wheelDeltaAbs += Math.abs(event.deltaY);
      }, { capture: true });
  });
}

async function readTouchScrollProbe(page: Page) {
  return page.evaluate(() => {
    const probe = window.__terminalRuntimeProbe;
    if (!probe) {
      throw new Error('Missing terminal runtime probe');
    }
    return { ...probe };
  });
}

async function measureTerminalDrag(page: Page, steps: number, delayMs: number) {
  await installTouchScrollProbe(page);
  const box = await getBox(page.locator('.terminal-container'));

  await touchDrag(page, {
    from: { x: box.x + box.width / 2, y: box.y + 90 },
    to: { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 40, 330) },
    steps,
    delayMs,
  });

  await page.waitForTimeout(350);
  const probe = await readTouchScrollProbe(page);

  return {
    wheelDeltaAbs: probe.wheelDeltaAbs,
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

async function fillInput(locator: Locator, value: string) {
  await locator.focus();
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.fill(value);
}

async function resetFixture() {
  await fetch(`${E2E_FIXTURE_URL}/reset`, { method: 'POST' });
}

async function readFixtureState(): Promise<{
  inputs: string[];
  windowChanges: Array<{ cols: number; rows: number }>;
}> {
  const response = await fetch(`${E2E_FIXTURE_URL}/state`);
  if (!response.ok) {
    throw new Error(`Fixture state request failed: ${response.status}`);
  }
  return response.json() as Promise<{
    inputs: string[];
    windowChanges: Array<{ cols: number; rows: number }>;
  }>;
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
    __terminalRuntimeProbe?: {
      touchMoves: number;
      wheels: number;
      wheelDeltaAbs: number;
    };
  }
}
