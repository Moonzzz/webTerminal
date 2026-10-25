import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.WEBTERMINAL_E2E_PORT || 3200);
const e2eFixturePort = Number(process.env.WEBTERMINAL_E2E_FIXTURE_PORT || 3201);
const baseURL = `http://127.0.0.1:${e2ePort}`;

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
    command: 'node e2e/run-runtime-server.mjs',
    env: {
      ...process.env,
      WEBTERMINAL_HOSTNAME: '127.0.0.1',
      PORT: String(e2ePort),
      WEBTERMINAL_E2E_PORT: String(e2ePort),
      WEBTERMINAL_E2E_FIXTURE_PORT: String(e2eFixturePort),
      WEBTERMINAL_E2E_FIXTURE_URL: `http://127.0.0.1:${e2eFixturePort}`,
    },
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
