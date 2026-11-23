import { defineConfig, devices } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

// End-to-end tests run against the local Supabase-compatible stack
// (scripts/e2e/stack.sh) or any Supabase project given via env vars.
const keysFile = new URL('./scripts/e2e/.keys.json', import.meta.url);
const keys = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : {};
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://localhost:54321';
const ANON = process.env.E2E_SUPABASE_ANON_KEY ?? keys.anonKey ?? '';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'America/Los_Angeles', // deliberately NOT the facility zone, to prove times use Asia/Manila
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    env: { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: ANON },
  },
});
