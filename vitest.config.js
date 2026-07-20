'use strict';

const { defineConfig } = require('vitest/config');

// Тестируем только чистые парсеры (см. README.md "Тесты") — DOM/GM_* здесь не нужны,
// поэтому окружение 'node', а не 'jsdom'.
module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
