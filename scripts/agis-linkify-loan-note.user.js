// ==UserScript==
// @name         AGIS - linkify loannote
// @namespace    agis.linkify.loannote
// @version      3.2
// @description  Делает ссылки кликабельными в колонке "Контент" на страницах loannote/list. Поддерживает markdown-ссылки, голые URL и тикеты Jira RUSUPPORT-*.
// @match        https://agis.volgazaim.ru/admin/*/loannote/list*
// @match        https://agis.creditsmile.ru/admin/*/loannote/list*
// @match        https://agis.moneymania.ru/admin/*/loannote/list*
// @match        https://agis.berrycash.ru/admin/*/loannote/list*
// @match        https://agis.belkacredit.ru/admin/*/loannote/list*
// @match        https://agis.credit7.ru/admin/*/loannote/list*
// @match        https://agis.credit365.ru/admin/*/loannote/list*
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.0.0/lib/agis-core.js#sha256=VD6capqdxkgjVYVTXPdNDDIQtmrPhrnu4CN18A4CO1A=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[agis:linkify] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    waitForElement,
    observeAddedElements,
    cleanupRoute,
    onUrlChange,
    createRouteTokenController,
    registerDebugToggle,
  } = window.__AGIS_CORE__;

  // --- Настройки ---
  const SCRIPT_NS = 'agis:linkify';
  const DEBUG_KEY = 'agis:linkify:debug';
  const JIRA_BASE = 'https://jira.aventus.work/browse/';
  const STYLE_ID = 'tm-loannote-style';
  const CELL_SELECTOR = 'table.sonata-ba-list td.sonata-ba-list-field-textarea';
  const WAIT_TIMEOUT = 15000;

  // registerDebugToggle асинхронный — debugCtl.value равен false, пока не резолвится.
  // onUrlChange устанавливается синхронно (см. низ файла) — SPA-watcher не задерживается.
  // bootstrap() же дожидается регистрации debug-toggle перед первым запуском: иначе
  // на страницах, где CELL_SELECTOR уже есть в DOM при старте, log() внутри processCell
  // мог выполниться раньше, чем резолвится debugCtl, и debug-логи не появились бы вовсе
  // (см. agis-duplicate-income.user.js, где эта гонка реально проявилась).
  let debugCtl = { value: false };
  const log = (...a) => {
    if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a);
  };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  const routeTokenController = createRouteTokenController();

  // stopFn для observeAddedElements — не входит в cleanupRoute ядра, чистим сами.
  let stopExtraObserver = null;

  // WeakSet обработанных ячеек — переживает cleanupRoute (dataset ушёл бы вместе с DOM).
  // На каждом маршруте ячейки новые, поэтому дубли не возникают.
  const processedCells = new WeakSet();

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
        const url = match[2];
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
    const token = routeTokenController.next();
    cleanupRoute();
    if (stopExtraObserver) {
      stopExtraObserver();
      stopExtraObserver = null;
    }
    log('Инициализация:', reason);

    try {
      addStyles();

      // Может не появиться на страницах фильтров без результатов — ловим ошибку в catch.
      await waitForElement(CELL_SELECTOR, { timeout: WAIT_TIMEOUT });

      if (!routeTokenController.isCurrent(token)) return;

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

  window.addEventListener(
    'pagehide',
    () => {
      cleanupRoute();
      if (stopExtraObserver) {
        stopExtraObserver();
        stopExtraObserver = null;
      }
      stopUrlWatcher();
    },
    { once: true },
  );

  (async () => {
    try {
      debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    } catch (err) {
      warn('Инициализация debug-toggle не удалась:', err);
    }
    bootstrap('document-start');
  })();
})();
