// ==UserScript==
// @name         AGIS: вставка RUSUPPORT в содержание заметки
// @namespace    agis.rusupport.clipboard
// @version      2.1.0
// @description  Вставляет текст из буфера обмена в поле "Содержание" при создании заметки к займу, только если текст содержит слово RUSUPPORT.
// @author       vicgor
// @match        https://agis.volgazaim.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.creditsmile.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.moneymania.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.berrycash.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.belkacredit.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.credit7.ru/admin/*/loan*/*/loannote/create*
// @match        https://agis.credit365.ru/admin/*/loan*/*/loannote/create*
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.0.0/lib/agis-core.js#sha256=VD6capqdxkgjVYVTXPdNDDIQtmrPhrnu4CN18A4CO1A=
// @run-at       document-start
// @sandbox      DOM
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[agis:rusupport] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    waitForElement,
    observeAddedElements,
    cleanupRoute,
    onUrlChange,
    createRouteTokenController,
    registerDebugToggle,
    storageSetDebounced,
  } = window.__AGIS_CORE__;

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

  const DEBUG_KEY     = `${SCRIPT_NS}:debug`;
  const DEBUG_KEY_OLD = 'debug_rusupport';

  // registerDebugToggle асинхронный — debugCtl.value равен false до его резолва.
  // bootstrap('document-start') стартует не дожидаясь этого (см. низ файла), чтобы
  // не откладывать первый поиск textarea на await GM_getValue/migrateLegacyDebugKey.
  // Цена: если debug уже был включён в хранилище, первые строки лога этого запуска
  // (в т.ч. само "Инициализация: document-start") могут не напечататься — догонит
  // только следующий вызов log() после резолва промиса.
  let debugCtl = { value: false };
  const log  = (...a) => { if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // Разовая миграция плоского ключа 'debug_rusupport' (v1.x / v2.0.0) в namespace.
  // После миграции плоский ключ не читается и не пишется.
  async function migrateLegacyDebugKey() {
    try {
      const legacy = await GM_getValue(DEBUG_KEY_OLD, null);
      if (legacy !== null) {
        await GM_setValue(DEBUG_KEY, !!legacy);
        await GM_setValue(DEBUG_KEY_OLD, null);
      }
    } catch (err) {
      warn('Миграция debug-ключа не удалась:', err);
    }
  }

  const routeTokenController = createRouteTokenController();

  // WeakSet вместо singleton — переживает cleanupRoute, GC собирает при удалении textarea.
  const initializedTextareas = new WeakSet();

  // Доп. cleanup, который ядро не отслеживает: снятие UI-кнопки, paste-guard'а
  // и extra-observer'а. В отличие от observers/timers ядра, это реально дренируется
  // на каждом SPA-переходе (cleanupRoute() ядра чистит только своё).
  const cleanupFns = [];
  function addCleanup(fn) { cleanupFns.push(fn); return fn; }
  function runExtraCleanup() {
    for (const fn of cleanupFns.splice(0)) {
      try { fn(); } catch (err) { warn('Ошибка cleanup:', err); }
    }
  }

  // Нормализация pathname для ключа: убираем повторные '/' и trailing '/'
  // чтобы ключ был предсказуемым и компактным.
  // Пример: '/admin//agis2//loan/123/loannote/create/' → '/admin/agis2/loan/123/loannote/create'
  // Tampermonkey не документирует ограничение на длину ключа GM_storage,
  // но pathname типового URL AGIS (~60 символов) × 2 (префикс) ≈ 80 символов — в пределах нормы.
  function normalizePathKey(pathname) {
    return pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  // storageSetDebounced дебаунсит по ключу (не всю функцию, как раньше) — быстрые
  // вызовы с разными url больше не затирают друг друга: каждый путь получает
  // свой отложенный таймер записи вместо одного общего на функцию.
  function saveLastInsert(url, hash) {
    storageSetDebounced(`${SCRIPT_NS}:lastInsert:v1:${normalizePathKey(url)}`, { hash, savedAt: Date.now() }, 700);
  }

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
      if (!routeTokenController.isCurrent(token)) return;
      const result = appendText(textarea, text);
      setStatus(result.message, result.inserted ? 'success' : 'info');
    } catch (err) {
      if (!routeTokenController.isCurrent(token)) return;
      setStatus(
        'Авточтение буфера заблокировано браузером. Нажмите кнопку ручной вставки.',
        'info',
      );
      log('Авточтение буфера не выполнено:', err.message);
    }
  }

  function initContentField(textarea, token) {
    if (!textarea || initializedTextareas.has(textarea)) return;
    if (!routeTokenController.isCurrent(token)) return;
    initializedTextareas.add(textarea);

    const { setStatus } = createUi(textarea);
    installPasteGuard(textarea, setStatus);

    // Автопопытка может не сработать из-за требований браузера к user gesture.
    // token-проверка внутри достаточна для корректности при SPA-переходе, но таймер
    // всё равно явно отменяется через addCleanup — чтобы не оставлять висящий колбэк
    // при быстрой навигации/pagehide до его срабатывания.
    const autoInsertTimer = setTimeout(() => {
      if (!routeTokenController.isCurrent(token)) return;
      tryAutoInsert(textarea, setStatus, token);
    }, AUTO_INSERT_DELAY);
    addCleanup(() => clearTimeout(autoInsertTimer));

    log('Поле "Содержание" найдено, обработчики установлены.');
  }

  // --- Точка входа ---
  async function bootstrap(reason = 'start') {
    const token = routeTokenController.next();
    cleanupRoute();
    runExtraCleanup();
    log('Инициализация:', reason);

    if (!isTargetPage()) {
      log('Не целевая страница, скрипт молча выходит:', location.pathname);
      return;
    }

    try {
      const textarea = await waitForElement(CONTENT_SELECTOR, { timeout: WAIT_TIMEOUT });
      if (!routeTokenController.isCurrent(token)) return;

      initContentField(textarea, token);

      const stopObserve = observeAddedElements(CONTENT_SELECTOR, (el) => initContentField(el, token));
      addCleanup(stopObserve);
    } catch (err) {
      log('bootstrap не нашёл textarea:', err.message);
    }
  }

  // --- Запуск ---
  const stopUrlWatcher = onUrlChange(() => bootstrap('url-change'));

  // Двойной вызов cleanupRoute()/runExtraCleanup() (последний bootstrap() уже мог
  // их вызвать) безопасен — оба идемпотентны: Sets/массив просто оказываются пустыми.
  window.addEventListener('pagehide', () => {
    cleanupRoute();
    runExtraCleanup();
    stopUrlWatcher();
  }, { once: true });

  (async () => {
    await migrateLegacyDebugKey();
    debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
  })();

  bootstrap('document-start');
})();
