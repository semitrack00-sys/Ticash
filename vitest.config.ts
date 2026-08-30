import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['apps/api/src/**/*.test.ts', 'packages/shared/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['apps/api/src/**/*.ts', 'packages/shared/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts']
    }
  }
});
