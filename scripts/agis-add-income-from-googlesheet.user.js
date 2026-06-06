// ==UserScript==
// @name         AGIS автозаполнение из Google Sheets
// @namespace    agis.income.googlesheet
// @version      4.1
// @description  Автозаполнение формы AGIS из Google Таблицы (CSV Publish). Запрос через GM_xmlhttpRequest (обходит CSP).
// @match        https://agis.creditsmile.ru/*/loan*/*/income/create
// @match        https://agis.belkacredit.ru/*/loan*/*/income/create
// @match        https://agis.volgazaim.ru/*/loan*/*/income/create
// @match        https://agis.berrycash.ru/*/loan*/*/income/create
// @match        https://agis.moneymania.ru/*/loan*/*/income/create
// @match        https://agis.credit7.ru/*/loan*/*/income/create
// @match        https://agis.credit365.ru/*/loan*/*/income/create
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      docs.google.com
// @connect      googleusercontent.com
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NS   = 'agis-googlesheet';
  const STORAGE_KEY = 'agis_google_sheet_url';
  const WAIT_TIMEOUT = 15000;

  const log  = (...a) => console.log(`[${SCRIPT_NS}]`, ...a);
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // --- Трекинг observers и таймеров ---
  const observers    = new Set();
  const timers       = new Set();
  const storageTimers = new Map();

  let routeToken = 0;
  let lastUrl    = location.href;
  let urlChangeInstalled = false;

  function setManagedTimeout(cb, delay) {
    const t = setTimeout(() => { timers.delete(t); cb(); }, delay);
    timers.add(t);
    return t;
  }

  function debounce(fn, wait = 250) {
    let t = null;
    function d(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); }
    d.cancel = () => { clearTimeout(t); t = null; };
    return d;
  }

  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  function cleanup() {
    cleanupRoute();
    for (const t of storageTimers.values()) clearTimeout(t);
    storageTimers.clear();
  }

  // --- Хранилище (async, как предписывает ядро) ---
  async function storageGet(key, fallback = null) {
    try {
      const v = await GM_getValue(key, fallback);
      return v === undefined ? fallback : v;
    } catch (e) { warn('GM_getValue ошибка:', key, e); return fallback; }
  }

  function storageSetDebounced(key, value, wait = 300) {
    const old = storageTimers.get(key);
    if (old) clearTimeout(old);
    const t = setTimeout(async () => {
      storageTimers.delete(key);
      try { await GM_setValue(key, value); }
      catch (e) { warn('GM_setValue ошибка:', key, e); }
    }, wait);
    storageTimers.set(key, t);
  }

  // --- DOM-ожидание через MutationObserver (не setInterval) ---
  function waitForElement(selector, { root = document, timeout = WAIT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let observer = null;
      const query = () => { try { return root.querySelector(selector); } catch (_) { return null; } };
      let timeoutTimer = null;
      const finish = (el) => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        if (timeoutTimer !== null) { clearTimeout(timeoutTimer); timers.delete(timeoutTimer); }
        resolve(el);
      };
      const fail = () => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        reject(new Error(`waitForElement: "${selector}" не найден за ${timeout} мс`));
      };
      const ex = query();
      if (ex) { finish(ex); return; }
      timeoutTimer = setManagedTimeout(fail, timeout);
      const startObserve = () => {
        if (done) return;
        const root2 = root === document ? (document.documentElement || document.body) : root;
        if (!root2) { setManagedTimeout(startObserve, 50); return; }
        observer = new MutationObserver(() => { const el = query(); if (el) finish(el); });
        observer.observe(root2, { childList: true, subtree: true });
        observers.add(observer);
        const el = query(); if (el) finish(el);
      };
      startObserve();
    });
  }

  // --- Сетевой запрос через GM_xmlhttpRequest (обходит CSP страницы) ---
  // fetch() здесь нельзя: AGIS блокирует запросы к внешним доменам через CSP.
  // GM_xmlhttpRequest работает в контексте расширения, не страницы.
  function httpRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 20000, ...details,
        onload:    resolve,
        onerror:   reject,
        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
        onabort:   () => reject(new Error('GM_xmlhttpRequest aborted')),
      });
    });
  }

  async function fetchCsv(url) {
    // Google Sheets redirect: docs.google.com → *.googleusercontent.com
    // GM_xmlhttpRequest следует редиректам автоматически;
    // оба домена указаны в @connect.
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

  // --- Заполнение поля (ждёт появления через MO, не setInterval) ---
  async function waitForAndFill(selector, value) {
    if (!value) return;
    try {
      const input = await waitForElement(selector, { timeout: 10000 });
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

  function showBanner(text, color = '#00a65a') {
    const div = document.createElement('div');
    div.textContent = text;
    Object.assign(div.style, {
      position: 'fixed', top: '60px', right: '20px', zIndex: '99999',
      background: color, color: '#fff', padding: '10px 14px', borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,.2)', fontSize: '14px', maxWidth: '360px',
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 6000);
  }

  // --- Меню Tampermonkey для изменения URL без правки кода ---
  GM_registerMenuCommand('Изменить URL Google Таблицы', async () => {
    const current = await storageGet(STORAGE_KEY, '');
    const newUrl = prompt('Введите новый URL Google Таблицы (CSV):', current);
    if (newUrl !== null) {
      storageSetDebounced(STORAGE_KEY, newUrl.trim(), 0);
      alert('URL сохранён. Обновите страницу.');
    }
  });

  // onUrlChange должен вызываться ровно один раз за время жизни страницы.
  // Повторный вызов вернёт no-op stopFn и выдаст предупреждение.
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

  // --- Точка входа ---
  async function bootstrap() {
    const token = ++routeToken;
    cleanupRoute();

    // Ждём body (document-start не гарантирует его наличие)
    let body;
    try { body = await waitForElement('body'); }
    catch (e) { warn('body не найден:', e.message); return; }
    if (token !== routeToken) return;   // [1] SPA-переход пока ждали

    // [2] Получаем URL таблицы из GM-хранилища
    let sheetUrl = await storageGet(STORAGE_KEY, '');
    if (token !== routeToken) return;   // [2]

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
        // [3] Сетевой запрос через GM_xmlhttpRequest (не fetch!)
        const csv = await fetchCsv(sheetUrl);
        if (token !== routeToken) return;  // [3] SPA-переход пока грузили
        const data = parseCSV(csv);
        log('Данные загружены:', data);
        await fillForm(data);
        showBanner('Данные из Google загружены!');
      } catch (err) {
        warn('Ошибка загрузки:', err.message);
        showBanner('Ошибка загрузки данных:\n' + err.message, '#c0392b');
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
    // Каждый waitForElement использует MutationObserver, не setInterval
    await waitForAndFill('[id$="_bankPaymentId"]', fill.order);
    await waitForAndFill('[id$="_income"]',        fill.sum);
    await waitForAndFill('[id$="_incomeDate"]',    toDateTimeString(fill.date));
    await waitForAndFill('[id$="_comment"]',       fill.comment);
    await waitForAndFill('[id$="_manualIncomeType"]', fill.incomeType);
    log('Автозаполнение:', id, fill);
  }

  // --- Запуск ---
  const stopUrlWatcher = onUrlChange(() => bootstrap());

  window.addEventListener('pagehide', () => {
    cleanup();
    stopUrlWatcher();
  }, { once: true });

  bootstrap();
})();
