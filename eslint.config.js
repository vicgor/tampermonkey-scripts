'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const userscripts = require('eslint-plugin-userscripts');
const prettierConfig = require('eslint-config-prettier');

// Метаблок Tampermonkey использует GM_* API, которого нет в стандартных наборах
// globals — описываем явно (см. README.md "Стандарты userscript'ов").
const tampermonkeyGlobals = {
  GM_setValue: 'readonly',
  GM_getValue: 'readonly',
  GM_deleteValue: 'readonly',
  GM_listValues: 'readonly',
  GM_xmlhttpRequest: 'readonly',
  GM_registerMenuCommand: 'readonly',
  GM_unregisterMenuCommand: 'readonly',
  GM_addStyle: 'readonly',
  GM_info: 'readonly',
  GM_notification: 'readonly',
  GM_openInTab: 'readonly',
  GM_setClipboard: 'readonly',
  unsafeWindow: 'readonly',
};

module.exports = [
  {
    ignores: ['node_modules/**', 'template-tamper-monkey.md'],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.user.js', 'templates/**/*.user.js'],
    plugins: { userscripts },
    languageOptions: {
      ecmaVersion: 2022,
      // 'script', не 'module': Tampermonkey @require грузит и выполняет классический
      // скрипт, ESM (import/export) не поддерживает — это архитектурно, не наш выбор,
      // так что менять не придётся. Волна 5 добавила vitest-тесты, но им нужен Node
      // CommonJS (require/module), а не ESM — см. отдельный блок files: ['test/**/*.test.js'].
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...tampermonkeyGlobals,
        // Волна 5: guard `if (typeof process !== 'undefined' && process.versions?.node &&
        // typeof module !== 'undefined' && module.exports)` в начале/конце IIFE экспортирует
        // чистые функции для vitest. В Tampermonkey ни process, ни module не определены —
        // блок мёртвый код, но ESLint должен знать про оба global'а. require — НЕ здесь:
        // используется только в agis-loan-info-navbar.user.js (см. отдельный блок ниже),
        // остальные 6 скриптов require() не вызывают и не должны — если он появится в их
        // production-пути, это должно остаться ошибкой ESLint, а не молча пройти.
        module: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      // --- Метаблок userscript'а (см. README.md "Метаблок: обязательный минимум") ---
      'userscripts/no-invalid-metadata': ['error', { top: 'required' }],
      'userscripts/no-invalid-headers': 'error',
      'userscripts/no-invalid-grant': 'error',
      'userscripts/require-name': ['error', 'required'],
      'userscripts/require-description': ['error', 'required'],
      'userscripts/require-version': ['error', 'required'],
      'userscripts/require-attribute-space-prefix': 'error',
      'userscripts/filename-user': ['error', 'always'],
      // require-download-url выключено: часть скриптов сознательно не использует
      // @updateURL/@downloadURL (полагаются на дефолтный апдейт Tampermonkey) — см.
      // ROADMAP.md / историю commit 551ce34. Не общее требование проекта.
      'userscripts/require-download-url': 'off',
      // use-homepage-and-url — не используем @homepageURL/@supportURL нигде в проекте.
      'userscripts/use-homepage-and-url': 'off',
      'userscripts/better-use-match': 'warn',
      'userscripts/metadata-spacing': 'off',
      'userscripts/align-attributes': 'off',

      // --- Инварианты каркаса (см. CLAUDE.md "Ключевые инварианты каркаса") ---
      // Сеть — только через GM_xmlhttpRequest (обходит CSP), не fetch()/XHR страницы.
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Используй GM_xmlhttpRequest/httpRequest из lib/agis-core.js — обходит CSP сайта.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='XMLHttpRequest']",
          message: 'Используй GM_xmlhttpRequest/httpRequest из lib/agis-core.js — обходит CSP сайта.',
        },
        {
          selector: "CallExpression[callee.name='setInterval']",
          message:
            'setInterval-поллинг вместо MutationObserver запрещён README.md, кроме обоснованных fallback-случаев ' +
            '(например, пропущенный pushState/popstate в onUrlChange). Если это обоснованный случай — добавь ' +
            '// eslint-disable-next-line no-restricted-syntax с комментарием почему.',
        },
      ],
      // Никакого innerHTML с непроверенными данными — только textContent/DOM API.
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message:
            'Используй textContent или DOM API (createElement/append) вместо innerHTML — см. README.md "Безопасность рендера".',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // Скрипты используют const/let, объявления функций и т.д. — но не заявляют
      // модульность (это IIFE в one-file userscript), поэтому unused vars мягче.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // catch (_) {} — легитимный паттерн для необязательных DOM-фич (например,
      // input.setSelectionRange на элементах, где выделение текста не поддерживается).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['lib/agis-core.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...tampermonkeyGlobals,
        // Волна 5: guard `if (typeof process !== 'undefined' && process.versions?.node &&
        // typeof module !== 'undefined' && module.exports)` перед window.__AGIS_CORE__ = {...}
        // экспортирует ruMonthNumber для vitest.
        module: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Используй GM_xmlhttpRequest — обходит CSP сайта.' },
      ],
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Используй textContent или DOM API вместо innerHTML.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // setInterval здесь — единственный легитимный случай в репозитории: fallback-поллинг
      // URL в onUrlChange на случай пропущенного pushState/popstate (см. комментарий в коде).
    },
  },
  {
    // Волна 5.1/5.2/5.3: эти три скрипта require()'ят lib/agis-core.js внутри Node-only ветки
    // guard'а, чтобы получить ruMonthNumber/normalizeText/cellText для теста без дублирования
    // их логики (см. README.md "Тесты"). require НЕ добавлен в общий globals-блок
    // scripts/**/*.user.js выше — если он появится в production-пути любого из остальных
    // 4 скриптов, это должно остаться ошибкой ESLint (no-undef), а не молча пройти.
    files: [
      'scripts/agis-loan-info-navbar.user.js',
      'scripts/agis-protocol-income-fill.user.js',
      'scripts/agis-duplicate-income.user.js',
    ],
    languageOptions: {
      globals: { require: 'readonly' },
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // scripts/validate-meta.js, scripts/check-version-bump.js — Node CLI-тулинг
    // (Волна 4.5/4.3), не userscript'ы, поэтому не подпадают под
    // files: ['scripts/**/*.user.js'] выше.
    files: ['scripts/validate-meta.js', 'scripts/check-version-bump.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // vitest.config.js — ESM (см. комментарий про import в самом файле).
    files: ['vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Волна 5: тесты на чистые парсеры (см. README.md "Тесты"). sourceType 'module' —
    // vitest 4 нельзя require()'ить (падает с ошибкой), тесты используют import;
    // именованный import из module.exports-файлов (*.user.js/agis-core.js) работает
    // через CJS-интероп Vite — проверено эмпирически, добавлять .cjs/.mjs не нужно.
    // globals.browser — часть тестов (Волна 5.1, *.dom.test.js) помечена
    // `// @vitest-environment jsdom` и использует DOMParser/document.
    files: ['test/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  prettierConfig,
];
