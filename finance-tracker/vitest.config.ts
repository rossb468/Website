import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each file opens its own in-memory database, so files are independent,
    // but keeping them serial makes failures easier to read.
    fileParallelism: false,
  },
});
