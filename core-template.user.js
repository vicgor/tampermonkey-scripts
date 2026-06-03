// ==UserScript==
// @name         Robust Core Template
// @namespace    domain.feature        // <- заменить: например agis.loaninfo
// @version      0.2
// @description  Устойчивое ядро: ожидание DOM, GM_xmlhttpRequest, debounced GM_setValue, SPA-навигация, routeToken, cleanup
// @author       me
// @match        https://example.com/path/*    // <- заменить на реальный домен
// @icon         https://www.google.com/s2/favicons?sz=64&domain=example.com
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      example.com            // <- по одному @connect на каждый хост, не *
// ==/UserScript==

(() => {
  'use strict';

  // --- Настройки ---
  const SCRIPT_NS  = 'robust-core';   // <- заменить
  const DEBUG      = true;
  const WAIT_TIMEOUT = 15000;

  const log  = (...a) => { if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // --- Трекинг всех observerов и таймеров ---
  const observers = new Set();
  const timers    = new Set();
  const storageTimers = new Map();

  // routeToken — инкрементируется при каждом SPA-переходе.
  // После каждого await проверяй: if (token !== routeToken) return;
  let routeToken = 0;
  let lastUrl    = location.href;

  // setTimeout, который регистрируется в наборе и авто-удаляется по завершении
  function setManagedTimeout(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
  }

  // cleanupRoute — вызывай при каждом SPA-переходе.
  // Чистит observerы и таймеры текущего маршрута, не трогая сторадж-таймеры.
  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
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

  // Частые записи через debounce — защита от избыточных write-запросов к GM
  function storageSetDebounced(key, value, wait = 300) {
    const old = storageTimers.get(key);
    if (old) clearTimeout(old);
    const timer = setTimeout(async () => {
      storageTimers.delete(key);
      try { await GM_setValue(key, value); }
      catch (e) { warn('GM_setValue ошибка:', key, e); }
    }, wait);
    storageTimers.set(key, timer);
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
        warn(`waitForElement: "${selector}" не найден за ${timeout} мс (${location.href})`);
        reject(new Error(`waitForElement: "${selector}" not found`));
      };

      const existing = query();
      if (existing) { resolve(existing); return; }

      const timeoutTimer = setManagedTimeout(fail, timeout);

      // Если documentElement ещё нет (ранний document-start) — повторяем через 50 мс
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

  // Вызывает callback для каждого нового подходящего элемента
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
    observers.add(observer);
    return observer;
  }

  function onDomReady(cb) {
    if (document.readyState === 'interactive' || document.readyState === 'complete') { cb(); return; }
    document.addEventListener('DOMContentLoaded', cb, { once: true });
  }

  // --- Сетевые запросы через GM_xmlhttpRequest (обходит CSP сайта) ---
  // Домены должны быть перечислены в @connect по одному на каждый хост.
  function httpRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 20000, ...details,
        onload:   resolve,
        onerror:  reject,
        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
        onabort:   () => reject(new Error('GM_xmlhttpRequest aborted')),
      });
    });
  }

  const api = {
    async getJson(url, headers = {}) {
      const r = await httpRequest({
        method: 'GET', url,
        headers: { 'Accept': 'application/json, text/plain, */*', ...headers },
        responseType: 'json',
      });
      if (r.status !== 200) throw new Error(`getJson: HTTP ${r.status} ${url}`);
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
    async postJson(url, body, headers = {}) {
      const r = await httpRequest({
        method: 'POST', url,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
        data: JSON.stringify(body), responseType: 'json',
      });
      if (r.status !== 200) throw new Error(`postJson: HTTP ${r.status} ${url}`);
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
  };

  // --- SPA-навигация ---
  // Перехватывает pushState/replaceState + popstate + hashchange.
  // debounce 100 мс — защита от двойного срабатывания при replaceState+pushState подряд.
  function onUrlChange(callback) {
    let debounceTimer = null;
    const check = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        callback(lastUrl);
      }, 100);
    };

    const origPush    = history.pushState;
    const origReplace = history.replaceState;
    history.pushState    = function (...a) { const r = origPush.apply(this, a);    check(); return r; };
    history.replaceState = function (...a) { const r = origReplace.apply(this, a); check(); return r; };
    window.addEventListener('popstate',   check);
    window.addEventListener('hashchange', check);
  }

  // --- Точка входа ---
  async function bootstrap() {
    log('Инициализация');

    onDomReady(async () => {
      const token = ++routeToken;
      try {
        await waitForElement('body');
        if (token !== routeToken) return; // маршрут сменился пока ждали
        log('DOM готов');
        // TODO: здесь основная логика скрипта
      } catch (e) { warn(e.message); }
    });

    // Переинициализация при SPA-переходе
    onUrlChange((url) => {
      log('SPA-переход:', url);
      cleanupRoute();
      // TODO: здесь переинициализация логики
    });
  }

  window.addEventListener('pagehide', cleanup, { once: true });
  bootstrap().catch(e => console.error(`[${SCRIPT_NS}] Критическая ошибка`, e));
})();
