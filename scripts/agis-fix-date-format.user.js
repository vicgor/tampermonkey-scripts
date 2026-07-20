// ==UserScript==
// @name         AGIS - исправление формата даты
// @namespace    agis.fix.date.format
// @version      1.0
// @description  Исправляет ввод даты в полях типа date/datetime-local: при вводе через клавиатуру или вставку преобразует форматы ДД.ММ.ГГГГ и ГГГГ-ММ-ДД в значение, принимаемое браузером (ГГГГ-ММ-ДД для date, ГГГГ-ММ-ДДTHH:MM для datetime-local).
// @match        https://agis.credit7.ru/*/loan*/*/create
// @match        https://agis.creditsmile.ru/*/loan*/*/create
// @match        https://agis.belkacredit.ru/*/loan*/*/create
// @match        https://agis.volgazaim.ru/*/loan*/*/create
// @match        https://agis.credit365.ru/*/loan*/*/create
// @match        https://agis.berrycash.ru/*/loan*/*/create
// @match        https://agis.moneymania.ru/*/loan*/*/create
// @updateURL    https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-fix-date-format.user.js
// @downloadURL  https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/main/scripts/agis-fix-date-format.user.js
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.0.0/lib/agis-core.js#sha256=VD6capqdxkgjVYVTXPdNDDIQtmrPhrnu4CN18A4CO1A=
// @run-at       document-start
// @sandbox      DOM
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (typeof process !== 'undefined' && process.versions?.node && typeof module !== 'undefined' && module.exports) {
    module.exports = { parseDateValue, toDateValue, toDateTimeLocalValue };
    return;
  }

  if (!window.__AGIS_CORE__) {
    console.error('[agis:fix-date-format] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const { waitForElement, observeAddedElements, debounce, onUrlChange, cleanupRoute, cleanup } = window.__AGIS_CORE__;

  const SCRIPT_NS = 'agis:fix-date-format';

  const TARGET_SELECTOR = 'input[type="date"], input[type="datetime-local"]';

  const boundInputs = new WeakSet();
  let domObserverStop = null;

  function warn(...args) {
    console.warn(`[${SCRIPT_NS}]`, ...args);
  }

  /**
   * Разбирает строку даты в форматах:
   *   DD.MM.YYYY            → { year, month, day }
   *   YYYY-MM-DD            → { year, month, day }
   *   DD.MM.YYYY HH:MM      → { year, month, day, hours, minutes }
   *   YYYY-MM-DDTHH:MM      → { year, month, day, hours, minutes }
   * Возвращает null если формат не распознан или дата невалидна.
   */
  function parseDateValue(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim();

    // DD.MM.YYYY[ HH:MM]
    const dmyMatch = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2}))?$/);
    if (dmyMatch) {
      const [, dd, mm, yyyy, hh, min] = dmyMatch;
      return {
        year: Number(yyyy),
        month: Number(mm),
        day: Number(dd),
        hours: hh !== undefined ? Number(hh) : null,
        minutes: min !== undefined ? Number(min) : null,
      };
    }

    // YYYY-MM-DD[THH:MM]
    const isoDashMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
    if (isoDashMatch) {
      const [, yyyy, mm, dd, hh, min] = isoDashMatch;
      return {
        year: Number(yyyy),
        month: Number(mm),
        day: Number(dd),
        hours: hh !== undefined ? Number(hh) : null,
        minutes: min !== undefined ? Number(min) : null,
      };
    }

    return null;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function isValidDate({ year, month, day }) {
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  }

  /** Возвращает строку YYYY-MM-DD для input[type="date"] */
  function toDateValue(parsed) {
    if (!parsed || !isValidDate(parsed)) return null;
    return `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`;
  }

  /** Возвращает строку YYYY-MM-DDTHH:MM для input[type="datetime-local"] */
  function toDateTimeLocalValue(parsed) {
    if (!parsed || !isValidDate(parsed)) return null;
    const hh = parsed.hours !== null ? parsed.hours : 0;
    const min = parsed.minutes !== null ? parsed.minutes : 0;
    return `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}T${pad(hh)}:${pad(min)}`;
  }

  function setNativeInputValue(input, value) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
    const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const setter = ownDescriptor?.set || protoDescriptor?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
  }

  function dispatchInputEvents(input) {
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyDateFix(input, rawValue) {
    const parsed = parseDateValue(rawValue);
    if (!parsed) return false;

    const isDateTimeLocal = input.type === 'datetime-local';
    const formatted = isDateTimeLocal ? toDateTimeLocalValue(parsed) : toDateValue(parsed);
    if (!formatted) return false;
    if (formatted === input.value) return false;

    setNativeInputValue(input, formatted);
    dispatchInputEvents(input);
    return true;
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
    if (!pastedText) return;

    const parsed = parseDateValue(pastedText);
    if (!parsed) return;

    const isDateTimeLocal = input.type === 'datetime-local';
    const formatted = isDateTimeLocal ? toDateTimeLocalValue(parsed) : toDateValue(parsed);
    if (!formatted) return;

    event.preventDefault();
    setNativeInputValue(input, formatted);
    dispatchInputEvents(input);
  }

  // При потере фокуса пробуем переформатировать то, что ввёл пользователь руками.
  function onBlurHandler(event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.disabled || input.readOnly) return;
    if (!input.value) return;

    applyDateFix(input, input.value);
  }

  function bindInput(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (boundInputs.has(input)) return;
    if (!input.matches(TARGET_SELECTOR)) return;

    boundInputs.add(input);
    input.addEventListener('paste', onPasteHandler, true);
    input.addEventListener('blur', onBlurHandler, true);
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
