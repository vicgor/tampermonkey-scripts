// ==UserScript==
// @name         AGIS - дублировать приход
// @namespace    agis.duplicate.income
// @version      2.4
// @description  Клик по строке прихода → открыть форму создания и автозаполнить (дата, шлюз, внешний ID, сумма). Ручное подтверждение.
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan*/*/income/*
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NS    = 'agis-dup-income';
  const STORAGE_KEY  = 'agis_dup_income_payload';
  const WAIT_TIMEOUT = 15000;

  // В @sandbox DOM GM_getValue/setValue синхронные — .then() недоступен
  let DEBUG = !!GM_getValue('debug_dup', false);

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

  const observers  = new Set();
  const timers     = new Set();
  let   routeToken = 0;

  function setManagedTimeout(cb, delay) {
    const t = setTimeout(() => { timers.delete(t); cb(); }, delay);
    timers.add(t);
    return t;
  }

  function cleanupRoute() {
    for (const o of observers) o.disconnect();
    observers.clear();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  function cleanup() { cleanupRoute(); }

  async function storageGet(key, fallback = null) {
    try {
      const v = await GM_getValue(key, fallback);
      return v === undefined ? fallback : v;
    } catch (e) { warn('GM_getValue ошибка:', key, e); return fallback; }
  }

  async function storageSet(key, value) {
    try { await GM_setValue(key, value); }
    catch (e) { warn('GM_setValue ошибка:', key, e); }
  }

  function waitForElement(selector, { root = document, timeout = WAIT_TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      let done = false, observer = null;
      const query = () => { try { return root.querySelector(selector); } catch { return null; } };
      const finish = (el) => {
        if (done) return; done = true;
        observer?.disconnect(); observers.delete(observer);
        clearTimeout(timeoutTimer); timers.delete(timeoutTimer);
        resolve(el);
      };
      const fail = () => {
        if (done) return; done = true;
        observer?.disconnect(); observers.delete(observer);
        reject(new Error(`waitForElement: "${selector}" не найден за ${timeout}мс`));
      };
      const ex = query(); if (ex) { resolve(ex); return; }
      const timeoutTimer = setManagedTimeout(fail, timeout);
      const startObserve = () => {
        if (done) return;
        const r = root === document ? (document.documentElement || document.body) : root;
        if (!r) { setManagedTimeout(startObserve, 50); return; }
        observer = new MutationObserver(() => { const el = query(); if (el) finish(el); });
        observer.observe(r, { childList: true, subtree: true });
        observers.add(observer);
        const el = query(); if (el) finish(el);
      };
      startObserve();
    });
  }

  // Маппинг шлюзов: ключ — что приходит из ячейки AGIS, значение — что подставить в select формы.
  // Поиск регистронезависимый — см. resolveGateway()
  const GATEWAY_MAP = {
    'euroalliance':     'Евроальянс',
    'евроальянс':     'Евроальянс',
    'mi_euroalliance':  'Евроальянс',
    'tinkoff':          'Tinkoff',
    'тинькофф':          'Tinkoff',
    'mi_tinkoff':       'Tinkoff',
    'alfa':             'Альфа-Банк',
    'альфа-банк':     'Альфа-Банк',
    'qiwi':             'Qiwi',
    'почта россии':    'Почта России',
    'mi_russianpost':   'Почта России',
    'korona':           'Korona',
    'contact':          'Contact',
    'elecsnet':         'Elecsnet',
    'mi_elecsnet':      'Elecsnet',
    'finstar':          'СИАБ-Банк',  // AGIS отдаёт латиницей
    'mi_siab':          'СИАБ-Банк',
    'сиаб-банк':        'СИАБ-Банк',
    'ткб банк':          'ТКБ Банк',
    'твои платежи':   'Твои платежи',
    'цессия':           'Цессия',
    'mi_cession':       'Цессия',
    'возврат продукта': 'Возврат продукта',
    'mi_refund_product': 'Возврат продукта',
    'иное':             'Иное',
  };

  // Регистронезависимый поиск шлюза в маппинге.
  // Ключи в GATEWAY_MAP хранятся в lower-case — приводим raw к нижнему регистру перед поиском.
  function resolveGateway(raw) {
    return GATEWAY_MAP[raw.toLowerCase()] ?? raw;
  }

  function cellText(td) { return td ? td.textContent.replace(/\s+/g, ' ').trim() : ''; }

  function extractTotal(text) {
    const m = text.match(/Итого\s*:?\s*([\d\s.,]+)/i);
    if (!m) return '';
    return m[1].replace(/\s|\u00a0/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  }

  function normalizeDate(s) {
    if (!s) return '';
    const months = { 'янв':1,'фев':2,'мар':3,'апр':4,'май':5,'мая':5,'июн':6,'июл':7,'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12 };
    const m = s.match(/(\d{1,2})\s+([a-zа-яё]+)\.?\s+(\d{4}).*?(\d{1,2}):(\d{2}):(\d{2})/i);
    if (!m) return '';
    const mon = months[m[2].toLowerCase().slice(0, 3)];
    if (!mon) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${m[3]}-${pad(mon)}-${pad(m[1])} ${pad(m[4])}:${m[5]}:${m[6]}`;
  }

  // --- Страница списка ---
  async function initListPage(token) {
    let table;
    try {
      table = await waitForElement('table.sonata-ba-list, table.table', { timeout: WAIT_TIMEOUT });
    } catch (e) {
      warn('Таблица не появилась за', WAIT_TIMEOUT, 'мс:', e.message);
      return;
    }
    if (token !== routeToken) return;

    const headerCells = table.querySelectorAll('thead th');
    const colIndex = {};
    headerCells.forEach((th, i) => {
      const t = th.textContent.trim().toLowerCase();
      if (t.includes('дата'))                       colIndex.date    = i;
      if (t.includes('платежный шлюз'))             colIndex.gateway = i;
      if (t === 'платеж' || t.startsWith('платеж'))  colIndex.payment = i;
      if (t.includes('внешний id'))                 colIndex.extId   = i;
      if (t.includes('статус'))                       colIndex.status  = i;
    });
    log('Колонки:', colIndex);

    const style = document.createElement('style');
    style.textContent = [
      'tr.cs-cancelled td { background: #f0f0f0 !important; color: #888 !important; }',
      'tr.cs-cancelled:hover td { background: #e4e4e4 !important; }',
      'tr.cs-dup-row { cursor: copy; }',
      'tr.cs-dup-row:not(.cs-cancelled):hover td { background: #fff7d6 !important; }',
    ].join('\n');
    document.head.appendChild(style);

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(tr => {
      const statusCell  = colIndex.status !== undefined ? tr.children[colIndex.status] : null;
      const isCancelled = cellText(statusCell) === 'Отменен';

      tr.classList.add('cs-dup-row');
      if (isCancelled) tr.classList.add('cs-cancelled');
      tr.title = isCancelled ? 'Статус: Отменен. Клик: дублировать' : 'Клик: дублировать этот приход';

      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, label, .btn')) return;
        e.preventDefault();
        const cells = tr.children;
        const payload = {
          date:        cellText(cells[colIndex.date]),
          gateway:     cellText(cells[colIndex.gateway]),
          paymentText: cellText(cells[colIndex.payment]),
          extId:       cellText(cells[colIndex.extId]),
        };
        payload.amount         = extractTotal(payload.paymentText);
        payload.dateNormalized = normalizeDate(payload.date);
        log('Пайлоад:', payload);
        ;(async () => {
          await storageSet(STORAGE_KEY, JSON.stringify(payload));
          location.href = location.pathname.replace(/\/income\/.*/, '/income/create');
        })();
      });
    });
    log('Список готов, строк:', rows.length);
  }

  // --- Страница создания ---
  async function initCreatePage(token) {
    const raw = await storageGet(STORAGE_KEY, null);
    if (token !== routeToken) return;
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); } catch (e) { warn('Неверный payload:', e); return; }

    await storageSet(STORAGE_KEY, null);
    if (token !== routeToken) return;

    try { await waitForElement('input[name$="[incomeDate]"]', { timeout: 10000 }); }
    catch (e) { warn('Форма не появилась:', e.message); return; }
    if (token !== routeToken) return;

    fillForm(data);
  }

  function fillForm(data) {
    const setVal = (sel, val) => {
      if (!val) return;
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(el).trigger('change');
    };

    setVal('input[name$="[incomeDate]"]',   data.dateNormalized);
    setVal('input[name$="[bankPaymentId]"]', data.extId);
    setVal('input[name$="[income]"]',        data.amount);

    const sel = document.querySelector('select[name$="[manualIncomeType]"]');
    if (sel && data.gateway) {
      // resolveGateway даёт нормализованное название, потом ищем опцию в select
      const target  = resolveGateway(data.gateway).toLowerCase();
      const matched = Array.from(sel.options).find(o => o.text.trim().toLowerCase() === target)
                   || Array.from(sel.options).find(o => o.text.trim().toLowerCase().includes(target));
      if (matched) {
        sel.value = matched.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(sel).trigger('change');
      } else { warn('Опция шлюза не найдена:', data.gateway); }
    }

    const banner = document.createElement('div');
    banner.textContent = 'Поля заполнены. Проверьте и нажмите «Предпросмотр».';
    Object.assign(banner.style, { position:'fixed', top:'60px', right:'20px', zIndex:'99999',
      background:'#00a65a', color:'#fff', padding:'10px 14px', borderRadius:'4px',
      boxShadow:'0 2px 8px rgba(0,0,0,.2)', fontSize:'14px', maxWidth:'360px' });
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 6000);
    log('Заполнено:', data);
  }

  // --- Точка входа ---
  async function bootstrap() {
    const token = ++routeToken;
    cleanupRoute();
    try { await waitForElement('body'); } catch (e) { warn('body:', e.message); return; }
    if (token !== routeToken) return;

    const path = location.pathname;
    if (/\/income\/list/.test(path) || /\/income\/?$/.test(path)) await initListPage(token);
    if (/\/income\/create/.test(path)) await initCreatePage(token);
  }

  window.addEventListener('pagehide', cleanup, { once: true });
  bootstrap();
})();
