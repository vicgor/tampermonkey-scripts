// ==UserScript==
// @name         AGIS - очистка вставки в поля суммы
// @namespace    agis.paste.cleaner
// @version      1.9
// @description  Очищает вставку в полях суммы: оставляет только цифры, точки и запятые; первый и последний символ — цифры.
// @match        https://agis.credit7.ru/*/loan*/*/create
// @match        https://agis.creditsmile.ru/*/loan*/*/create
// @match        https://agis.belkacredit.ru/*/loan*/*/create
// @match        https://agis.volgazaim.ru/*/loan*/*/create
// @match        https://agis.credit365.ru/*/loan*/*/create
// @match        https://agis.berrycash.ru/*/loan*/*/create
// @match        https://agis.moneymania.ru/*/loan*/*/create
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-paste-cleaner-amount.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-paste-cleaner-amount.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.0.0/lib/agis-core.js#sha256=VD6capqdxkgjVYVTXPdNDDIQtmrPhrnu4CN18A4CO1A=
// @run-at       document-start
// @sandbox      DOM
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Пилот Волны 2 (ROADMAP.md) подтверждён вручную в браузере (PR #13) —
  // @require теперь закреплён на неизменяемый тег v1.0.0 + SRI-хеш вместо
  // мутабельного main. Смена хеша/содержимого lib/agis-core.js внутри
  // тега v1.0.0 невозможна — новые версии ядра идут новым тегом.

  // Тестовый экспорт для vitest (см. test/scripts/agis-paste-cleaner-amount.test.js) —
  // до window-guard'а ниже, т.к. в Node window не определён вообще. В Tampermonkey
  // module не определён — блок не выполняется, поведение не меняется.
  if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
    module.exports = { cleanInput };
    return;
  }

  if (!window.__AGIS_CORE__) {
    console.error('[agis:paste-cleaner] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const { waitForElement, observeAddedElements, debounce, onUrlChange, cleanupRoute, cleanup } = window.__AGIS_CORE__;

  const SCRIPT_NS = 'agis:paste-cleaner';

  // id$="amount" покрывает и "amount", и "_amount".
  const TARGET_SELECTOR = ['input[type="text"][id$="_income"]', 'input[type="text"][id$="amount"]'].join(', ');

  const boundInputs = new WeakSet();
  let domObserverStop = null;

  function warn(...args) {
    console.warn(`[${SCRIPT_NS}]`, ...args);
  }

  // Оставляем только цифры, "." и ","; затем убираем разделители по краям.
  function cleanInput(value) {
    return String(value ?? '')
      .replace(/[^0-9.,]/g, '')
      .replace(/^[^0-9]+/, '')
      .replace(/[^0-9]+$/, '');
  }

  function setNativeInputValue(input, value) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
    const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const setter = ownDescriptor?.set || protoDescriptor?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
  }

  function dispatchInputEvents(input, insertedText) {
    let inputEvent;
    try {
      inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: insertedText,
      });
    } catch (_) {
      inputEvent = new Event('input', { bubbles: true, cancelable: true });
    }
    input.dispatchEvent(inputEvent);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function replaceSelection(input, text) {
    const value = input.value ?? '';
    const hasSelectionApi = typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number';
    const start = hasSelectionApi ? input.selectionStart : value.length;
    const end = hasSelectionApi ? input.selectionEnd : value.length;
    const nextValue = value.slice(0, start) + text + value.slice(end);
    const nextCaret = start + text.length;
    setNativeInputValue(input, nextValue);
    if (hasSelectionApi && document.activeElement === input) {
      try {
        input.setSelectionRange(nextCaret, nextCaret);
      } catch (_) {}
    }
    dispatchInputEvents(input, text);
  }

  function getClipboardText(event) {
    const clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard) return null;
    return clipboard.getData('text/plain') || clipboard.getData('text') || '';
  }

  function onPasteHandler(event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.disabled || input.readOnly) return;

    const pastedText = getClipboardText(event);
    if (pastedText === null || pastedText === '') return;

    const cleanedText = cleanInput(pastedText);
    // Если текст уже корректный, отдаём вставку браузеру: так лучше работают нативные события.
    if (cleanedText === pastedText) return;

    event.preventDefault();
    replaceSelection(input, cleanedText);
  }

  function bindInput(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (boundInputs.has(input)) return;
    if (!input.matches(TARGET_SELECTOR)) return;

    boundInputs.add(input);
    // capture=true позволяет очистить вставку до большинства обработчиков страницы.
    input.addEventListener('paste', onPasteHandler, true);
  }

  async function bootstrap() {
    cleanupRoute();
    if (domObserverStop) {
      domObserverStop();
      domObserverStop = null;
    }

    try {
      await waitForElement('body', { timeout: 15000 }).catch(() => null);
      document.querySelectorAll(TARGET_SELECTOR).forEach(bindInput);
      domObserverStop = observeAddedElements(TARGET_SELECTOR, bindInput);
    } catch (err) {
      warn('Ошибка инициализации:', err);
    }
  }

  const rebootstrap = debounce(bootstrap, 150);

  window.addEventListener(
    'pagehide',
    () => {
      cleanup();
      if (domObserverStop) {
        domObserverStop();
        domObserverStop = null;
      }
    },
    { once: true },
  );

  onUrlChange(() => rebootstrap());
  bootstrap();
})();
