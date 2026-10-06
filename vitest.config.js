import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
          ROOT_DOMAIN: 'multilinks.test',
          STRIPE_SECRET_KEY: 'sk_test_123',
          STRIPE_WEBHOOK_SECRET: 'whsec_test',
          STRIPE_PRICE_ID: 'price_123',
          RESEND_API_KEY: 're_test',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
  },
}));
