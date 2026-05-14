import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The handler modules import ./env which parses process.env at load
    // time. Provide stubs so tests can import them without needing a
    // real DB or AI service.
    env: {
      DATABASE_URL: 'postgres://stub:stub@localhost:5432/stub',
      AI_SERVICE_URL: 'http://localhost:8000',
      WEB_APP_URL: 'http://localhost:3000',
    },
  },
});
