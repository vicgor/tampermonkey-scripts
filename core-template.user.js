// ==UserScript==
// @name         Robust Core Template
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Устойчивое ядро: ожидание DOM, GM_xmlhttpRequest, debounced GM_setValue, SPA-навигация, cleanup
// @author       me
// @match        https://example.com/path/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=example.com
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      example.com
// ==/UserScript==

(() => {
  'use strict';

  // --- Настройки и состояние ---
  const SCRIPT_NS = 'robust-core';
  const DEBUG = true;
  const state = { started: false, observers: new Set(), saveTimers: new Map() };

  const log = (...a) => { if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // --- Хранилище: GM_setValue с дебаунсом, GM_getValue с fallback ---
  // GM_setValue/GM_getValue в MV3 трактуем как асинхронные: await + try/catch.
  const debounceGMSetValue = (key, delay = 300) => (value) => {
    const prev = state.saveTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(async () => {
      try { await GM_setValue(key, value); log('Сохранено:', key); }
      catch (e) { warn('Ошибка GM_setValue:', key, e); }
      finally { state.saveTimers.delete(key); }
    }, delay);
    state.saveTimers.set(key, timer);
  };

  const storage = {
    async get(key, fallback = null) {
      try { return await GM_getValue(key, fallback); }
      catch (e) { warn('Ошибка GM_getValue:', key, e); return fallback; }
    },
    setDebounced: debounceGMSetValue,
  };

  // --- Ожидание элемента через MutationObserver (не устаревшие mutation events) ---
  // @run-at document-start даёт лишь самый ранний момент инъекции, элементов может ещё не быть.
  const waitForElement = (selector, { root = document, timeout = 15000 } = {}) =>
    new Promise((resolve, reject) => {
      const found = root.querySelector(selector);
      if (found) return resolve(found);
      const observer = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) { observer.disconnect(); state.observers.delete(observer); resolve(el); }
      });
      state.observers.add(observer);
      observer.observe(root === document ? document.documentElement : root,
        { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect(); state.observers.delete(observer);
        reject(new Error(`Таймаут ожидания: ${selector}`));
      }, timeout);
    });

  // --- Обработка динамически добавляемых элементов (списки, SPA-контент) ---
  const observeAddedElements = (selector, callback, { root = document.documentElement } = {}) => {
    const seen = new WeakSet();
    const process = (node) => {
      if (!(node instanceof Element)) return;
      const matched = [];
      if (node.matches?.(selector)) matched.push(node);
      matched.push(...(node.querySelectorAll?.(selector) || []));
      for (const el of matched) { if (seen.has(el)) continue; seen.add(el); callback(el); }
    };
    process(root);
    const observer = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) process(n);
    });
    observer.observe(root, { childList: true, subtree: true });
    state.observers.add(observer);
    return observer;
  };

  const onDomReady = (cb) => {
    if (document.readyState === 'interactive' || document.readyState === 'complete') return cb();
    document.addEventListener('DOMContentLoaded', cb, { once: true });
  };

  // --- Сетевые запросы через GM_xmlhttpRequest (обходит жёсткий CSP сайта) ---
  // Домены должны быть перечислены в @connect.
  const httpRequest = (details) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      timeout: 20000, ...details,
      onload: resolve,
      onerror: reject,
      ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
      onabort: () => reject(new Error('GM_xmlhttpRequest aborted')),
    });
  });

  const api = {
    async getJson(url, headers = {}) {
      const r = await httpRequest({
        method: 'GET', url,
        headers: { 'Accept': 'application/json, text/plain, */*', ...headers },
        responseType: 'json',
      });
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
    async postJson(url, body, headers = {}) {
      const r = await httpRequest({
        method: 'POST', url,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
        data: JSON.stringify(body), responseType: 'json',
      });
      return { status: r.status, data: r.response, finalUrl: r.finalUrl || url };
    },
  };

  // --- SPA-навигация: перехват pushState/replaceState + popstate ---
  const onUrlChange = (callback) => {
    let lastUrl = location.href;
    const wrap = (type) => {
      const orig = history[type];
      return function (...args) {
        const res = orig.apply(this, args);
        window.dispatchEvent(new Event('spa:navigation'));
        return res;
      };
    };
    history.pushState = wrap('pushState');
    history.replaceState = wrap('replaceState');
    const handler = () => {
      if (location.href !== lastUrl) { lastUrl = location.href; callback(lastUrl); }
    };
    window.addEventListener('spa:navigation', handler);
    window.addEventListener('popstate', handler);
  };

  // --- Точка входа ---
  const bootstrap = async () => {
    if (state.started) return;
    state.started = true;
    log('Инициализация');

    storage.setDebounced('lastRunAt', 500)(Date.now());

    onDomReady(async () => {
      try { await waitForElement('body'); log('DOM готов'); }
      catch (e) { warn(e.message); }
      // TODO: здесь основная логика скрипта
    });

    // Переинициализация логики при смене route в SPA
    onUrlChange((url) => { log('SPA-навигация:', url); /* TODO: re-init */ });
  };

  const cleanup = () => {
    for (const t of state.saveTimers.values()) clearTimeout(t);
    state.saveTimers.clear();
    for (const o of state.observers) o.disconnect();
    state.observers.clear();
    log('Очистка завершена');
  };

  window.addEventListener('beforeunload', cleanup, { once: true });
  bootstrap().catch(e => console.error(`[${SCRIPT_NS}] Критическая ошибка`, e));
})();
