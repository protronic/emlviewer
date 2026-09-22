import {defineConfig} from 'vitest/config';

// Unit tests run in plain Node (the MIME parser needs no DOM). The browser
// integration of App.vue is covered by test/harness instead.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
