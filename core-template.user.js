// ==UserScript==
// @name         Robust Core Template
// @namespace    domain.feature        // <- заменить: например agis.loaninfo
// @version      0.4
// @description  Устойчивое ядро: ожидание DOM, GM_xmlhttpRequest, debounced GM_setValue, SPA-навигация, routeToken x4, cleanup
// @author       me
// @match        https://example.com/path/*    // <- заменить на реальный домен
// @icon         https://www.google.com/s2/favicons?sz=64&domain=example.com
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      example.com            // <- по одному @connect на каждый хост, не *
// @connect      other-domain.com       // <- ещё один, если нужно
// ==/UserScript==

(() => {
  'use strict';

  // --- Настройки ---
  const SCRIPT_NS    = 'robust-core';   // <- заменить
  const DEBUG        = true;
  const WAIT_TIMEOUT = 15000;

  const log  = (...a) => { if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // --- Трекинг всех observerов и таймеров ---
  // Внимание: observers содержит ТОЛЬКО наблюдатели waitForElement.
  // observeAddedElements НЕ добавляет в этот Set — владение только через stopFn.
  const observers    = new Set();
  const timers       = new Set();
  const storageTimers = new Map();

  // routeToken — инкрементируется при каждом SPA-переходе.
  // Правило: проверяй (token !== routeToken) ПОСЛЕ каждого await.
  // Четыре проверки: (1) после waitForElement, (2) после DOM-парсинга,
  // (3) после GM_getValue, (4) после GM_xmlhttpRequest.
  let routeToken = 0;
  let lastUrl    = location.href;

  // Функция для внешних stopObserver: хранит функцию отключения дополнительных observerов,
  // например table-observerа. Чистится в cleanupRoute.
  let stopExtraObserver = null;

  // [#4] Guard против повторного вызова onUrlChange.
  // onUrlChange должен вызываться ровно один раз за время жизни страницы.
  let urlChangeInstalled = false;

  // setTimeout, который регистрируется в наборе и авто-удаляется по завершении
  function setManagedTimeout(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
  }

  // debounce — нужен для onUrlChange и observer-колбэков.
  // debounced.cancel() — отменяет ожидающий вызов.
  function debounce(fn, wait = 250) {
    let timer = null;
    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    }
    debounced.cancel = () => { clearTimeout(timer); timer = null; };
    return debounced;
  }

  // cleanupRoute — вызывай в начале каждого bootstrap.
  // Чистит observerы waitForElement и таймеры текущего маршрута.
  // stopExtraObserver (от observeAddedElements) отключается отдельно — через сохранённый stopFn.
  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (stopExtraObserver) { stopExtraObserver(); stopExtraObserver = null; }
  }

  // cleanup — полная очистка при выгрузке страницы.
  function cleanup() {
    cleanupRoute();
    for (const t of storageTimers.values()) clearTimeout(t);
    storageTimers.clear();
    log('Очистка завершена');
  }

  // --- Хранилище ---
  // GM_setValue/GM_getValue в MV3 трактуем как асинхронные: await + try/catch.
  async function storageGet(key, fallback = null) {
    try {
      const v = await GM_getValue(key, fallback);
      return v === undefined ? fallback : v;
    } catch (e) { warn('GM_getValue ошибка:', key, e); return fallback; }
  }

  // [#3] Фабрика debounced-записей. Возвращает функцию (value) => void.
  // Использование:
  //   const saveCount = storageSetDebounced('processedCount', 800);
  //   saveCount(processedCount);
  function storageSetDebounced(key, wait = 300) {
    return function (value) {
      const old = storageTimers.get(key);
      if (old) clearTimeout(old);
      const timer = setTimeout(async () => {
        storageTimers.delete(key);
        try { await GM_setValue(key, value); }
        catch (e) { warn('GM_setValue ошибка:', key, e); }
      }, wait);
      storageTimers.set(key, timer);
    };
  }

  // --- DOM-ожидание ---
  // @run-at document-start = ранний момент инъекции, не готовность DOM.
  // Работа с элементами — всегда через waitForElement.
  function waitForElement(selector, { root = document, timeout = WAIT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let observer = null;

      const query = () => { try { return root.querySelector(selector); } catch (_) { return null; } };

      const finish = (el) => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        clearTimeout(timeoutTimer); timers.delete(timeoutTimer);
        resolve(el);
      };
      const fail = () => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        warn(`waitForElement: "${selector}" не найден за ${timeout} мс (${location.href})`);
        reject(new Error(`waitForElement: "${selector}" not found`));
      };

      const existing = query();
      // [#2] Используем finish() вместо прямого resolve() — выставляет done=true,
      // предотвращает двойной resolve при гонке на document-start.
      if (existing) { finish(existing); return; }

      const timeoutTimer = setManagedTimeout(fail, timeout);

      // Если documentElement ещё нет (ранний document-start) — повторяем через 50 мс
      const startObserve = () => {
        if (done) return;
        const observeRoot = root === document
          ? (document.documentElement || document.body)
          : root;
        if (!observeRoot) { setManagedTimeout(startObserve, 50); return; }
        observer = new MutationObserver(() => { const el = query(); if (el) finish(el); });
        observer.observe(observeRoot, { childList: true, subtree: true });
        observers.add(observer);
        const el = query(); if (el) finish(el); // проверяем сразу после подписки
      };
      startObserve();
    });
  }

  // Вызывает callback для каждого нового подходящего элемента.
  // [#1] Observer НЕ добавляется в observers Set — владение только через возвращаемый stopFn.
  // cleanupRoute() отключает этот observer через stopExtraObserver, а не через observers.clear().
  function observeAddedElements(selector, callback, { root = document.documentElement } = {}) {
    const seen = new WeakSet();
    const process = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches?.(selector) && !seen.has(node)) { seen.add(node); callback(node); }
      for (const el of (node.querySelectorAll?.(selector) || [])) {
        if (!seen.has(el)) { seen.add(el); callback(el); }
      }
    };
    process(root);
    const observer = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) process(n);
    });
    observer.observe(root, { childList: true, subtree: true });
    // Не добавляем в observers — только stopFn
    return () => { observer.disconnect(); };
  }

  // --- Сетевые запросы через GM_xmlhttpRequest (обходит CSP сайта) ---
  // Домены должны быть перечислены в @connect по одному на каждый хост.
  // GM_xmlhttpRequest может отправить одно событие progress — не используй его для потоковой качки.
  function httpRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 20000, ...details,
        onload:    resolve,
        onerror:   reject,
        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
        onabort:   () => reject(new Error('GM_xmlhttpRequest aborted')),
      });
    });
  }

  const api = {
    // JSON GET
    async getJson(url, headers = {}) {
      const r = await httpRequest({
        method: 'GET', url,
        headers: { 'Accept': 'application/json, text/plain, */*', ...headers },
        responseType: 'json',
      });
      if (r.status !== 200) throw new Error(`getJson: HTTP ${r.status} ${url}`);
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
    // JSON POST
    async postJson(url, body, headers = {}) {
      const r = await httpRequest({
        method: 'POST', url,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
        data: JSON.stringify(body), responseType: 'json',
      });
      if (r.status !== 200) throw new Error(`postJson: HTTP ${r.status} ${url}`);
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
    // HTML GET — получает HTML и парсит в Document через DOMParser.
    // Используй когда нужно работать с DOM ответа (querySelectorAll, parseDoc и т.д.).
    async getHtml(url, headers = {}) {
      const r = await httpRequest({
        method: 'GET', url,
        headers: { 'Accept': 'text/html,*/*', ...headers },
      });
      if (r.status !== 200) throw new Error(`getHtml: HTTP ${r.status} ${url}`);
      const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
      return { status: r.status, doc, finalUrl: r.finalUrl || url };
    },
  };

  // --- SPA-навигация ---
  // Перехватывает pushState/replaceState + popstate + hashchange.
  // Дополнительный setInterval 1с — запасной механизм для фреймворков, не отправляющих History API события.
  // Возвращает stopFn — вызвать чтобы полностью очистить подписки при pagehide.
  // [#4] ВАЖНО: вызывать только один раз за время жизни страницы.
  // Повторный вызов вернёт no-op stopFn и выдаст предупреждение в консоль.
  function onUrlChange(callback) {
    if (urlChangeInstalled) {
      warn('onUrlChange уже установлен — повторный вызов игнорируется. Вызывай только один раз.');
      return () => {}; // no-op stopFn
    }
    urlChangeInstalled = true;

    const check = debounce(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      callback(location.href);
    }, 100);

    const origPush    = history.pushState;
    const origReplace = history.replaceState;
    history.pushState    = function (...a) { const r = origPush.apply(this, a);    check(); return r; };
    history.replaceState = function (...a) { const r = origReplace.apply(this, a); check(); return r; };
    window.addEventListener('popstate',   check);
    window.addEventListener('hashchange', check);
    // setInterval — поллинг на случай фреймворков без History API
    const interval = setInterval(check, 1000);

    return () => {
      history.pushState    = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate',   check);
      window.removeEventListener('hashchange', check);
      clearInterval(interval);
      check.cancel();
      urlChangeInstalled = false; // сбрасываем флаг при явной остановке
    };
  }

  // --- Точка входа ---
  // Шаблон структуры bootstrap() с четырьмя проверками routeToken.
  //
  // Порядок проверок (N = количество await операций):
  //   1. после waitForElement (DOM-ожидание)
  //   2. после DOM-парсинга или любых синхронных операций
  //   3. после storageGet (GM_getValue)
  //   4. после сетевого запроса (GM_xmlhttpRequest) — самый долгий await
  async function bootstrap(reason = 'start') {
    const token = ++routeToken;
    cleanupRoute(); // всегда первым действием
    log('Инициализация:', reason);

    // [#3] Создаём debounced-сохранялки один раз в bootstrap
    const saveCacheKey = storageSetDebounced('my-cache-key', 300);

    try {
      // [1] Ждём DOM.
      // @run-at document-start: нельзя предполагать, что элемент уже есть.
      const targetEl = await waitForElement('#target-selector'); // <- заменить

      // [1] Проверка токена сразу после получения элемента
      if (token !== routeToken) return;

      // [2] Синхронные операции: парсинг DOM, вычисления и т.д.
      const parsed = parsePage(); // <- заменить собственной логикой

      // [2] Проверка токена после парсинга
      if (token !== routeToken) return;

      if (!parsed) {
        // [3] Если DOM пустой — пробуем кеш
        const cached = await storageGet('my-cache-key', null);

        // [3] Проверка токена после GM_getValue
        if (token !== routeToken) return;

        if (cached) {
          render(cached, targetEl);
        } else {
          // [4] Нет ни DOM, ни кеша — идём на бэкенд через GM_xmlhttpRequest
          try {
            const { doc } = await api.getHtml('https://example.com/path/data');
            // [4] Проверка токена после сетевого запроса (самый долгий await)
            if (token !== routeToken) return;
            const data = parseDoc(doc);
            saveCacheKey(data);
            render(data, targetEl);
          } catch (e) {
            warn('Бэкенд fallback не удался:', e.message);
          }
        }
      } else {
        render(parsed, targetEl);
        saveCacheKey(parsed);
      }

      // Дополнительный observer (например, для слежения за изменениями таблиц).
      // Хранится в stopExtraObserver — cleanupRoute() его отключит при следующем bootstrap.
      const debouncedRefresh = debounce(async () => {
        if (token !== routeToken) return;
        // TODO: перечитать DOM и обновить рендер
      }, 300);
      stopExtraObserver = observeAddedElements('table, tbody', debouncedRefresh);

    } catch (err) {
      warn(`Ошибка (${reason}):`, err.message);
    }
  }

  // --- Запуск ---
  // onUrlChange возвращает stopFn — вызываем его при pagehide вместе с cleanup.
  const stopUrlWatcher = onUrlChange((url) => {
    log('SPA-переход:', url);
    bootstrap('url-change');
  });

  window.addEventListener('pagehide', () => {
    cleanup();
    stopUrlWatcher();
  }, { once: true });

  bootstrap('document-start');
})();
