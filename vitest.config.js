import { defineConfig } from 'vitest/config';

// Тестируем только чистые парсеры (см. README.md "Тесты") — DOM/GM_* здесь не нужны,
// поэтому окружение 'node', а не 'jsdom'.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
