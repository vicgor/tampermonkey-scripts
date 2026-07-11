// ==UserScript==
// @name         AGIS - linkify loannote
// @namespace    agis.linkify.loannote
// @version      3.0
// @description  Делает ссылки кликабельными в колонке "Контент" на страницах loannote/list. Поддерживает markdown-ссылки, голые URL и тикеты Jira RUSUPPORT-*.
// @match        https://agis.volgazaim.ru/admin/*/loannote/list*
// @match        https://agis.creditsmile.ru/admin/*/loannote/list*
// @match        https://agis.moneymania.ru/admin/*/loannote/list*
// @match        https://agis.berrycash.ru/admin/*/loannote/list*
// @match        https://agis.belkacredit.ru/admin/*/loannote/list*
// @match        https://agis.credit7.ru/admin/*/loannote/list*
// @match        https://agis.credit365.ru/admin/*/loannote/list*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  // --- Настройки ---
  const SCRIPT_NS    = 'agis:linkify';
  const JIRA_BASE    = 'https://jira.aventus.work/browse/';
  const STYLE_ID     = 'tm-loannote-style';
  const CELL_SELECTOR = 'table.sonata-ba-list td.sonata-ba-list-field-textarea';
  const WAIT_TIMEOUT = 15000;

  // @sandbox DOM: GM_getValue возвращает готовое значение (не Promise), но храним await ниже
  // на случай будущего изменения sandbox-режима — так безопаснее.
  let DEBUG = !!GM_getValue('debug_linkify', false);

  GM_registerMenuCommand(
    `Debug-логи: ${DEBUG ? '✅ вкл' : '⬜ выкл'} — нажмите для переключения`,
    () => {
      DEBUG = !DEBUG;
      GM_setValue('debug_linkify', DEBUG);
      alert(`[${SCRIPT_NS}] Debug-логи ${DEBUG ? 'включены' : 'выключены'}. Обновите страницу.`);
    }
  );

  const log  = (...a) => { if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // --- Трекинг наблюдателей и таймеров ---
  // observers: только те, что созданы waitForElement.
  // observeAddedElements не добавляет сюда — владение через stopExtraObserver.
  const observers = new Set();
  const timers    = new Set();

  // routeToken инкрементируется при каждом SPA-переходе.
  // Проверяем (token !== routeToken) после каждого await.
  let routeToken = 0;
  let lastUrl    = location.href;
  let urlChangeInstalled = false;

  // stopFn для observeAddedElements — чистится в cleanupRoute отдельно от observers Set.
  let stopExtraObserver = null;

  // WeakSet обработанных ячеек — переживает cleanupRoute (dataset ушёл бы вместе с DOM).
  // На каждом маршруте ячейки новые, поэтому дубли не возникают.
  const processedCells = new WeakSet();

  // --- Утилиты ---
  function setManagedTimeout(callback, delay) {
    const t = setTimeout(() => { timers.delete(t); callback(); }, delay);
    timers.add(t);
    return t;
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

  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (stopExtraObserver) { stopExtraObserver(); stopExtraObserver = null; }
  }

  // --- DOM-ожидание через MutationObserver (не setInterval) ---
  function waitForElement(selector, { root = document, timeout = WAIT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let observer = null;
      let timeoutTimer = null;

      const query = () => { try { return root.querySelector(selector); } catch (_) { return null; } };

      const finish = (el) => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        if (timeoutTimer !== null) { clearTimeout(timeoutTimer); timers.delete(timeoutTimer); }
        resolve(el);
      };
      const fail = () => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        warn(`waitForElement: "${selector}" не найден за ${timeout} мс (${location.href})`);
        reject(new Error(`waitForElement: "${selector}" not found`));
      };

      const existing = query();
      if (existing) { finish(existing); return; }

      timeoutTimer = setManagedTimeout(fail, timeout);

      const startObserve = () => {
        if (done) return;
        const observeRoot = root === document
          ? (document.documentElement || document.body)
          : root;
        if (!observeRoot) { setManagedTimeout(startObserve, 50); return; }
        observer = new MutationObserver(() => { const el = query(); if (el) finish(el); });
        observer.observe(observeRoot, { childList: true, subtree: true });
        observers.add(observer);
        const el = query(); if (el) finish(el);
      };
      startObserve();
    });
  }

  // Наблюдение за добавлением ячеек. Владение — только через возвращаемый stopFn.
  function observeAddedElements(selector, callback, { root = null } = {}) {
    const observeRoot = root || document.documentElement || document.body;
    if (!observeRoot) return () => {};

    const process = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches?.(selector)) callback(node);
      for (const el of (node.querySelectorAll?.(selector) || [])) callback(el);
    };

    // Первичный обход текущего DOM
    process(observeRoot);

    const observer = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) process(n);
    });
    observer.observe(observeRoot, { childList: true, subtree: true });
    return () => { observer.disconnect(); };
  }

  // --- SPA-навигация ---
  // Патчим pushState/replaceState + popstate + hashchange.
  // setInterval оставлен как fallback для фреймворков без History-API событий (обосновано в README).
  function onUrlChange(callback) {
    if (urlChangeInstalled) {
      warn('onUrlChange уже установлен — повторный вызов игнорируется.');
      return () => {};
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
    // setInterval — запасной механизм для SPA, не отправляющих History-API события.
    const interval = setInterval(check, 1000);

    return () => {
      history.pushState    = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate',   check);
      window.removeEventListener('hashchange', check);
      clearInterval(interval);
      check.cancel();
      urlChangeInstalled = false;
    };
  }

  // --- Стили ---
  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    if (!document.head) return; // на document-start head может отсутствовать
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a.tm-external-link {
        color: #0b69a3 !important;
        text-decoration: underline !important;
        word-break: break-all;
      }
      a.tm-jira-link {
        color: #7b1fa2 !important;
        text-decoration: underline !important;
        font-weight: 600;
        word-break: break-all;
      }
    `;
    document.head.appendChild(style);
  }

  // --- Линкификация ---
  function createLink(url, text, className) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = text || url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = className;
    return a;
  }

  function isInsideLink(node) {
    let el = node.parentElement;
    while (el) {
      if (el.tagName === 'A') return true;
      el = el.parentElement;
    }
    return false;
  }

  // Обрабатывает 3 паттерна по приоритету:
  //   1. Markdown-ссылка: [text](url)
  //   2. Голый URL: https://...
  //   3. Тикет Jira: RUSUPPORT-12345
  function getTokenRe() {
    return /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\bhttps?:\/\/[^\s<>"'\]]+|\bRUSUPPORT-\d+\b/gi;
  }

  function linkifyTextNode(textNode) {
    if (!textNode.nodeValue || !textNode.nodeValue.trim() || isInsideLink(textNode)) return;

    const text = textNode.nodeValue;
    if (!getTokenRe().test(text)) return;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    const execRe = getTokenRe();

    while ((match = execRe.exec(text)) !== null) {
      const start = match.index;

      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }

      const isMarkdown = match[1] !== undefined;
      const token = match[0];

      if (isMarkdown) {
        const label = match[1];
        const url   = match[2];
        const className = /RUSUPPORT-\d+/i.test(url) ? 'tm-jira-link' : 'tm-external-link';
        frag.appendChild(createLink(url, label, className));
      } else if (/^https?:\/\//i.test(token)) {
        const className = /RUSUPPORT-\d+/i.test(token) ? 'tm-jira-link' : 'tm-external-link';
        frag.appendChild(createLink(token, token, className));
      } else {
        frag.appendChild(createLink(JIRA_BASE + token, token, 'tm-jira-link'));
      }

      lastIndex = start + token.length;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
  }

  function processCell(cell) {
    if (!cell || processedCells.has(cell)) return;
    processedCells.add(cell);

    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim()) nodes.push(node);
    }
    if (nodes.length) log('processing cell, text nodes:', nodes.length);
    nodes.forEach(linkifyTextNode);
  }

  // --- Точка входа ---
  async function bootstrap(reason = 'start') {
    const token = ++routeToken;
    cleanupRoute();
    log('Инициализация:', reason);

    try {
      addStyles();

      // [1] Ждём хотя бы одну ячейку таблицы loannote.
      // Может не появиться на страницах фильтров без результатов — ловим ошибку в catch.
      await waitForElement(CELL_SELECTOR, { timeout: WAIT_TIMEOUT });

      // Проверка токена сразу после DOM-ожидания.
      if (token !== routeToken) return;

      // Обрабатываем всё, что уже есть, и подписываемся на новые ячейки.
      // debounce не нужен — processCell идемпотентен (WeakSet).
      stopExtraObserver = observeAddedElements(CELL_SELECTOR, processCell);

    } catch (err) {
      // На страницах без loannote-таблицы это нормально: скрипт молча ничего не делает.
      log('bootstrap завершён без обработки:', err.message);
    }
  }

  // --- Запуск ---
  const stopUrlWatcher = onUrlChange(() => bootstrap('url-change'));

  window.addEventListener('pagehide', () => {
    cleanupRoute();
    stopUrlWatcher();
  }, { once: true });

  bootstrap('document-start');
})();
