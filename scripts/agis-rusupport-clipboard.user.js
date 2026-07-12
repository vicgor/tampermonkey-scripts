// ==UserScript==
// @name         AGIS: вставка RUSUPPORT в содержание заметки
// @namespace    agis.rusupport.clipboard
// @version      2.0.1
// @description  Вставляет текст из буфера обмена в поле "Содержание" при создании заметки к займу, только если текст содержит слово RUSUPPORT.
// @author       vicgor
// @match        https://agis.volgazaim.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.creditsmile.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.moneymania.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.berrycash.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.belkacredit.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.credit7.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.credit365.ru/admin/*/loan*/*/loannote/create*
// @run-at       document-start
// @sandbox      DOM
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  // --- Настройки ---
  const SCRIPT_NS = 'agis:rusupport';
  const KEYWORD   = 'RUSUPPORT';
  const CONTENT_SELECTOR = [
    'textarea[id$="content"][name$="content"]',
    '[id^="sonata-ba-field-container-"][id$="content"] textarea',
  ].join(', ');

  // Runtime-фильтр: страница создания заметки к займу на любом бренде AGIS.
  // Формы: /admin/agis2/core/loan/<id>/loannote/create и потенциальные варианты
  // без agis2/core/. @match уже отсеял всё лишнее — это дополнительная страховка.
  const TARGET_PATH_RE = /\/admin\/[^/]*\/?[^/]*\/?loan[^/]*\/[^/]+\/loannote\/create\/?$/i;

  const AUTO_INSERT_DELAY = 300;
  const WAIT_TIMEOUT      = 20000;

  // --- Debug: ключ в namespace, однократная миграция старого плоского ключа ---
  // Старый ключ 'debug_rusupport' (v1.x / v2.0.0) мигрируется при первом запуске.
  // После миграции плоский ключ не читается и не пишется.
  const DEBUG_KEY     = `${SCRIPT_NS}:debug`;
  const DEBUG_KEY_OLD = 'debug_rusupport';
  (() => {
    const legacy = GM_getValue(DEBUG_KEY_OLD, null);
    if (legacy !== null) {
      GM_setValue(DEBUG_KEY, !!legacy);
      GM_setValue(DEBUG_KEY_OLD, null); // очищаем, чтобы не мигрировать повторно
    }
  })();

  let DEBUG = !!GM_getValue(DEBUG_KEY, false);
  GM_registerMenuCommand(
    `Debug-логи: ${DEBUG ? '✅ вкл' : '⬜ выкл'} — нажмите для переключения`,
    () => {
      DEBUG = !DEBUG;
      GM_setValue(DEBUG_KEY, DEBUG);
      alert(`[${SCRIPT_NS}] Debug-логи ${DEBUG ? 'включены' : 'выключены'}. Обновите страницу.`);
    }
  );

  const log  = (...a) => { if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // --- Трекинг ресурсов ---
  const observers    = new Set();
  const timers       = new Set();
  const cleanupFns   = [];

  // routeToken инкрементируется при каждом SPA-переходе.
  let routeToken = 0;
  let lastUrl    = location.href;
  let urlChangeInstalled = false;

  // WeakSet вместо singleton — переживает cleanupRoute, GC собирает при удалении textarea.
  const initializedTextareas = new WeakSet();

  // --- Утилиты ---
  function setManagedTimeout(fn, delay) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, delay);
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

  function addCleanup(fn) { cleanupFns.push(fn); return fn; }

  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const fn of cleanupFns.splice(0)) {
      try { fn(); } catch (err) { warn('Ошибка cleanup:', err); }
    }
  }

  // --- DOM-ожидание (единая сигнатура с linkify: opts-объект) ---
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
        reject(new Error(`waitForElement: "${selector}" not found in ${timeout}ms`));
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

  function observeAddedElements(selector, callback, { root = null } = {}) {
    const observeRoot = root || document.documentElement || document.body;
    if (!observeRoot) return () => {};

    const process = (node) => {
      if (!(node instanceof Element)) return;
      if (node.matches?.(selector)) callback(node);
      for (const el of (node.querySelectorAll?.(selector) || [])) callback(el);
    };
    process(observeRoot);

    const observer = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) process(n);
    });
    observer.observe(observeRoot, { childList: true, subtree: true });
    return () => { observer.disconnect(); };
  }

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
    const interval = setInterval(check, 1000); // fallback для SPA без History-API событий

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

  // --- Storage ---
  const storage = {
    get(key, fallback = null) {
      try { return GM_getValue(key, fallback); }
      catch (err) { warn('GM_getValue недоступен:', err); return fallback; }
    },
    set(key, value) {
      try { GM_setValue(key, value); }
      catch (err) { warn('GM_setValue недоступен:', err); }
    },
  };

  // Нормализация pathname для ключа: убираем повторные '/' и trailing '/'
  // чтобы ключ был предсказуемым и компактным.
  // Пример: '/admin//agis2//loan/123/loannote/create/' → '/admin/agis2/loan/123/loannote/create'
  // Tampermonkey не документирует ограничение на длину ключа GM_storage,
  // но pathname типового URL AGIS (~60 символов) × 2 (префикс) ≈ 80 символов — в пределах нормы.
  function normalizePathKey(pathname) {
    return pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  const saveLastInsert = debounce((url, hash) => {
    storage.set(`${SCRIPT_NS}:lastInsert:v1:${normalizePathKey(url)}`, { hash, savedAt: Date.now() });
  }, 700);

  // --- Целевая страница ---
  function isTargetPage() {
    return TARGET_PATH_RE.test(location.pathname);
  }

  function hasKeyword(text) {
    return /(^|[^A-Za-z0-9_])RUSUPPORT([^A-Za-z0-9_]|$)/i.test(text);
  }

  function textHash(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  function dispatchFormEvents(textarea) {
    textarea.dispatchEvent(new Event('input',  { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function appendText(textarea, text) {
    const normalized = text.trim();
    const hash = textHash(normalized);

    if (!normalized) {
      return { inserted: false, message: 'Буфер пустой, поле не изменено.' };
    }
    if (!hasKeyword(normalized)) {
      return { inserted: false, message: `В буфере нет слова ${KEYWORD}, поле не изменено.` };
    }
    if (textarea.dataset.rusupportLastHash === hash) {
      return { inserted: false, message: 'Этот текст уже был вставлен на текущей странице.' };
    }

    const current = textarea.value || '';
    if (current.includes(normalized)) {
      textarea.dataset.rusupportLastHash = hash;
      return { inserted: false, message: 'Такой текст уже есть в поле.' };
    }

    textarea.value = current.trim()
      ? `${current.replace(/\s+$/u, '')}\n${normalized}`
      : normalized;

    textarea.dataset.rusupportLastHash = hash;
    dispatchFormEvents(textarea);
    textarea.focus();

    saveLastInsert(location.pathname, hash);

    return { inserted: true, message: `Текст с ${KEYWORD} добавлен в поле "Содержание".` };
  }

  async function readClipboardText() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      throw new Error('Clipboard API недоступен в этом контексте.');
    }
    return navigator.clipboard.readText();
  }

  // --- UI ---
  function createUi(textarea) {
    const wrapper = document.createElement('div');
    const button  = document.createElement('button');
    const status  = document.createElement('span');

    wrapper.className = 'tm-rusupport-clipboard';
    Object.assign(wrapper.style, {
      display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px',
    });

    button.type = 'button';
    button.textContent = `Вставить из буфера, если есть ${KEYWORD}`;
    button.className = 'btn btn-info btn-sm';

    status.textContent = 'Ожидаю буфер обмена...';
    status.style.fontSize = '12px';
    status.style.color = '#666';

    wrapper.append(button, status);
    textarea.insertAdjacentElement('afterend', wrapper);

    const setStatus = (message, type = 'info') => {
      status.textContent = message;
      status.style.color = type === 'error' ? '#b94a48'
        : type === 'success' ? '#3c763d'
        : '#666';
    };

    const onClick = async () => {
      button.disabled = true;
      setStatus('Читаю буфер обмена...');
      try {
        const text = await readClipboardText();
        const result = appendText(textarea, text);
        setStatus(result.message, result.inserted ? 'success' : 'info');
      } catch (err) {
        setStatus(`Не удалось прочитать буфер: ${err.message}`, 'error');
      } finally {
        button.disabled = false;
      }
    };

    button.addEventListener('click', onClick);
    addCleanup(() => button.removeEventListener('click', onClick));
    addCleanup(() => wrapper.remove());

    return { setStatus };
  }

  function installPasteGuard(textarea, setStatus) {
    const onPaste = (event) => {
      const pastedText = event.clipboardData?.getData('text/plain') || '';
      if (!hasKeyword(pastedText)) {
        event.preventDefault();
        setStatus(`Вставка отменена: в тексте нет слова ${KEYWORD}.`, 'error');
        return;
      }
      setStatus(`Вставка разрешена: найдено ${KEYWORD}.`, 'success');
    };
    textarea.addEventListener('paste', onPaste);
    addCleanup(() => textarea.removeEventListener('paste', onPaste));
  }

  async function tryAutoInsert(textarea, setStatus, token) {
    try {
      const text = await readClipboardText();
      if (token !== routeToken) return;
      const result = appendText(textarea, text);
      setStatus(result.message, result.inserted ? 'success' : 'info');
    } catch (err) {
      if (token !== routeToken) return;
      setStatus(
        'Авточтение буфера заблокировано браузером. Нажмите кнопку ручной вставки.',
        'info',
      );
      log('Авточтение буфера не выполнено:', err.message);
    }
  }

  function initContentField(textarea, token) {
    if (!textarea || initializedTextareas.has(textarea)) return;
    if (token !== routeToken) return;
    initializedTextareas.add(textarea);

    const { setStatus } = createUi(textarea);
    installPasteGuard(textarea, setStatus);

    // Автопопытка может не сработать из-за требований браузера к user gesture.
    setManagedTimeout(() => {
      if (token !== routeToken) return;
      tryAutoInsert(textarea, setStatus, token);
    }, AUTO_INSERT_DELAY);

    log('Поле "Содержание" найдено, обработчики установлены.');
  }

  // --- Точка входа ---
  async function bootstrap(reason = 'start') {
    const token = ++routeToken;
    cleanupRoute();
    log('Инициализация:', reason);

    if (!isTargetPage()) {
      log('Не целевая страница, скрипт молча выходит:', location.pathname);
      return;
    }

    try {
      const textarea = await waitForElement(CONTENT_SELECTOR, { timeout: WAIT_TIMEOUT });
      if (token !== routeToken) return;

      initContentField(textarea, token);

      const stopObserve = observeAddedElements(CONTENT_SELECTOR, (el) => initContentField(el, token));
      addCleanup(stopObserve);
    } catch (err) {
      log('bootstrap не нашёл textarea:', err.message);
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
