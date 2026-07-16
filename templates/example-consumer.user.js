// ==UserScript==
// @name         Example Consumer of lib/agis-core.js
// @namespace    domain.feature        // <- заменить: например agis.loaninfo
// @version      0.1
// @description  Пример потребителя общего ядра: ожидание DOM, кэш, сеть, SPA-навигация, debug-toggle
// @author       me
// @match        https://example.com/path/*    // <- заменить на реальный домен
// @icon         https://www.google.com/s2/favicons?sz=64&domain=example.com
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.2.0/lib/agis-core.js#sha256=dV8YKJZ5amc3KVhAYRg7WBQV/dUGFM4UwLKXLN8RZRg=  // <- ОБНОВИТЬ тег и sha256 на актуальные (git tag -l) перед использованием этого шаблона
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      example.com            // <- по одному @connect на каждый хост, не *
// ==/UserScript==

// Этот файл — не переиспользуемая библиотека, а ЖИВОЙ ПРИМЕР того, как писать
// новый скрипт поверх lib/agis-core.js. Копируй структуру, а не копируй код
// каркаса вручную — сам каркас (waitForElement, onUrlChange и т.д.) уже есть
// в ядре и подключается через @require выше. Обновляй @require на актуальный
// тег ядра (см. git tag -l в репозитории) при создании нового скрипта.

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[example-consumer] agis-core.js не загружен (@require не сработал)');
    return;
  }

  // Бери из деструктуризации только то, что реально используешь — @grant должен
  // соответствовать (см. заголовок lib/agis-core.js: какие функции требуют GM_*).
  const {
    debounce,
    cleanupRoute,
    cleanup,
    storageGet,
    storageSetDebounced,
    waitForElement,
    observeAddedElements,
    api,
    onUrlChange,
    createRouteTokenController,
    showBanner,
    registerDebugToggle,
  } = window.__AGIS_CORE__;

  // --- Настройки ---
  const SCRIPT_NS    = 'agis:example';        // <- заменить, формат "agis:<feature>"
  const STORAGE_KEY   = `${SCRIPT_NS}:cache:v1`; // версия в ключе — на случай смены формата кэша
  const DEBUG_KEY     = `${SCRIPT_NS}:debug`;
  const WAIT_TIMEOUT  = 15000;

  // registerDebugToggle асинхронный — debugCtl.value равен false, пока не резолвится.
  // bootstrap() дожидается его регистрации перед первым запуском (см. низ файла) —
  // иначе log() внутри bootstrap мог бы выполниться раньше, чем debugCtl обновится,
  // и debug-логи не появились бы вовсе (см. agis-duplicate-income.user.js).
  let debugCtl = { value: false };
  const log  = (...a) => { if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  const routeTokenController = createRouteTokenController();

  // Ссылка на функцию отключения дополнительного observer'а (например, table-observer),
  // не входящего в cleanupRoute() ядра — чистим сами (тот же паттерн stopExtraObserver,
  // что и в agis-loan-info-navbar.user.js/agis-linkify-loan-note.user.js).
  let stopExtraObserver = null;

  // Обязательна в ДВУХ местах: в начале bootstrap() (новый маршрут — старый extra-observer
  // больше не нужен) и в pagehide (страница выгружается — снимаем всё). Вынесена в отдельную
  // функцию вместо дублирования инлайн-блока в обоих местах (как исторически сложилось в
  // agis-loan-info-navbar.user.js) — так после правки логики очистки не нужно помнить оба
  // места, достаточно поменять один раз здесь.
  function stopExtraObserverIfAny() {
    if (stopExtraObserver) { stopExtraObserver(); stopExtraObserver = null; }
  }

  // --- Предметная логика (замени на свою) ---
  function parsePage() {
    // TODO: разбор DOM, возвращает данные или null/undefined, если на странице их нет
    return null;
  }

  function parseDoc(doc) {
    // TODO: разбор HTML-документа, полученного через api.getHtml (бэкенд-фолбэк)
    return null;
  }

  function render(data, targetEl) {
    // TODO: рендер данных в DOM
  }

  // --- Точка входа ---
  // Порядок проверок routeTokenController.isCurrent(token) — после КАЖДОГО await:
  //   1. после waitForElement (DOM-ожидание)
  //   2. после синхронного парсинга/вычислений
  //   3. после storageGet (GM_getValue)
  //   4. после сетевого запроса (GM_xmlhttpRequest) — самый долгий await
  async function bootstrap(reason = 'start') {
    const token = routeTokenController.next();
    // Отключаем extra-observer предыдущего маршрута — cleanupRoute() ядра его не
    // трогает (он не входит в общий observers Set, владение только через stopFn).
    stopExtraObserverIfAny();
    cleanupRoute(); // всегда первым действием
    log('Инициализация:', reason);

    try {
      // [1] Ждём DOM. @run-at document-start не гарантирует, что элемент уже есть.
      const targetEl = await waitForElement('#target-selector', { timeout: WAIT_TIMEOUT }); // <- заменить
      if (!routeTokenController.isCurrent(token)) return; // [1]

      // [2] Синхронные операции: парсинг DOM, вычисления и т.д.
      const parsed = parsePage(); // <- заменить собственной логикой
      if (!routeTokenController.isCurrent(token)) return; // [2]

      if (parsed) {
        render(parsed, targetEl);
        storageSetDebounced(STORAGE_KEY, parsed);
        showBanner('Данные загружены', { type: 'success' });
      } else {
        // [3] DOM пустой — пробуем кеш
        const cached = await storageGet(STORAGE_KEY, null);
        if (!routeTokenController.isCurrent(token)) return; // [3]

        if (cached) {
          render(cached, targetEl);
        } else {
          // [4] Нет ни DOM, ни кеша — идём на бэкенд через api.getHtml (обходит CSP)
          try {
            const { doc } = await api.getHtml('https://example.com/path/data');
            if (!routeTokenController.isCurrent(token)) return; // [4]
            const data = parseDoc(doc);
            storageSetDebounced(STORAGE_KEY, data);
            render(data, targetEl);
          } catch (err) {
            warn('Бэкенд fallback не удался:', err.message);
            showBanner('Не удалось загрузить данные: ' + err.message, { type: 'error' });
          }
        }
      }

      // Дополнительный observer (например, слежение за изменениями таблицы) — НЕ
      // входит в cleanupRoute() ядра, чистим сами через stopExtraObserver.
      const debouncedRefresh = debounce(() => {
        if (!routeTokenController.isCurrent(token)) return;
        // TODO: перечитать DOM и обновить рендер
      }, 300);
      stopExtraObserver = observeAddedElements('table, tbody', debouncedRefresh);
    } catch (err) {
      warn(`Ошибка (${reason}):`, err.message);
    }
  }

  // --- Запуск ---
  // onUrlChange устанавливается синхронно, до любых await — SPA-watcher не должен
  // ждать регистрацию debug-toggle (см. async-блок ниже).
  const stopUrlWatcher = onUrlChange((url) => {
    log('SPA-переход:', url);
    bootstrap('url-change');
  });

  window.addEventListener('pagehide', () => {
    stopExtraObserverIfAny();
    cleanup();
    stopUrlWatcher();
  }, { once: true });

  (async () => {
    try {
      debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    } catch (err) {
      warn('Инициализация debug-toggle не удалась:', err);
    }
    bootstrap('document-start');
  })();
})();
