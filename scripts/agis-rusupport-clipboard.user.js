// ==UserScript==
// @name         AGIS: вставка RUSUPPORT в содержание заметки
// @namespace    https://github.com/vicgor/tampermonkey-scripts
// @version      1.0.0
// @description  Вставляет текст из буфера обмена в поле "Содержание" только если текст содержит слово RUSUPPORT.
// @author       vicgor
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*/loannote/create*
// @run-at       document-start
// @sandbox      DOM
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = 'AGIS RUSUPPORT Clipboard';
  const KEYWORD = 'RUSUPPORT';
  const CONTENT_SELECTOR = [
    'textarea[id$="content"][name$="content"]',
    '[id^="sonata-ba-field-container-"][id$="content"] textarea',
  ].join(', ');

  const TARGET_PATH_RE = /^\/admin\/agis2\/core\/loan\/[^/]+\/loannote\/create\/?$/i;

  let cleanupFns = [];
  let initializedTextarea = null;

  function log(...args) {
    console.log(`[${SCRIPT_NAME}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${SCRIPT_NAME}]`, ...args);
  }

  function addCleanup(fn) {
    cleanupFns.push(fn);
    return fn;
  }

  function cleanup() {
    for (const fn of cleanupFns.splice(0)) {
      try {
        fn();
      } catch (err) {
        warn('Ошибка cleanup:', err);
      }
    }

    initializedTextarea = null;
  }

  function debounce(fn, wait = 500) {
    let timer = null;

    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  const storage = {
    async get(key, fallback = null) {
      try {
        return await GM_getValue(key, fallback);
      } catch (err) {
        warn('GM_getValue недоступен:', err);
        return fallback;
      }
    },

    async set(key, value) {
      try {
        await GM_setValue(key, value);
      } catch (err) {
        warn('GM_setValue недоступен:', err);
      }
    },
  };

  const saveLastInsert = debounce((url, hash) => {
    storage.set(`lastInsert:${url}`, {
      hash,
      savedAt: Date.now(),
    });
  }, 700);

  function waitForElement(selector, timeout = 15000, root = document) {
    return new Promise((resolve, reject) => {
      let observer = null;
      let timer = null;
      let domReadyListener = null;

      const query = () => {
        if (!root || typeof root.querySelector !== 'function') {
          return null;
        }

        return root.querySelector(selector);
      };

      const finish = (callback, value) => {
        if (observer) observer.disconnect();
        if (timer) clearTimeout(timer);
        if (domReadyListener) document.removeEventListener('DOMContentLoaded', domReadyListener);
        callback(value);
      };

      const startObserve = () => {
        const existing = query();

        if (existing) {
          finish(resolve, existing);
          return;
        }

        const observeRoot = root === document
          ? document.documentElement || document.body
          : root;

        if (!observeRoot) {
          domReadyListener = startObserve;
          document.addEventListener('DOMContentLoaded', domReadyListener, { once: true });
          return;
        }

        observer = new MutationObserver(() => {
          const found = query();

          if (found) {
            finish(resolve, found);
          }
        });

        observer.observe(observeRoot, {
          childList: true,
          subtree: true,
        });
      };

      timer = setTimeout(() => {
        finish(reject, new Error(`Не найден элемент: ${selector}`));
      }, timeout);

      startObserve();
    });
  }

  function observeAddedElements(selector, callback, root = document) {
    const observeRoot = root === document
      ? document.documentElement || document.body
      : root;

    if (!observeRoot) {
      return () => {};
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;

          if (node.matches(selector)) {
            callback(node);
          }

          for (const nested of node.querySelectorAll(selector)) {
            callback(nested);
          }
        }
      }
    });

    observer.observe(observeRoot, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }

  function onUrlChange(callback) {
    let lastUrl = location.href;

    const fireIfChanged = () => {
      if (location.href === lastUrl) return;

      lastUrl = location.href;
      callback(location.href);
    };

    for (const methodName of ['pushState', 'replaceState']) {
      const original = history[methodName];

      history[methodName] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        queueMicrotask(fireIfChanged);
        return result;
      };
    }

    window.addEventListener('popstate', fireIfChanged);
    window.addEventListener('hashchange', fireIfChanged);
  }

  function isTargetPage() {
    return location.hostname === 'agis.moneymania.ru'
      && TARGET_PATH_RE.test(location.pathname);
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
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function appendText(textarea, text) {
    const normalized = text.trim();
    const hash = textHash(normalized);

    if (!normalized) {
      return {
        inserted: false,
        message: 'Буфер пустой, поле не изменено.',
      };
    }

    if (!hasKeyword(normalized)) {
      return {
        inserted: false,
        message: `В буфере нет слова ${KEYWORD}, поле не изменено.`,
      };
    }

    if (textarea.dataset.rusupportLastHash === hash) {
      return {
        inserted: false,
        message: 'Этот текст уже был вставлен на текущей странице.',
      };
    }

    const current = textarea.value || '';

    if (current.includes(normalized)) {
      textarea.dataset.rusupportLastHash = hash;

      return {
        inserted: false,
        message: 'Такой текст уже есть в поле.',
      };
    }

    textarea.value = current.trim()
      ? `${current.replace(/\s+$/u, '')}\n${normalized}`
      : normalized;

    textarea.dataset.rusupportLastHash = hash;
    dispatchFormEvents(textarea);
    textarea.focus();

    saveLastInsert(location.pathname, hash);

    return {
      inserted: true,
      message: `Текст с ${KEYWORD} добавлен в поле "Содержание".`,
    };
  }

  async function readClipboardText() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      throw new Error('Clipboard API недоступен в этом контексте.');
    }

    return navigator.clipboard.readText();
  }

  function createUi(textarea) {
    const wrapper = document.createElement('div');
    const button = document.createElement('button');
    const status = document.createElement('span');

    wrapper.className = 'tm-rusupport-clipboard';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '10px';
    wrapper.style.marginTop = '8px';

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
      status.style.color = type === 'error'
        ? '#b94a48'
        : type === 'success'
          ? '#3c763d'
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

  async function tryAutoInsert(textarea, setStatus) {
    try {
      const text = await readClipboardText();
      const result = appendText(textarea, text);
      setStatus(result.message, result.inserted ? 'success' : 'info');
    } catch (err) {
      setStatus(
        'Авточтение буфера заблокировано браузером. Нажмите кнопку ручной вставки.',
        'info',
      );
      warn('Авточтение буфера не выполнено:', err);
    }
  }

  async function initContentField(textarea) {
    if (!textarea || textarea === initializedTextarea) return;

    initializedTextarea = textarea;

    const { setStatus } = createUi(textarea);
    installPasteGuard(textarea, setStatus);

    // Автопопытка может не сработать из-за требований браузера к действию пользователя.
    window.setTimeout(() => {
      tryAutoInsert(textarea, setStatus);
    }, 300);

    log('Поле "Содержание" найдено и обработчики установлены.');
  }

  async function bootstrap() {
    cleanup();

    if (!isTargetPage()) return;

    try {
      const textarea = await waitForElement(CONTENT_SELECTOR, 20000);
      await initContentField(textarea);

      const stopObserve = observeAddedElements(CONTENT_SELECTOR, initContentField);
      addCleanup(stopObserve);
    } catch (err) {
      warn(err.message);
    }
  }

  if (document.readyState === 'loading') {
    bootstrap();
  } else {
    queueMicrotask(bootstrap);
  }

  onUrlChange(() => {
    bootstrap();
  });
})();
