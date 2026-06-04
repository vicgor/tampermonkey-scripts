// ==UserScript==
// @name         AGIS автозаполнение из Google Sheets
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Автозаполнение формы AGIS из Google Таблицы (CSV Publish)
// @match        https://agis.creditsmile.ru/*/loan*/*/income/create
// @match        https://agis.belkacredit.ru/*/loan*/*/income/create
// @match        https://agis.volgazaim.ru/*/loan*/*/income/create
// @match        https://agis.berrycash.ru/*/loan*/*/income/create
// @match        https://agis.moneymania.ru/*/loan*/*/income/create
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'agis_google_sheet_url';

    // --- Управление URL таблицы ---

    // Получить URL из хранилища; если не задан — спросить пользователя
    function getSheetUrl() {
        let url = GM_getValue(STORAGE_KEY, '');
        if (!url) {
            url = prompt(
                'AGIS: введите ссылку на опубликованную Google Таблицу (формат CSV):\n' +
                'Пример: https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=0'
            );
            if (url && url.trim()) {
                GM_setValue(STORAGE_KEY, url.trim());
            } else {
                alert('URL не задан. Скрипт не будет работать до его указания.');
                return null;
            }
        }
        return url;
    }

    // Пункт меню для изменения URL без правки кода
    GM_registerMenuCommand('Изменить URL Google Таблицы', () => {
        const current = GM_getValue(STORAGE_KEY, '');
        const newUrl = prompt('Введите новый URL Google Таблицы (CSV):', current);
        if (newUrl !== null) {
            GM_setValue(STORAGE_KEY, newUrl.trim());
            alert('URL сохранён. Обновите страницу.');
        }
    });

    // --- Кнопка ---

    const btn = document.createElement('button');
    btn.innerText = 'Подгрузить данные из Google Sheets';
    Object.assign(btn.style, {
        position: 'fixed', top: '10px', right: '10px',
        zIndex: 10000, padding: '6px 12px', cursor: 'pointer'
    });
    document.body.appendChild(btn);

    let data = null;

    btn.onclick = function () {
        const url = getSheetUrl();
        if (!url) return;

        btn.disabled = true;
        btn.innerText = 'Загрузка...';

        fetch(url)
            .then(resp => {
                if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
                return resp.text();
            })
            .then(csv => {
                data = parseCSV(csv);
                console.log('AGIS data:', JSON.stringify(data));
                alert('Данные из Google загружены!');
                fillForm();
            })
            .catch(err => {
                alert('Ошибка загрузки данных из Google Sheets:\n' + err.message);
                console.error(err);
            })
            .finally(() => {
                btn.disabled = false;
                btn.innerText = 'Подгрузить данные из Google Sheets';
            });
    };

    // --- RFC 4180-совместимый CSV-парсер ---
    // Корректно обрабатывает: значения с запятыми, кавычки, переносы строк внутри полей

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
                comment:    obj['comment']
            };
        }
        return out;
    }

    // Токенизатор CSV по RFC 4180
    function tokenizeCSV(text) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        let i = 0;

        // Нормализуем переносы строк
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        while (i < text.length) {
            const ch = text[i];

            if (inQuotes) {
                if (ch === '"') {
                    // Экранированная кавычка: "" внутри поля
                    if (text[i + 1] === '"') {
                        field += '"';
                        i += 2;
                    } else {
                        // Закрывающая кавычка
                        inQuotes = false;
                        i++;
                    }
                } else {
                    field += ch;
                    i++;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                    i++;
                } else if (ch === ',') {
                    row.push(field);
                    field = '';
                    i++;
                } else if (ch === '\n') {
                    row.push(field);
                    rows.push(row);
                    row = [];
                    field = '';
                    i++;
                } else {
                    field += ch;
                    i++;
                }
            }
        }

        // Последнее поле/строка без завершающего переноса строки
        row.push(field);
        if (row.length > 1 || row[0] !== '') rows.push(row);

        return rows;
    }

    // --- Ожидание и заполнение поля ---

    function waitForAndFill(idSuffix, value) {
        const MAX_ATTEMPTS = 50; // 50 × 200мс = 10 сек максимум
        let attempts = 0;

        const timer = setInterval(() => {
            attempts++;

            const input = Array.from(document.querySelectorAll('input, textarea, select'))
                .find(el => el.id && el.id.endsWith('_' + idSuffix));

            if (input) {
                clearInterval(timer);
                if (input.tagName.toLowerCase() === 'select') {
                    const option = Array.from(input.options)
                        .find(opt => opt.text.trim() === value.trim());
                    if (option) {
                        input.value = option.value;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } else {
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                return;
            }

            if (attempts >= MAX_ATTEMPTS) {
                clearInterval(timer); // утечка таймера устранена
                console.warn(`[AGIS] Поле "${idSuffix}" не найдено за ${MAX_ATTEMPTS * 200}мс`);
            }
        }, 200);
    }

    // --- Вспомогательные функции ---

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

    // --- Заполнение формы ---

    function fillForm() {
        if (!data) return;
        const match = window.location.pathname.match(/\/(\d+)\/income\/create/);
        if (!match) return;

        const id = match[1];
        const fill = data[id];
        if (!fill) {
            alert('Для номера заявки ' + id + ' нет данных в таблице!');
            return;
        }

        waitForAndFill('bankPaymentId', fill.order);
        waitForAndFill('income', fill.sum);
        waitForAndFill('incomeDate', toDateTimeString(fill.date));
        waitForAndFill('comment', fill.comment);
        waitForAndFill('manualIncomeType', fill.incomeType);

        console.log('AGIS автозаполнение:', id, fill);
    }

})();
