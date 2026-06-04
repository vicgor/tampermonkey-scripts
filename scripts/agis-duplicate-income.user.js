// ==UserScript==
// @name         CreditSmile - дублировать приход
// @namespace    agis.duplicate.income
// @version      2.0
// @description  Клик по строке прихода → открыть форму создания и автозаполнить (дата, шлюз, внешний ID, сумма). Ручное подтверждение.
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*/income/*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NS   = 'agis-dup-income';
  const STORAGE_KEY = 'agis_dup_income_payload';
  const WAIT_TIMEOUT = 15000;

  // --- DEBUG-флаг (переключается через меню Tampermonkey) ---
  let DEBUG = false;
  // Читаем DEBUG асинхронно в самом начале, до bootstrap
  GM_getValue('debug_dup', false).then(v => { DEBUG = !!v; });

  GM_registerMenuCommand(
    `Debug-логи: ${DEBUG ? '✅ вкл' : '⬜ выкл'} — нажмите для переключения`,
    () => {
      DEBUG = !DEBUG;
      GM_setValue('debug_dup', DEBUG);
      alert(`[${SCRIPT_NS}] Debug-логи ${DEBUG ? 'включены' : 'выключены'}. Обновите страницу.`);
    }
  );

  const log  = (...a) => { if (DEBUG) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  // --- Трекинг observers и таймеров ---
  const observers    = new Set();
  const timers       = new Set();
  const storageTimers = new Map();

  let routeToken = 0;

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

  // --- Хранилище (async) ---
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
      const finish = (el) => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        clearTimeout(timeoutTimer); timers.delete(timeoutTimer);
        resolve(el);
      };
      const fail = () => {
        if (done) return; done = true;
        if (observer) { observer.disconnect(); observers.delete(observer); }
        reject(new Error(`waitForElement: "${selector}" не найден за ${timeout} мс`));
      };
      const ex = query();
      if (ex) { resolve(ex); return; }
      const timeoutTimer = setManagedTimeout(fail, timeout);
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

  // --- Маппинг названий шлюзов ---
  const GATEWAY_MAP = {
    'EuroAlliance':    'Евроальянс',
    'Евроальянс':    'Евроальянс',
    'Tinkoff':         'Tinkoff',
    'Тинькофф':        'Tinkoff',
    'Alfa':            'Альфа-Банк',
    'Альфа-Банк':   'Альфа-Банк',
    'Qiwi':            'Qiwi',
    'Почта России':  'Почта России',
    'Korona':          'Korona',
    'Contact':         'Contact',
    'Elecsnet':        'Elecsnet',
    'СИАБ-Банк':      'СИАБ-Банк',
    'ТКБ Банк':        'ТКБ Банк',
    'Твои платежи':   'Твои платежи',
    'Цессия':          'Цессия',
    'Возврат продукта': 'Возврат продукта',
    'Иное':          'Иное',
  };

  // --- Парсинг ячеек таблицы ---
  function cellText(td) {
    return td ? td.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function extractTotal(text) {
    const m = text.match(/Итого\s*:?\s*([\d\s.,]+)/i);
    if (!m) return '';
    return m[1]
      .replace(/\s|\u00a0/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^\d.]/g, '');
  }

  function normalizeDate(s) {
    // "1 июн. 2026 г., 12:22:06" → "2026-06-01 12:22:06"
    if (!s) return '';
    const months = {
      'янв':1,'фев':2,'мар':3,'апр':4,'май':5,'мая':5,'июн':6,'июл':7,
      'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12
    };
    const m = s.match(/(\d{1,2})\s+([a-zа-яё]+)\.?\s+(\d{4}).*?(\d{1,2}):(\d{2}):(\d{2})/i);
    if (!m) return '';
    const mon = months[m[2].toLowerCase().slice(0, 3)];
    if (!mon) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${m[3]}-${pad(mon)}-${pad(m[1])} ${pad(m[4])}:${m[5]}:${m[6]}`;
  }

  // --- Страница списка: навешиваем обработчики клика на строки таблицы ---
  function initListPage() {
    const table = document.querySelector('table.sonata-ba-list, table.table');
    if (!table) { warn('Таблица не найдена'); return; }

    // Сопоставляем заголовки колонок -> индексы
    const headerCells = table.querySelectorAll('thead th');
    const colIndex = {};
    headerCells.forEach((th, i) => {
      const t = th.textContent.trim().toLowerCase();
      if (t.includes('дата'))              colIndex.date    = i;
      if (t.includes('платежный шлюз'))    colIndex.gateway = i;
      if (t === 'платеж' || t.startsWith('платеж')) colIndex.payment = i;
      if (t.includes('внешний id'))        colIndex.extId   = i;
    });
    log('Колонки:', colIndex);

    const style = document.createElement('style');
    style.textContent = `
      tr.cs-dup-row { cursor: copy; }
      tr.cs-dup-row:hover td { background: #fff7d6 !important; }
    `;
    document.head.appendChild(style);

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(tr => {
      tr.classList.add('cs-dup-row');
      tr.title = 'Клик: дублировать этот приход (откроется форма создания)';

      // Клик без capture: не перехватываем события от других обработчиков AGIS
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, label, .btn')) return;
        e.preventDefault();

        const cells = tr.children;
        const payload = {
          date:    cellText(cells[colIndex.date]),
          gateway: cellText(cells[colIndex.gateway]),
          paymentText: cellText(cells[colIndex.payment]),
          extId:   cellText(cells[colIndex.extId]),
        };
        payload.amount         = extractTotal(payload.paymentText);
        payload.dateNormalized = normalizeDate(payload.date);

        log('Переход на create с payload:', payload);

        // GM_setValue вместо sessionStorage:
        // sessionStorage недоступен при sandbox-контексте и новой вкладке.
        GM_setValue(STORAGE_KEY, JSON.stringify(payload)).then(() => {
          const createUrl = location.pathname.replace(/\/income\/.*/, '/income/create');
          location.href = createUrl;
        }).catch(e => warn('GM_setValue ошибка:', e));
      });
    });

    log('Страница списка готова,', rows.length, 'строк');
  }

  // --- Страница создания: ждём форму и заполняем ---
  async function initCreatePage(token) {
    // [1] Читаем payload из GM-хранилища
    const raw = await storageGet(STORAGE_KEY, null);
    if (token !== routeToken) return;  // [1]

    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch (e) { warn('Неверный payload:', e); return; }

    // Используем один раз — сразу удаляем, чтобы не заполнять повторно после F5
    await GM_setValue(STORAGE_KEY, null);
    if (token !== routeToken) return;  // после асинх удаления

    // [2] Ждём появления поля даты (datepicker) через MO
    try {
      await waitForElement('input[name$="[incomeDate]"]', { timeout: 10000 });
    } catch (e) {
      warn('Форма не появилась:', e.message);
      return;
    }
    if (token !== routeToken) return;  // [2]

    fillForm(data);
  }

  function fillForm(data) {
    // Дата
    const dateInput = document.querySelector('input[name$="[incomeDate]"]');
    if (dateInput && data.dateNormalized) setInputValue(dateInput, data.dateNormalized);

    // Внешний ID (Номер заказа)
    const extInput = document.querySelector('input[name$="[bankPaymentId]"]');
    if (extInput && data.extId) setInputValue(extInput, data.extId);

    // Сумма
    const amountInput = document.querySelector('input[name$="[income]"]');
    if (amountInput && data.amount) setInputValue(amountInput, data.amount);

    // Платёжный шлюз -> select
    const sel = document.querySelector('select[name$="[manualIncomeType]"]');
    if (sel && data.gateway) {
      const target = (GATEWAY_MAP[data.gateway] || data.gateway).toLowerCase();
      let matched = Array.from(sel.options).find(o => o.text.trim().toLowerCase() === target);
      if (!matched) matched = Array.from(sel.options).find(o => o.text.trim().toLowerCase().includes(target));
      if (matched) {
        sel.value = matched.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(sel).trigger('change');
      } else {
        warn('Опция шлюза не найдена:', data.gateway);
      }
    }

    showBanner('Поля заполнены из выбранной строки. Проверьте и нажмите «Предпросмотр».');
    log('Заполнено:', data);
  }

  function setInputValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) window.jQuery(input).trigger('change');
  }

  function showBanner(text) {
    const div = document.createElement('div');
    div.textContent = text;
    Object.assign(div.style, {
      position: 'fixed', top: '60px', right: '20px', zIndex: '99999',
      background: '#00a65a', color: '#fff', padding: '10px 14px', borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,.2)', fontSize: '14px', maxWidth: '360px',
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 6000);
  }

  // --- Точка входа ---
  async function bootstrap() {
    const token = ++routeToken;
    cleanupRoute();

    let body;
    try { body = await waitForElement('body'); }
    catch (e) { warn('body не найден:', e.message); return; }
    if (token !== routeToken) return;

    const path = location.pathname;
    const isListPage   = /\/income\/list/.test(path) || /\/income\/?$/.test(path);
    const isCreatePage = /\/income\/create/.test(path);

    if (isListPage)   initListPage();
    if (isCreatePage) await initCreatePage(token);
  }

  window.addEventListener('pagehide', cleanup, { once: true });
  bootstrap();
})();
