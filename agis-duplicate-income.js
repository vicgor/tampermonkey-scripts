// ==UserScript==
// @name         CreditSmile - дублировать приход
// @namespace    agis.duplicate.income
// @version      1.0
// @description  Клик по строке прихода -> открыть форму создания и автозаполнить (дата, шлюз, внешний ID, сумма). Ручное подтверждение.
// @match        https://agis.creditsmile.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.volgazaim.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.berrycash.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.moneymania.ru/admin/agis2/core/loan/*/income/*
// @match        https://agis.belkacredit.ru/admin/agis2/core/loan/*/income/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'cs_income_duplicate_payload';

    // Маппинг текста шлюза из списка -> текст option в select формы
    const GATEWAY_MAP = {
        'EuroAlliance': 'Евроальянс',
        'Евроальянс':   'Евроальянс',
        'Tinkoff':      'Tinkoff',
        'Тинькофф':     'Tinkoff',
        'Alfa':         'Альфа-Банк',
        'Альфа-Банк':   'Альфа-Банк',
        'Qiwi':         'Qiwi',
        'Почта России': 'Почта России',
        'Korona':       'Korona',
        'Contact':      'Contact',
        'Elecsnet':     'Elecsnet',
        'СИАБ-Банк':    'СИАБ-Банк',
        'ТКБ Банк':     'ТКБ Банк',
        'Твои платежи': 'Твои платежи',
        'Цессия':       'Цессия',
        'Возврат продукта': 'Возврат продукта',
        'Иное':         'Иное',
    };

    const isListPage   = /\/income\/list/.test(location.pathname) || /\/income\/?$/.test(location.pathname);
    const isCreatePage = /\/income\/create/.test(location.pathname);

    if (isListPage)   initListPage();
    if (isCreatePage) initCreatePage();

    // ---------------------------------------------------------------
    function initListPage() {
        const table = document.querySelector('table.sonata-ba-list, table.table');
        if (!table) return;

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

        // Стили
        const style = document.createElement('style');
        style.textContent = `
            tr.cs-dup-row { cursor: copy; }
            tr.cs-dup-row:hover td { background: #fff7d6 !important; }
            .cs-dup-badge {
                display:inline-block;margin-left:6px;padding:1px 6px;
                background:#3c8dbc;color:#fff;border-radius:3px;font-size:11px;
            }
        `;
        document.head.appendChild(style);

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(tr => {
            tr.classList.add('cs-dup-row');
            tr.title = 'Клик: дублировать этот приход (откроется форма создания)';

            tr.addEventListener('click', (e) => {
                // не перехватываем клики по ссылкам/кнопкам/чекбоксам
                if (e.target.closest('a, button, input, label, .btn')) return;
                e.preventDefault();
                e.stopPropagation();

                const cells = tr.children;
                const payload = {
                    date:    cellText(cells[colIndex.date]),
                    gateway: cellText(cells[colIndex.gateway]),
                    paymentText: cellText(cells[colIndex.payment]),
                    extId:   cellText(cells[colIndex.extId]),
                };

                // Сумма = "Итого" из колонки "Платеж"
                payload.amount = extractTotal(payload.paymentText);
                // Дата в нормальном формате yyyy-MM-dd HH:mm:ss
                payload.dateNormalized = normalizeDate(payload.date);

                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

                // Переходим на форму создания
                const createUrl = location.pathname.replace(/\/income\/.*/, '/income/create');
                location.href = createUrl;
            }, true);
        });

        console.log('[CS dup] list page ready, columns:', colIndex);
    }

    function cellText(td) {
        return td ? td.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function extractTotal(text) {
        // ищем "Итого:1 234,56 ₽"
        const m = text.match(/Итого\s*:?\s*([\d\s.,]+)/i);
        if (!m) return '';
        return m[1]
            .replace(/\s| /g, '')
            .replace(/\.(?=\d{3}(\D|$))/g, '') // убрать разделители тысяч (точки)
            .replace(',', '.')
            .replace(/[^\d.]/g, '');
    }

    function normalizeDate(s) {
        // "1 июн. 2026 г., 12:22:06" -> "2026-06-01 12:22:06"
        if (!s) return '';
        const months = {
            'янв':1,'фев':2,'мар':3,'апр':4,'май':5,'мая':5,'июн':6,'июл':7,
            'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12
        };
        const m = s.match(/(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4}).*?(\d{1,2}):(\d{2}):(\d{2})/i);
        if (!m) return '';
        const mon = months[m[2].toLowerCase().slice(0,3)];
        if (!mon) return '';
        const pad = n => String(n).padStart(2,'0');
        return `${m[3]}-${pad(mon)}-${pad(m[1])} ${pad(m[4])}:${m[5]}:${m[6]}`;
    }

    // ---------------------------------------------------------------
    function initCreatePage() {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        let data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        // используем один раз
        sessionStorage.removeItem(STORAGE_KEY);

        // Ждём рендеринга формы (datepicker / select2)
        waitFor(() => document.querySelector('input[name$="[incomeDate]"]'), 5000)
            .then(() => fillForm(data))
            .catch(err => console.warn('[CS dup] form not found', err));
    }

    function fillForm(data) {
        // Дата
        const dateInput = document.querySelector('input[name$="[incomeDate]"]');
        if (dateInput && data.dateNormalized) {
            setInputValue(dateInput, data.dateNormalized);
        }

        // Внешний ID платежа -> bankPaymentId (Номер заказа)
        const extInput = document.querySelector('input[name$="[bankPaymentId]"]');
        if (extInput && data.extId) {
            setInputValue(extInput, data.extId);
        }

        // Сумма
        const amountInput = document.querySelector('input[name$="[income]"]');
        if (amountInput && data.amount) {
            setInputValue(amountInput, data.amount);
        }

        // Платежный шлюз -> select manualIncomeType
        const sel = document.querySelector('select[name$="[manualIncomeType]"]');
        if (sel && data.gateway) {
            const target = (GATEWAY_MAP[data.gateway] || data.gateway).toLowerCase();
            let matched = null;
            for (const opt of sel.options) {
                if (opt.text.trim().toLowerCase() === target) { matched = opt; break; }
            }
            if (!matched) {
                // частичное совпадение
                for (const opt of sel.options) {
                    if (opt.text.trim().toLowerCase().includes(target)) { matched = opt; break; }
                }
            }
            if (matched) {
                sel.value = matched.value;
                // обновим select2
                if (window.jQuery) {
                    window.jQuery(sel).trigger('change');
                } else {
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                console.warn('[CS dup] gateway option not found for:', data.gateway);
            }
        }

        showBanner(`Поля заполнены из выбранной строки. Проверьте и нажмите «Предпросмотр».`);
        console.log('[CS dup] filled:', data);
    }

    function setInputValue(input, value) {
        const proto = Object.getPrototypeOf(input);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(input, value); else input.value = value;
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(input).trigger('change');
    }

    function waitFor(check, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function tick() {
                const r = check();
                if (r) return resolve(r);
                if (Date.now() - t0 > timeout) return reject(new Error('timeout'));
                setTimeout(tick, 100);
            })();
        });
    }

    function showBanner(text) {
        const div = document.createElement('div');
        div.textContent = text;
        div.style.cssText = `
            position:fixed;top:60px;right:20px;z-index:99999;
            background:#00a65a;color:#fff;padding:10px 14px;border-radius:4px;
            box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:14px;max-width:360px;
        `;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 6000);
    }
})();