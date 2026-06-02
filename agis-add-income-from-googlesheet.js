// ==UserScript==
// @name         AGIS автозаполнение из Google Sheets
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Автозаполнение формы AGIS из Google Таблицы (CSV Publish)
// @match        https://agis.creditsmile.ru/*/loan*/*/income/create
// @match        https://agis.belkacredit.ru/*/loan*/*/income/create
// @match        https://agis.volgazaim.ru/*/loan*/*/income/create
// @match        https://agis.berrycash.ru/*/loan*/*/income/create
// @match        https://agis.moneymania.ru/*/loan*/*/income/create
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Вставьте сюда ссылку на вашу опубликованную Google таблицу в формате CSV:
    //const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/YOUR_ID/export?format=csv&id=YOUR_ID&gid=YOUR_GID';
    const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1-_BHy1vJ6eVnivzkiRJlCUP7ZkgqwdVRXmIPstrfiSw/export?format=csv&gid=0';


    // Кнопка для обновления данных с Google Sheets
    let btn = document.createElement('button');
    btn.innerText = 'Подгрузить данные из Google Sheets';
    btn.style.position = 'fixed';
    btn.style.top = '10px';
    btn.style.right = '10px';
    btn.style.zIndex = 10000;
    document.body.appendChild(btn);

    let data = null;

    btn.onclick = function() {
        fetch(GOOGLE_SHEET_CSV_URL).then(resp => resp.text()).then(csv => {
            data = parseCSV(csv);
            console.log('AGIS data:', JSON.stringify(data));
            alert('Данные из Google загружены!');
            fillForm();
        }).catch(err => {
            alert('Ошибка загрузки данных из Google Sheets!');
            console.error(err);
        });
    };

function parseCSV(csvText) {
    let lines = csvText.trim().split('\n');
    let headers = lines[0].split(',');
    let out = {};
    for (let i=1; i < lines.length; i++) {
        let v = lines[i].split(',');
        let obj = {};
        headers.forEach((h, idx) => obj[h.trim()] = v[idx]);
        let loan_id = obj['loanid']; // заголовок из первой строки!
        if (!loan_id) continue;
        out[loan_id] = {
            order:      '-',
            sum:        obj['amount'],
            date:       obj['paramIncomeDate'],
            incomeType: obj['incomeType'],
            comment:    obj['comment']
        }
    }
    return out;
}


    function waitForAndFill(idSuffix, value) {
        let timer = setInterval(() => {
            let input = Array.from(document.querySelectorAll('input, textarea, select'))
                .find(el => el.id && el.id.endsWith('_' + idSuffix));
            if (input) {
                clearInterval(timer);
                if (input.tagName.toLowerCase() === 'select') {
                    // Заполняем select по тексту
                    let option = Array.from(input.options).find(opt => opt.text.trim() === value.trim());
                    if (option) {
                        input.value = option.value;
                        input.dispatchEvent(new Event('change', { bubbles:true }));
                    }
                } else {
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles:true }));
                }
            }
        }, 200);
    }

function pad(n) { return n < 10 ? '0' + n : n; }

function toDateTimeString(dateStr) {
    // Попробуем распарсить строку автоматически: 10.11.2025 или другой формат
    // Сначала ищем DD.MM.YYYY или YYYY-MM-DD
    let d, yyyy, mm, dd, HH, MM, SS;
    // Пример: 10.11.2025
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
        [dd, mm, yyyy] = dateStr.split('.');
        d = new Date(`${yyyy}-${mm}-${dd}`);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        d = new Date(dateStr);
    } else {
        // Если сразу не распознать — используем Date или возвращаем оригинал
        d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
    }
    // Получаем сегодняшнее время
    const now = new Date();
    HH = pad(now.getHours());
    MM = pad(now.getMinutes());
    SS = pad(now.getSeconds());
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${HH}:${MM}:${SS}`;
}

// --- Внутри fillForm:
function fillForm() {
    if (!data) return;
    let match = window.location.pathname.match(/\/(\d+)\/income\/create/);
    if (!match) return;
    let id = match[1];
    let fill = data[id];
    if (!fill) {
        alert('Для номера заявки ' + id + ' нет данных!');
        return;
    }

    waitForAndFill('bankPaymentId', fill.order);
    waitForAndFill('income', fill.sum);
    // преобразуем дату!
    let formattedIncomeDate = toDateTimeString(fill.date);
    waitForAndFill('incomeDate', formattedIncomeDate);
    waitForAndFill('comment', fill.comment);
    waitForAndFill('manualIncomeType', fill.incomeType);
    console.log('AGIS автозаполнение:', id, fill, 'incomeDate:', formattedIncomeDate);
}


})();
