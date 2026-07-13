// ==UserScript==
// @name         AGIS - дублировать приход
// @namespace    agis.duplicate.income
// @version      3.1
// @description  Клик по строке прихода → открыть форму создания и автозаполнить (дата, шлюз, внешний ID, сумма). Ручное подтверждение.
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.credit7.ru/admin/agis2/core/loan*/*/income/*
// @match        https://agis.credit365.ru/admin/agis2/core/loan*/*/income/*
// @require      https://raw.githubusercontent.com/vicgor/tampermonkey-scripts/v1.1.0/lib/agis-core.js#sha256=mrgmLBDYkBLsL/GI0rVsuHT8V8QjzhXSEneovVOIL4Y=
// @run-at       document-start
// @sandbox      DOM
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  if (!window.__AGIS_CORE__) {
    console.error('[agis:duplicate-income] agis-core.js не загружен (@require не сработал)');
    return;
  }

  const {
    waitForElement,
    cleanupRoute,
    cleanup,
    onUrlChange,
    createRouteTokenController,
    registerDebugToggle,
    storageGet,
    storageSet,
    storageDelete,
    showBanner,
  } = window.__AGIS_CORE__;

  const SCRIPT_NS    = 'agis:duplicate-income';
  const DOM_NS       = 'agis-duplicate-income'; // без двоеточия — для CSS/id, если понадобятся
  const STORAGE_KEY  = 'agis:duplicate-income:payload:v1';
  const DEBUG_KEY    = 'agis:duplicate-income:debug';
  const WAIT_TIMEOUT = 15000;

  // registerDebugToggle асинхронный — debugCtl.value равен false до его резолва.
  // bootstrap() стартует не дожидаясь этого (см. низ файла), чтобы не откладывать
  // первый поиск body/таблицы/формы на await GM_getValue/миграцию.
  let debugCtl = { value: false };
  const log  = (...a) => { if (debugCtl.value) console.log(`[${SCRIPT_NS}]`, ...a); };
  const warn = (...a) => console.warn(`[${SCRIPT_NS}]`, ...a);

  const routeTokenController = createRouteTokenController();

  // Разовая миграция storage-ключей v2.5 → v3.0 (плоские имена → namespace + версия).
  // Если новый ключ пуст, а старый есть — переносим и удаляем старый.
  async function migrateLegacyStorage() {
    try {
      // payload: agis_dup_income_payload → agis:duplicate-income:payload:v1
      const legacyPayload = await storageGet('agis_dup_income_payload', undefined);
      if (legacyPayload !== undefined && !(await storageGet(STORAGE_KEY, undefined))) {
        await storageSet(STORAGE_KEY, legacyPayload);
        await storageDelete('agis_dup_income_payload');
        log('Миграция storage: payload перенесён');
      }
      // debug: debug_dup → agis:duplicate-income:debug
      const legacyDebug = await storageGet('debug_dup', undefined);
      if (legacyDebug !== undefined) {
        await storageSet(DEBUG_KEY, !!legacyDebug);
        await storageDelete('debug_dup');
        log('Миграция storage: debug флаг перенесён');
      }
    } catch (e) { warn('Миграция storage не удалась:', e); }
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
    if (!routeTokenController.isCurrent(token)) return;

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

      tr.addEventListener('click', async (e) => {
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
        await storageSet(STORAGE_KEY, JSON.stringify(payload));
        location.href = location.pathname.replace(/\/income\/.*/, '/income/create');
      });
    });
    log('Список готов, строк:', rows.length);
  }

  // --- Страница создания ---
  async function initCreatePage(token) {
    const raw = await storageGet(STORAGE_KEY, null);
    if (!routeTokenController.isCurrent(token)) return;
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); } catch (e) { warn('Неверный payload:', e); return; }

    await storageSet(STORAGE_KEY, null);
    if (!routeTokenController.isCurrent(token)) return;

    try { await waitForElement('input[name$="[incomeDate]"]', { timeout: 10000 }); }
    catch (e) { warn('Форма не появилась:', e.message); return; }
    if (!routeTokenController.isCurrent(token)) return;

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

    showBanner('Поля заполнены. Проверьте и нажмите «Предпросмотр».', { type: 'success', durationMs: 6000 });
    log('Заполнено:', data);
  }

  // --- Точка входа ---
  async function bootstrap() {
    const token = routeTokenController.next();
    cleanupRoute();
    try { await waitForElement('body'); } catch (e) { warn('body:', e.message); return; }
    if (!routeTokenController.isCurrent(token)) return;

    const path = location.pathname;
    if (/\/income\/list/.test(path) || /\/income\/?$/.test(path)) await initListPage(token);
    if (/\/income\/create/.test(path)) await initCreatePage(token);
  }

  const stopUrlWatcher = onUrlChange(() => bootstrap());

  window.addEventListener('pagehide', () => {
    cleanup();
    stopUrlWatcher();
  }, { once: true });

  // Миграция storage — параллельно bootstrap. Страница создания у пользователя с момента
  // клика до чтения payload в initCreatePage проходит минимум 100мс на редирект —
  // миграция успевает завершиться. При гонке — откат через следующий запуск.
  (async () => {
    await migrateLegacyStorage();
    debugCtl = await registerDebugToggle(SCRIPT_NS, DEBUG_KEY);
  })();

  bootstrap();
})();
