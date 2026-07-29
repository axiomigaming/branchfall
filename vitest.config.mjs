import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    // The enumeration and the Monte Carlo cross-check are CPU-bound, not IO-bound.
    testTimeout: 120_000,
  },
});
