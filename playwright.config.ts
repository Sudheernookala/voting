import { defineConfig, devices } from '@playwright/test';

// Run with: npm run test:e2e   (starts the Firebase emulators, then the tests)
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalSetup: './tests/global-setup.ts',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    env: { VITE_EMULATOR_HOST: '127.0.0.1' },
  },
});
