// AGIS Core — общий каркас для Tampermonkey-скриптов AGIS (Волна 2 ROADMAP.md).
// Подключается через @require с SRI-хешем; экспортирует API через window.__AGIS_CORE__.
// Каждый скрипт получает свой собственный экземпляр состояния (observers/timers) —
// это IIFE выполняется отдельно в сендбоксе каждого @require'ящего скрипта.
//
// GM-free (работают при @grant none): debounce, cleanupRoute, cleanup,
//   waitForElement, observeAddedElements, onUrlChange, createRouteTokenController, showBanner.
// Требуют @grant:
//   storageGet, storageSetDebounced       → GM_getValue, GM_setValue
//   httpRequest, api.*                    → GM_xmlhttpRequest (+ @connect нужных хостов)
//   registerDebugToggle                   → GM_getValue, GM_setValue, GM_registerMenuCommand
// Вызов GM-зависимой функции без нужного @grant падает в рантайме
// ("GM_getValue is not defined"), а не на этапе синтаксической проверки.

(function () {
  'use strict';

  const observers = new Set();
  const timers = new Set();
  const storageTimers = new Map();
  const uiTimers = new Set();

  function setManagedTimeout(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
  }

  function setUiTimeout(callback, delay) {
    const timer = setTimeout(() => { uiTimers.delete(timer); callback(); }, delay);
    uiTimers.add(timer);
    return timer;
  }

  function debounce(fn, wait = 250) {
    let timer = null;
    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    }
    debounced.cancel = () => { clearTimeout(timer); timer = null; };
    return debounced;
  }

  // Чистит только то, что создали waitForElement/observeAddedElements этого экземпляра ядра.
  // Дополнительные observer'ы (например, table-observer) скрипт обязан отключать сам через
  // сохранённый stopFn — см. core-template.user.js, паттерн stopExtraObserver.
  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  function cleanup() {
    cleanupRoute();
    for (const t of storageTimers.values()) clearTimeout(t);
    storageTimers.clear();
    for (const t of uiTimers) clearTimeout(t);
    uiTimers.clear();
  }

  async function storageGet(key, fallback = null) {
    try {
      const value = await GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch (error) {
      console.warn('[agis-core] GM_getValue ошибка:', key, error);
      return fallback;
    }
  }

  // Прямой вызов (key, value, wait) — как в скриптах после Волны 1, а не
  // фабрика (key, wait) => (value) => ... из core-template.user.js. Сигнатура
  // фиксируется тегом v1.0.0 — смена формы внутри мажора ломает всех потребителей.
  function storageSetDebounced(key, value, wait = 300) {
    const old = storageTimers.get(key);
    if (old) clearTimeout(old);
    const timer = setTimeout(async () => {
      storageTimers.delete(key);
      try { await GM_setValue(key, value); }
      catch (error) { console.warn('[agis-core] GM_setValue ошибка:', key, error); }
    }, wait);
    storageTimers.set(key, timer);
  }

  function waitForElement(selector, { root = document, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let observer = null;
      let timeoutTimer = null;

      const query = () => { try { return root.querySelector(selector); } catch { return null; } };

      const finish = (el) => {
        if (done) return;
        done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        if (timeoutTimer !== null) { clearTimeout(timeoutTimer); timers.delete(timeoutTimer); }
        resolve(el);
      };
      const fail = () => {
        if (done) return;
        done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        reject(new Error(`waitForElement: "${selector}" не найден за ${timeout}мс (${location.href})`));
      };

      const existing = query();
      if (existing) { finish(existing); return; }

      timeoutTimer = setManagedTimeout(fail, timeout);

      const startObserve = () => {
        if (done) return;
        const observeRoot = root === document ? (document.documentElement || document.body) : root;
        if (!observeRoot) { setManagedTimeout(startObserve, 50); return; }
        observer = new MutationObserver(() => { const el = query(); if (el) finish(el); });
        observer.observe(observeRoot, { childList: true, subtree: true });
        observers.add(observer);
        const el = query(); if (el) finish(el);
      };
      startObserve();
    });
  }

  // Владение через возвращаемый stopFn — этот observer НЕ входит в общий observers Set,
  // поэтому cleanupRoute() его не трогает (см. core-template.user.js).
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
    return () => observer.disconnect();
  }

  function httpRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 20000, ...details,
        onload: resolve,
        onerror: reject,
        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
        onabort: () => reject(new Error('GM_xmlhttpRequest aborted')),
      });
    });
  }

  const api = {
    async getJson(url, headers = {}) {
      const r = await httpRequest({
        method: 'GET', url,
        headers: { Accept: 'application/json, text/plain, */*', ...headers },
        responseType: 'json',
      });
      if (r.status !== 200) throw new Error(`getJson: HTTP ${r.status} ${url}`);
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
    async postJson(url, body, headers = {}) {
      const r = await httpRequest({
        method: 'POST', url,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        data: JSON.stringify(body), responseType: 'json',
      });
      if (r.status !== 200) throw new Error(`postJson: HTTP ${r.status} ${url}`);
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
    async getHtml(url, headers = {}) {
      const r = await httpRequest({
        method: 'GET', url,
        headers: { Accept: 'text/html,*/*', ...headers },
      });
      if (r.status !== 200) throw new Error(`getHtml: HTTP ${r.status} ${url}`);
      const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
      return { status: r.status, doc, finalUrl: r.finalUrl || url };
    },
  };

  let urlChangeInstalled = false;
  let lastUrl = location.href;

  function onUrlChange(callback) {
    if (urlChangeInstalled) {
      console.warn('[agis-core] onUrlChange уже установлен — повторный вызов игнорируется.');
      return () => {};
    }
    urlChangeInstalled = true;

    const check = debounce(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      callback(location.href);
    }, 100);

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) { const r = origPush.apply(this, args); check(); return r; };
    history.replaceState = function (...args) { const r = origReplace.apply(this, args); check(); return r; };
    window.addEventListener('popstate', check);
    window.addEventListener('hashchange', check);
    const interval = setInterval(check, 1000);

    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate', check);
      window.removeEventListener('hashchange', check);
      clearInterval(interval);
      check.cancel();
      urlChangeInstalled = false;
    };
  }

  // Замена россыпи `let routeToken = 0` по скриптам. token сверяется после каждого await
  // (см. core-template.user.js, комментарий про 4 проверки).
  function createRouteTokenController() {
    let token = 0;
    return {
      next() { return ++token; },
      isCurrent(t) { return t === token; },
    };
  }

  // Унификация 4 копипастов баннера (dup-income, googlesheet, protocol-fill, rusupport) — Волна 3.
  function showBanner(text, { type = 'success', durationMs = 6000 } = {}) {
    const colors = { success: '#00a65a', error: '#dd4b39', info: '#3c8dbc' };
    const div = document.createElement('div');
    div.textContent = text;
    Object.assign(div.style, {
      position: 'fixed', top: '60px', right: '20px', zIndex: '99999',
      background: colors[type] || colors.success, color: '#fff',
      padding: '10px 14px', borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,.2)', fontSize: '14px', maxWidth: '360px',
    });
    document.body.appendChild(div);
    setUiTimeout(() => div.remove(), durationMs);
    return () => div.remove();
  }

  // Асинхронная (не sync GM_getValue!) регистрация debug-переключателя в меню Tampermonkey.
  // Дождись промис перед тем, как использовать .value — до резолва значение всегда false.
  async function registerDebugToggle(scriptNs, debugKey) {
    let value = !!(await storageGet(debugKey, false));

    GM_registerMenuCommand(
      `Debug-логи (${scriptNs}): переключить`,
      async () => {
        value = !value;
        await GM_setValue(debugKey, value);
        alert(`[${scriptNs}] Debug-логи ${value ? 'включены' : 'выключены'}. Обновите страницу.`);
      }
    );

    return {
      get value() { return value; },
    };
  }

  window.__AGIS_CORE__ = {
    debounce,
    cleanupRoute,
    cleanup,
    storageGet,
    storageSetDebounced,
    waitForElement,
    observeAddedElements,
    httpRequest,
    api,
    onUrlChange,
    createRouteTokenController,
    showBanner,
    registerDebugToggle,
  };
})();
