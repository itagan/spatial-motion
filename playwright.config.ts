import { defineConfig, devices } from '@playwright/test'

const ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: 'test-results',
  reporter: ci
    ? [['line'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1265, height: 633 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ci
        ? ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
        : [],
    },
  },
  projects: [{
    name: 'chromium-webgl',
    use: { ...devices['Desktop Chrome'] },
  }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/benchmark.html',
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
})
