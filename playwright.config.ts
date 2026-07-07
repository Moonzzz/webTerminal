import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.WEBTERMINAL_E2E_PORT || 3200);
const baseURL = `https://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WEBTERMINAL_E2E: '1',
      WEBTERMINAL_HOSTNAME: '127.0.0.1',
      PORT: String(e2ePort),
    },
    url: `${baseURL}/terminal/test-harness`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
