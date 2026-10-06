import { defineConfig } from '@playwright/test';

// Runs the Worker locally against fake Stripe and Resend. Ports differ from
// `npm run dev` so both can run at once.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  webServer: [
    {
      command: 'node e2e/fakes.js',
      url: 'http://localhost:8790/health',
    },
    {
      command:
        'npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e && npx wrangler dev --port 8788 --persist-to .wrangler/e2e --env-file e2e/e2e.env',
      url: 'http://localhost:8788',
      timeout: 120_000,
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
  ],
});
