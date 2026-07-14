// ==UserScript==
// @name         AGIS автозаполнение из Google Sheets
// @namespace    agis.income.googlesheet
// @version      4.3
// @description  Автозаполнение формы AGIS из Google Таблицы (CSV Publish). Запрос через GM_xmlhttpRequest (обходит CSP).
// @match        https://agis.creditsmile.ru/*/loan*/*/income/create
// @match        https://agis.belkacredit.ru/*/loan*/*/income/create
// @match        https://agis.volgazaim.ru/*/loan*/*/income/create
// @match        https://agis.berrycash.ru/*/loan*/*/income/create
// @match        https://agis.moneymania.ru/*/loan*/*/income/create
// @match        https://agis.credit7.ru/*/loan*/*/income/create
// @match        https://agis.credit365.ru/*/loan*/*/income/create
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.1.0/lib/agis-core.js#sha256=mrgmLBDYkBLsL/GI0rVsuHT8V8QjzhXSEneovVOIL4Y=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      docs.google.com
// @connect      googleusercontent.com
// ==/UserScript==

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[agis:googlesheet] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    debounce,
    cleanupRoute,
    cleanup,
    storageGet,
    storageSet,
    storageSetDebounced,
    storageDelete,
    waitForElement,
    httpRequest,
    onUrlChange,
    createRouteTokenController,
    showBanner,
    registerDebugToggle,
  } = window.__AGIS_CORE__;

  const SCRIPT_NS   = 'agis:googlesheet';
  const STORAGE_KEY = 'agis:googlesheet:sheet-url:v1';
  const DEBUG_KEY   = 'agis:googlesheet:debug';
  const FILL_TIMEOUT = 10000;

  // registerDebugToggle асинхронный — debugCtl.value равен false, пока не резолвится.
  // bootstrap() дожидается и миграции, и регистрации debug-toggle (см. низ файла) —
  // иначе log() внутри handleClick/fillForm мог бы выполниться раньше, чем debugCtl
  // обновится, и debug-логи не появились бы вовсе (см. agis-duplicate-income.user.js).
  let debugCtl = { value: false };
  const log  = (...a) => { if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  const routeTokenController = createRouteTokenController();

  // Отдельный набор таймеров для баннера/кнопки — вне cleanupRoute(), чтобы SPA-переход
  // не обрывал уже запущенный showBanner (тот сам себя чистит через setUiTimeout ядра).
  let stopUrlWatcher = null;

  // Разовая миграция storage-ключей с v4.1 (плоские имена) на v4.2 (namespace + версия).
  // Если новый ключ пуст, а старый есть — переносим и удаляем старый.
  async function migrateLegacyStorage() {
    try {
      const legacyUrl = await storageGet('agis_google_sheet_url', undefined);
      if (legacyUrl !== undefined && !(await storageGet(STORAGE_KEY, undefined))) {
        await storageSet(STORAGE_KEY, legacyUrl);
        await storageDelete('agis_google_sheet_url');
        log('Миграция storage: sheet-url перенесён');
      }
    } catch (e) { warn('Миграция storage не удалась:', e); }
  }

  // --- Сетевой запрос через GM_xmlhttpRequest (обходит CSP страницы) ---
  // fetch() здесь нельзя: AGIS блокирует запросы к внешним доменам через CSP.
  async function fetchCsv(url) {
    // Google Sheets redirect: docs.google.com → *.googleusercontent.com
    // GM_xmlhttpRequest следует редиректам автоматически; оба домена указаны в @connect.
    const r = await httpRequest({ method: 'GET', url });
    if (r.status !== 200) throw new Error(`HTTP ${r.status} ${r.finalUrl || url}`);
    return r.responseText;
  }

  // --- RFC 4180-совместимый CSV-парсер ---
  function parseCSV(csvText) {
    const rows = tokenizeCSV(csvText);
    if (rows.length < 2) return {};
    const headers = rows[0].map(h => h.trim());
    const out = {};
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      if (cols.length === 0 || (cols.length === 1 && cols[0] === '')) continue;
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? '').trim(); });
      const loanId = obj['loanid'];
      if (!loanId) continue;
      out[loanId] = {
        order:      '-',
        sum:        obj['amount'],
        date:       obj['paramIncomeDate'],
        incomeType: obj['incomeType'],
        comment:    obj['comment'],
      };
    }
    return out;
  }

  function tokenizeCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false, i = 0;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; }
        else if (ch === '"') { inQuotes = false; i++; }
        else { field += ch; i++; }
      } else {
        if      (ch === '"')  { inQuotes = true; i++; }
        else if (ch === ',')  { row.push(field); field = ''; i++; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
        else                  { field += ch; i++; }
      }
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  // --- Вспомогательные ---
  function pad(n) { return n < 10 ? '0' + n : n; }

  function toDateTimeString(dateStr) {
    if (!dateStr) return '';
    let d;
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
      const [dd, mm, yyyy] = dateStr.split('.');
      d = new Date(`${yyyy}-${mm}-${dd}`);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      d = new Date(dateStr);
    } else {
      d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
    }
    const now = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  // --- Заполнение поля (ждёт появления через MO ядра, не setInterval) ---
  async function waitForAndFill(selector, value) {
    if (!value) return;
    try {
      const input = await waitForElement(selector, { timeout: FILL_TIMEOUT });
      if (input.tagName.toLowerCase() === 'select') {
        const option = Array.from(input.options).find(o => o.text.trim() === value.trim());
        if (option) {
          input.value = option.value;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        input.value = value;
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {
      warn(`Поле "${selector}" не найдено:`, e.message);
    }
  }

  // --- UI: кнопка ---
  function createButton() {
    const btn = document.createElement('button');
    btn.textContent = 'Подгрузить данные из Google Sheets';
    Object.assign(btn.style, {
      position: 'fixed', top: '10px', right: '10px',
      zIndex: '10000', padding: '6px 12px', cursor: 'pointer',
    });
    return btn;
  }

  // --- Меню Tampermonkey ---
  GM_registerMenuCommand('Изменить URL Google Таблицы', async () => {
    const current = await storageGet(STORAGE_KEY, '');
    const newUrl = prompt('Введите новый URL Google Таблицы (CSV):', current);
    if (newUrl !== null) {
      storageSetDebounced(STORAGE_KEY, newUrl.trim(), 0);
      alert('URL сохранён. Обновите страницу.');
    }
  });

  // --- Точка входа ---
  async function bootstrap() {
    const token = routeTokenController.next();
    cleanupRoute();

    // Ждём body (document-start не гарантирует его наличие)
    let body;
    try { body = await waitForElement('body'); }
    catch (e) { warn('body не найден:', e.message); return; }
    if (!routeTokenController.isCurrent(token)) return;

    let sheetUrl = await storageGet(STORAGE_KEY, '');
    if (!routeTokenController.isCurrent(token)) return;

    if (!sheetUrl) {
      sheetUrl = prompt(
        'AGIS: введите ссылку на опубликованную Google Таблицу (формат CSV):\n' +
        'Пример: https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=0'
      );
      if (!sheetUrl?.trim()) {
        alert('URL не задан. Скрипт не будет работать до его указания.');
        return;
      }
      storageSetDebounced(STORAGE_KEY, sheetUrl.trim());
    }

    // Кнопка — добавляем только после появления body
    const btn = createButton();
    body.appendChild(btn);

    // Debounce защищает от двойных кликов; ещё и визуальная блокировка ниже
    const handleClick = debounce(async () => {
      btn.disabled = true;
      btn.textContent = 'Загрузка...';
      try {
        const csv = await fetchCsv(sheetUrl);
        if (!routeTokenController.isCurrent(token)) return; // SPA-переход пока грузили
        const data = parseCSV(csv);
        log('Данные загружены:', data);
        await fillForm(data);
        showBanner('Данные из Google загружены!', { type: 'success' });
      } catch (err) {
        warn('Ошибка загрузки:', err.message);
        showBanner('Ошибка загрузки данных:\n' + err.message, { type: 'error' });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Подгрузить данные из Google Sheets';
      }
    }, 400);

    btn.addEventListener('click', handleClick);
  }

  async function fillForm(data) {
    const match = location.pathname.match(/\/(\d+)\/income\/create/);
    if (!match) return;
    const id   = match[1];
    const fill = data[id];
    if (!fill) {
      alert('Для номера заявки ' + id + ' нет данных в таблице!');
      return;
    }
    await waitForAndFill('[id$="_bankPaymentId"]', fill.order);
    await waitForAndFill('[id$="_income"]',        fill.sum);
    await waitForAndFill('[id$="_incomeDate"]',    toDateTimeString(fill.date));
    await waitForAndFill('[id$="_comment"]',       fill.comment);
    await waitForAndFill('[id$="_manualIncomeType"]', fill.incomeType);
    log('Автозаполнение:', id, fill);
  }

  // --- Запуск ---
  stopUrlWatcher = onUrlChange(() => bootstrap());

  window.addEventListener('pagehide', () => {
    cleanup();
    stopUrlWatcher();
  }, { once: true });

  (async () => {
    await migrateLegacyStorage();
    try {
      debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
    } catch (err) {
      warn('Инициализация debug-toggle не удалась:', err);
    }
    bootstrap();
  })();
})();
